/**
 * The release helper. `.github/workflows/release.yml` runs one phase per step as
 * `node scripts/release/release.ts <phase>`; the step's exit code is the phase's, and what a
 * phase decides leaves through step outputs (`state`, `decision`, and on `prepare` and `report`
 * the selected `sha`, `version`, `channel`, `publishable` and `reason`).
 *
 * Every external read and write goes through the `ReleaseIO` a phase is handed, so the tests in
 * this directory run the same phases against fakes. The file runs under Node 24's type
 * stripping: no syntax here may need a TypeScript transform, and it imports nothing outside
 * Node itself, so a publishing job needs no `pnpm install`.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRealIO } from "./io.ts";

export const PACKAGE = "@fluent.xyz/connect";
const PACKAGE_DIR = "packages/connect";
const MANIFEST = `${PACKAGE_DIR}/package.json`;
const REGISTRY_URL = "https://registry.npmjs.org/@fluent.xyz%2fconnect";
const MAIN = "refs/heads/main";
const WORKFLOW_PATH = ".github/workflows/release.yml";
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
const RECEIPT = "receipt.json";
const REGISTRY_TIMEOUT_MS = 30_000;

export interface ReleaseRecord {
  tag: string;
  target: string;
  prerelease: boolean;
  title: string;
  notes: string;
}

export interface RunHistory {
  approvals: Array<{ state: "approved" | "rejected"; environment: string; job: string }>;
  attempts: Array<{ attempt: number; conclusion: string | null }>;
}

/** The release's external boundaries: the npm registry and CLI, Git tags, GitHub Releases. */
export interface ReleaseIO {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** `npm pack` of `packageDir` into `destination`; resolves to the archive's path. */
  pack(packageDir: string, destination: string): Promise<string>;
  /** `npm publish <archive> --tag <distTag>`; a nonzero exit is returned, never thrown. */
  npmPublish(archive: string, distTag: string): Promise<{ exitCode: number; output: string }>;
  /** The commit a tag points at, or null when there is no such tag. */
  tagTarget(tag: string): Promise<string | null>;
  createTag(tag: string, sha: string): Promise<void>;
  getRelease(tag: string): Promise<ReleaseRecord | null>;
  createRelease(release: ReleaseRecord): Promise<void>;
  /** This run's deployment approvals and the conclusion of each of its attempts. */
  runHistory(runId: string): Promise<RunHistory>;
}

export interface PhaseContext {
  env: Record<string, string | undefined>;
  cwd: string;
  io: ReleaseIO;
  setOutput(name: string, value: string): void;
  log(line: string): void;
}

export type Phase = (context: PhaseContext) => Promise<number>;

/** What a run records before publishing an archive, and what a retry proves itself against. */
export interface Receipt {
  runId: string;
  sourceSha: string;
  version: string;
  distTag: string;
  integrity: string;
  archive: string;
}

interface Version {
  text: string;
  major: number;
  minor: number;
  patch: number;
  /** The N of `X.Y.Z-rc.N`, or null for a stable version. */
  rc: number | null;
}

/** A refusal: the run writes nothing more and reports `state` with decision `blocked`. */
class Refusal extends Error {
  state: "blocked" | "abandoned";

  constructor(message: string, state: "blocked" | "abandoned" = "blocked") {
    super(message);
    this.state = state;
  }
}

const NUMBER = "(0|[1-9]\\d*)";
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-rc\\.${NUMBER})?$`);

/** The two supported forms, `X.Y.Z` and `X.Y.Z-rc.N`; anything else is not releasable. */
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  return {
    text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4]),
  };
}

function baseOf(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function distTagOf(version: Version): string {
  return version.rc === null ? "latest" : "next";
}

function compareBase(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function integrityOf(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

interface RegistryVersion {
  integrity: string | null;
  attestations: string | null;
}

interface Registry {
  latest: Version;
  versions: Record<string, RegistryVersion>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(io: ReleaseIO, url: string, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await io.fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Refusal(`${what} unreachable: ${String(error)}`);
  }
  if (response.status !== 200) throw new Refusal(`${what} answered HTTP ${response.status}`);
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Refusal(`${what} answered invalid JSON`);
  }
}

/**
 * The package's registry metadata. A 404 is a refusal too: the package exists, so a registry
 * that says otherwise cannot be trusted to say which versions are free.
 */
async function readRegistry(io: ReleaseIO): Promise<Registry> {
  const doc = await readJson(io, REGISTRY_URL, "the npm registry");
  if (!isObject(doc) || doc.name !== PACKAGE) {
    throw new Refusal(`registry metadata is not for ${PACKAGE}`);
  }
  if (!isObject(doc.versions)) throw new Refusal("registry metadata has no versions map");
  const tags = doc["dist-tags"];
  const latest = isObject(tags) && typeof tags.latest === "string"
    ? parseVersion(tags.latest)
    : null;
  if (!latest || latest.rc !== null) {
    throw new Refusal("registry metadata has no valid stable dist-tags.latest");
  }
  const versions: Record<string, RegistryVersion> = {};
  for (const [key, entry] of Object.entries(doc.versions)) {
    const dist = isObject(entry) && isObject(entry.dist) ? entry.dist : {};
    const attestations = isObject(dist.attestations) ? dist.attestations.url : null;
    versions[key] = {
      integrity: typeof dist.integrity === "string" ? dist.integrity : null,
      attestations: typeof attestations === "string" ? attestations : null,
    };
  }
  return { latest, versions };
}

/** Why a new publication of `version` is not allowed, or null when it is. */
function ineligibility(registry: Registry, version: Version): string | null {
  if (registry.versions[version.text]) return "version_already_published";
  if (version.rc !== null && registry.versions[baseOf(version)]) {
    return "stable_version_already_published";
  }
  if (compareBase(version, registry.latest) <= 0) return "version_not_greater_than_latest";
  return null;
}

/** The SLSA provenance the registry holds for a version: its run, commit and digest. */
async function readProvenance(io: ReleaseIO, url: string) {
  const doc = await readJson(io, url, "the npm attestations endpoint");
  const list = isObject(doc) && Array.isArray(doc.attestations) ? doc.attestations : [];
  const slsa = list.find((a) => isObject(a) && a.predicateType === SLSA_PROVENANCE);
  const envelope = isObject(slsa) && isObject(slsa.bundle) ? slsa.bundle.dsseEnvelope : null;
  if (!isObject(envelope) || typeof envelope.payload !== "string") {
    throw new Refusal("the registry holds no SLSA provenance for this version");
  }
  let statement: unknown;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    throw new Refusal("the registry's provenance statement is not JSON");
  }
  const s = statement as {
    subject?: Array<{ digest?: { sha512?: string } }>;
    predicate?: {
      buildDefinition?: {
        externalParameters?: { workflow?: { path?: string } };
        resolvedDependencies?: Array<{ digest?: { gitCommit?: string } }>;
      };
      runDetails?: { metadata?: { invocationId?: string } };
    };
  };
  const invocation = s.predicate?.runDetails?.metadata?.invocationId ?? "";
  return {
    sha512: s.subject?.[0]?.digest?.sha512 ?? null,
    runId: /\/actions\/runs\/(\d+)\//.exec(invocation)?.[1] ?? null,
    sha: s.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit ?? null,
    workflow: s.predicate?.buildDefinition?.externalParameters?.workflow?.path ?? null,
  };
}

/**
 * Proves that the registry's copy of a version is this run's own publication of this receipt:
 * same archive digest, and provenance naming this run, this commit and this workflow. Anything
 * less is somebody else's version, or evidence too weak to skip a write on.
 */
async function proveCompleted(
  io: ReleaseIO,
  entry: RegistryVersion,
  receipt: Receipt,
  env: PhaseContext["env"],
): Promise<void> {
  if (entry.integrity !== receipt.integrity) {
    throw new Refusal(`${receipt.version} is in the registry with another archive digest`);
  }
  if (!entry.attestations) throw new Refusal(`${receipt.version} has no provenance`);
  const provenance = await readProvenance(io, entry.attestations);
  const hex = Buffer.from(receipt.integrity.replace(/^sha512-/, ""), "base64").toString("hex");
  const matches =
    provenance.sha512 === hex &&
    provenance.runId === env.GITHUB_RUN_ID &&
    provenance.sha === env.GITHUB_SHA &&
    provenance.workflow === WORKFLOW_PATH;
  if (!matches) {
    throw new Refusal(`${receipt.version} was published by another run or from another commit`);
  }
}

function readManifest(cwd: string): { text: string; version: string } {
  const text = readFileSync(join(cwd, MANIFEST), "utf8");
  const version = (JSON.parse(text) as { version?: unknown }).version;
  return { text, version: typeof version === "string" ? version : "" };
}

function releaseDir(env: PhaseContext["env"]): string {
  const dir = env.RELEASE_DIR;
  if (!dir) throw new Refusal("RELEASE_DIR is not set");
  return dir;
}

function readReceipt(dir: string): Receipt {
  const file = join(dir, RECEIPT);
  if (!existsSync(file)) throw new Refusal("the verified receipt is missing");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Receipt;
  } catch {
    throw new Refusal("the verified receipt is not JSON");
  }
}

/** A tag that exists must point at the selected commit; one that does not is still free. */
async function checkTag(io: ReleaseIO, tag: string, sha: string): Promise<void> {
  const target = await io.tagTarget(tag);
  if (target !== null && target !== sha) {
    throw new Refusal(`tag ${tag} already points at ${target}, not ${sha}`);
  }
}

/** A rejected approval or a cancelled earlier attempt abandons the candidate for good. */
async function checkNotAbandoned(io: ReleaseIO, env: PhaseContext["env"]): Promise<void> {
  const history = await io.runHistory(env.GITHUB_RUN_ID ?? "");
  const attempt = Number(env.GITHUB_RUN_ATTEMPT ?? "1");
  if (history.approvals.some((approval) => approval.state === "rejected")) {
    throw new Refusal("an approval in this run was rejected", "abandoned");
  }
  if (history.attempts.some((a) => a.attempt < attempt && a.conclusion === "cancelled")) {
    throw new Refusal("an earlier attempt of this run was cancelled", "abandoned");
  }
}

function refuse(context: PhaseContext, error: unknown): number {
  if (!(error instanceof Refusal)) throw error;
  context.log(`refused: ${error.message}`);
  context.setOutput("reason", error.message);
  context.setOutput("decision", "blocked");
  context.setOutput("state", error.state);
  return 1;
}

/**
 * Selects the release: checks the dispatch inputs against the manifest at the event's commit,
 * reads the registry and the version tags, and reports whether the version is publishable. A dry
 * run of a version that cannot be published still verifies, and says why it cannot.
 */
async function prepare(context: PhaseContext): Promise<number> {
  const { env } = context;
  try {
    if (env.GITHUB_REF !== MAIN) throw new Refusal(`releases run from main, not ${env.GITHUB_REF}`);
    const expected = env.EXPECTED_VERSION ?? "";
    if (expected === "") throw new Refusal("expected_version is required");
    const manifest = readManifest(context.cwd);
    if (manifest.version !== expected) {
      throw new Refusal(`the manifest says ${manifest.version}, not ${expected}`);
    }
    const version = parseVersion(manifest.version);
    if (!version) {
      throw new Refusal(`${manifest.version} is neither X.Y.Z nor X.Y.Z-rc.N`);
    }
    const registry = await readRegistry(context.io);
    const sha = env.GITHUB_SHA ?? "";
    let reason = ineligibility(registry, version);
    const tags = version.rc === null ? [version.text] : [version.text, baseOf(version)];
    for (const tag of tags) {
      const target = await context.io.tagTarget(`v${tag}`);
      if (reason === null && target !== null && target !== sha) reason = "tag_conflict";
    }
    context.setOutput("sha", sha);
    context.setOutput("version", version.text);
    context.setOutput("stable_version", baseOf(version));
    context.setOutput("channel", version.rc === null ? "stable" : "rc");
    context.setOutput("publishable", reason === null ? "true" : "false");
    if (reason !== null) {
      context.setOutput("reason", reason);
      if (env.DRY_RUN !== "true") throw new Refusal(reason);
    }
    context.log(`selected ${PACKAGE}@${version.text} at ${sha}; publishable: ${reason ?? "yes"}`);
    return 0;
  } catch (error) {
    return refuse(context, error);
  }
}

/**
 * Turns the checked-out candidate into its stable package: the manifest's version becomes the
 * candidate's base version, and nothing else in the tree changes.
 */
async function promote(context: PhaseContext): Promise<number> {
  try {
    const source = context.env.SOURCE_VERSION ?? "";
    const manifest = readManifest(context.cwd);
    const candidate = parseVersion(manifest.version);
    if (!candidate || candidate.rc === null || manifest.version !== source) {
      throw new Refusal(`cannot promote ${manifest.version}; the run selected ${source}`);
    }
    const stable = baseOf(candidate);
    const text = manifest.text.replace(
      /("version"\s*:\s*")[^"]*(")/,
      (_, open: string, close: string) => `${open}${stable}${close}`,
    );
    const before = JSON.parse(manifest.text) as Record<string, unknown>;
    const after = JSON.parse(text) as Record<string, unknown>;
    if (JSON.stringify({ ...before, version: stable }) !== JSON.stringify(after)) {
      throw new Refusal("promoting the manifest would change more than its version");
    }
    writeFileSync(join(context.cwd, MANIFEST), text);
    context.log(`promoted ${source} to ${stable}`);
    return 0;
  } catch (error) {
    return refuse(context, error);
  }
}

/**
 * Packs the verified package and records the receipt a publishing job checks the archive against.
 * A promoted stable archive packed outside a dry run leaves the candidate waiting for its own
 * stable approval.
 */
async function pack(context: PhaseContext): Promise<number> {
  const { env } = context;
  try {
    const dir = releaseDir(env);
    mkdirSync(dir, { recursive: true });
    const version = parseVersion(readManifest(context.cwd).version);
    if (!version) throw new Refusal("the manifest version is not releasable");
    const archive = await context.io.pack(join(context.cwd, PACKAGE_DIR), dir);
    const receipt: Receipt = {
      runId: env.GITHUB_RUN_ID ?? "",
      sourceSha: env.GITHUB_SHA ?? "",
      version: version.text,
      distTag: distTagOf(version),
      integrity: integrityOf(readFileSync(archive)),
      archive: basename(archive),
    };
    writeFileSync(join(dir, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
    context.log(`packed ${receipt.archive} (${receipt.integrity})`);
    if (env.RELEASE_STAGE === "promoted" && env.DRY_RUN !== "true") {
      context.setOutput("state", "awaiting_stable_approval");
    }
    return 0;
  } catch (error) {
    return refuse(context, error);
  }
}

/** Completes a version's tag and GitHub Release; an existing matching one counts as done. */
async function completeMetadata(context: PhaseContext, version: Version): Promise<void> {
  const { io, env } = context;
  const sha = env.GITHUB_SHA ?? "";
  const tag = `v${version.text}`;
  if ((await io.tagTarget(tag)) === null) await io.createTag(tag, sha);
  if ((await io.getRelease(tag)) === null) {
    await io.createRelease({
      tag,
      target: sha,
      prerelease: version.rc !== null,
      title: tag,
      notes: `${PACKAGE}@${version.text}, published from ${sha} by workflow run ` +
        `${env.GITHUB_RUN_ID} under dist-tag ${distTagOf(version)}.`,
    });
  }
}

/**
 * Publishes the verified archive of one phase (the candidate, or the stable version), or, when a
 * previous attempt of this run already published it, proves that and completes only its tag and
 * Release. Eligibility is read again here because the registry may have moved during the
 * approval wait.
 */
async function publish(context: PhaseContext): Promise<number> {
  const { io, env } = context;
  const sha = env.GITHUB_SHA ?? "";
  try {
    await checkNotAbandoned(io, env);
    const dir = releaseDir(env);
    const receipt = readReceipt(dir);
    const version = parseVersion(receipt.version);
    if (!version || receipt.runId !== env.GITHUB_RUN_ID || receipt.sourceSha !== sha ||
      receipt.distTag !== distTagOf(version)) {
      throw new Refusal("the receipt does not belong to this run, commit and version");
    }
    if (env.CHANNEL === "rc" && version.rc === null) {
      const candidate = parseVersion(env.SOURCE_VERSION ?? "");
      if (!candidate || baseOf(candidate) !== version.text) {
        throw new Refusal(`${version.text} is not the base of ${env.SOURCE_VERSION}`);
      }
      const candidateTag = `v${candidate.text}`;
      const release = await io.getRelease(candidateTag);
      if ((await io.tagTarget(candidateTag)) !== sha || !release?.prerelease) {
        throw new Refusal(`${candidateTag} is not complete, so promotion is not eligible`);
      }
    }
    const tag = `v${version.text}`;
    await checkTag(io, tag, sha);
    const existingRelease = await io.getRelease(tag);
    if (existingRelease && existingRelease.target !== sha) {
      throw new Refusal(`release ${tag} already targets ${existingRelease.target}`);
    }

    // The retained archive is part of the proof on a retry too: a receipt whose archive is gone
    // or altered no longer shows what this run verified, so neither path may write on it.
    const archive = join(dir, receipt.archive);
    if (!existsSync(archive)) throw new Refusal("the verified archive is missing");
    if (integrityOf(readFileSync(archive)) !== receipt.integrity) {
      throw new Refusal("the archive's digest differs from its receipt");
    }

    const registry = await readRegistry(io);
    const entry = registry.versions[version.text];
    if (entry) {
      await proveCompleted(io, entry, receipt, env);
      context.setOutput("decision", "metadata_only");
      context.log(`${version.text} is this run's own publication; completing its metadata`);
    } else {
      const reason = version.rc === null
        ? (compareBase(version, registry.latest) <= 0 ? "version_not_greater_than_latest" : null)
        : ineligibility(registry, version);
      if (reason !== null) throw new Refusal(reason);
      context.setOutput("decision", "publish");
      const result = await io.npmPublish(archive, receipt.distTag);
      context.log(result.output);
      if (result.exitCode !== 0) {
        // A failed exit does not prove the registry refused the write: reconcile on a re-run.
        context.setOutput("state", "reconcile_required");
        return 1;
      }
    }

    try {
      await completeMetadata(context, version);
    } catch (error) {
      context.log(`tag or Release failed: ${String(error)}`);
      context.setOutput("state", "metadata_incomplete");
      return 1;
    }
    context.setOutput("state", version.rc === null ? "published" : "candidate_published");
    return 0;
  } catch (error) {
    return refuse(context, error);
  }
}

/**
 * The run's final state, from the result and state of every job before it. It runs whether the
 * run succeeded, failed or was cancelled, so a refusal, an abandoned candidate and a dry run all
 * end with one reported state.
 */
async function report(context: PhaseContext): Promise<number> {
  const { env } = context;
  const finish = (state: string, decision: string | null, code: number): number => {
    if (decision !== null) context.setOutput("decision", decision);
    context.setOutput("state", state);
    context.log(`release ${state}`);
    return code;
  };
  if (env.VERIFY_RESULT !== "success") return finish("blocked", "blocked", 1);
  const rc = env.CHANNEL === "rc";
  if (env.DRY_RUN === "true") {
    if (rc && env.VERIFY_STABLE_RESULT !== "success") return finish("blocked", "blocked", 1);
    context.setOutput("sha", env.GITHUB_SHA ?? "");
    context.setOutput("version", env.VERSION ?? "");
    context.setOutput("channel", env.CHANNEL ?? "");
    context.setOutput("publishable", env.PUBLISHABLE ?? "");
    if (env.REASON) context.setOutput("reason", env.REASON);
    return finish("verification_only", "verification_only", 0);
  }
  const phases: Array<[string | undefined, string | undefined]> = rc
    ? [
      [env.PUBLISH_RC_RESULT, env.PUBLISH_RC_STATE],
      [env.VERIFY_STABLE_RESULT, ""],
      [env.PUBLISH_STABLE_RESULT, env.PUBLISH_STABLE_STATE],
    ]
    : [[env.PUBLISH_STABLE_RESULT, env.PUBLISH_STABLE_STATE]];
  for (const [result, state] of phases) {
    if (result === "success") continue;
    if (state === "blocked") return finish("blocked", "blocked", 1);
    if (state === "abandoned" || result === "cancelled") return finish("abandoned", "blocked", 1);
    if (state) return finish(state, null, 1);
    // A publishing job that failed without a state never ran its steps: its approval was
    // rejected, or the environment refused the ref.
    const history = await context.io.runHistory(env.GITHUB_RUN_ID ?? "");
    const rejected = history.approvals.some((approval) => approval.state === "rejected");
    return rejected ? finish("abandoned", "blocked", 1) : finish("blocked", "blocked", 1);
  }
  return finish("published", null, 0);
}

export const phases: Record<string, Phase> = { prepare, promote, pack, publish, report };

function isEntryPoint(): boolean {
  const script = process.argv[1];
  return script !== undefined && import.meta.url === pathToFileURL(script).href;
}

if (isEntryPoint()) {
  const name = process.argv[2] ?? "";
  const phase = phases[name];
  if (!phase) {
    console.error(`unknown phase "${name}"; phases: ${Object.keys(phases).join(", ")}`);
    process.exitCode = 2;
  } else {
    const outputs = process.env.GITHUB_OUTPUT;
    process.exitCode = await phase({
      env: process.env,
      cwd: process.cwd(),
      io: createRealIO(process.env),
      setOutput(key, value) {
        if (outputs) appendFileSync(outputs, `${key}=${value.replace(/\r?\n/g, " ")}\n`);
        console.log(`${key}=${value}`);
      },
      log: (line) => console.log(line),
    });
  }
}
