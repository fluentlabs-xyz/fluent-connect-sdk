/**
 * The external boundaries of a release, faked: the npm registry (read over `fetch`, written by
 * `npm publish`), `npm pack`, the repository's Git tags and GitHub Releases, and the run's
 * approval and attempt history. Nothing in `scripts/release` is faked; the helper under test
 * receives these through the `ReleaseIO` it is handed.
 *
 * Contracts mirrored, as of 2026-10:
 * - Registry packument `GET https://registry.npmjs.org/@fluent.xyz%2fconnect`: an object with
 *   `name`, `dist-tags` and `versions`, each version carrying `dist.integrity` (`sha512-<base64>`)
 *   and `dist.attestations.url`.
 * - Attestations `GET https://registry.npmjs.org/-/npm/v1/attestations/@fluent.xyz%2fconnect@<v>`:
 *   `{ attestations: [{ predicateType, bundle: { dsseEnvelope: { payload } } }] }`, the SLSA v1
 *   payload being a base64 in-toto statement whose subject digest is the archive's SHA-512 (hex),
 *   whose `runDetails.metadata.invocationId` is `.../actions/runs/<run id>/attempts/<attempt>`
 *   and whose `resolvedDependencies[0].digest.gitCommit` is the run's `GITHUB_SHA`.
 * - `npm publish <archive> --tag <t>` (npm 11): a version already in the registry is refused
 *   with a nonzero exit and no write; without `--tag` the version becomes `latest`; trusted
 *   publishing needs `id-token: write` in `release.yml` under the `npm-publish` environment.
 * - `npm pack`: writes `fluent.xyz-connect-<version>.tgz`. The fake archive is JSON rather than a
 *   tarball and carries the tracked tree it was built from and the commands that ran on it, so a
 *   test can compare build inputs, which a real tarball cannot show.
 * - Git refs and Releases: creating an existing tag or Release fails (422); writes need
 *   `contents: write`.
 * - `GET /repos/{owner}/{repo}/actions/runs/{id}/approvals` and `.../attempts/{n}`: the run's
 *   approval history and each attempt's conclusion.
 *
 * External-mutation traces record every attempted npm publication, dist-tag write, Git tag and
 * GitHub Release write; registry reads and run artifacts are not mutations.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const REPOSITORY = "fluentlabs-xyz/fluent-connect-sdk";
export const PACKAGE = "@fluent.xyz/connect";
const REGISTRY = "https://registry.npmjs.org";
const ATTESTATIONS = `${REGISTRY}/-/npm/v1/attestations/`;
const SLSA = "https://slsa.dev/provenance/v1";
const PUBLISH_ATTESTATION = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";

export type Tree = Record<string, string>;

export interface Provenance {
  runId: string;
  attempt: number;
  sha: string;
  ref: string;
  workflow: string;
}

export interface RegistryVersion {
  integrity: string;
  provenance: Provenance | null;
}

export type RegistryFailure =
  | { kind: "transport"; error: Error }
  | { kind: "status"; status: number }
  | { kind: "json" }
  | { kind: "schema"; rewrite: (packument: Record<string, unknown>) => unknown };

export type MutationKind = "npm_publish" | "npm_dist_tag" | "git_tag" | "github_release";

export interface Mutation {
  kind: MutationKind;
  detail: Record<string, unknown>;
  runId: string;
  attempt: number;
  job: string;
  via: "helper" | "shell";
}

export interface Checkpoint {
  name: string;
  /** Index into `World.trace` at which the checkpoint was taken. */
  at: number;
  runId: string;
  attempt: number;
  job: string;
}

export interface FakeArchive {
  format: "fake-npm-pack";
  name: string;
  version: string;
  /** Every path tracked at the checked-out commit, with its content when packed. */
  buildInput: Record<string, string | null>;
  /** The commands the packing job ran before `npm pack`, with the manifest version each saw. */
  verifiedBy: Array<{ command: string; manifestVersion: string | null }>;
}

export function integrityOf(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export class FakeRegistry {
  readonly name = PACKAGE;
  distTags: Record<string, string> = {};
  readonly versions = new Map<string, RegistryVersion>();
  failure: RegistryFailure | null = null;
  readonly requests: string[] = [];

  /** A publication made outside the run under test, by another workflow run. */
  publishedElsewhere(version: string, distTag?: string, runId = "1000"): void {
    const bytes = Buffer.from(`other run ${runId} ${version}`);
    this.versions.set(version, {
      integrity: integrityOf(bytes),
      provenance: {
        runId,
        attempt: 1,
        sha: "0".repeat(40),
        ref: "refs/heads/main",
        workflow: ".github/workflows/release.yml",
      },
    });
    if (distTag) this.distTags[distTag] = version;
  }

  packument(): Record<string, unknown> {
    const versions: Record<string, unknown> = {};
    for (const [version, entry] of this.versions) {
      versions[version] = {
        name: this.name,
        version,
        dist: {
          integrity: entry.integrity,
          tarball: `${REGISTRY}/${this.name}/-/connect-${version}.tgz`,
          ...(entry.provenance
            ? {
                attestations: {
                  url: `${ATTESTATIONS}${encodeURIComponent(this.name)}@${version}`,
                  provenance: { predicateType: SLSA },
                },
              }
            : {}),
        },
      };
    }
    return { _id: this.name, name: this.name, "dist-tags": { ...this.distTags }, versions };
  }

  attestations(version: string): Record<string, unknown> | null {
    const entry = this.versions.get(version);
    if (!entry?.provenance) return null;
    const p = entry.provenance;
    const hex = Buffer.from(entry.integrity.replace(/^sha512-/, ""), "base64").toString("hex");
    const statement = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [{ name: `pkg:npm/${encodeURIComponent("@fluent.xyz")}/connect@${version}`,
        digest: { sha512: hex } }],
      predicateType: SLSA,
      predicate: {
        buildDefinition: {
          buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
          externalParameters: {
            workflow: {
              ref: p.ref,
              repository: `https://github.com/${REPOSITORY}`,
              path: p.workflow,
            },
          },
          internalParameters: { github: { event_name: "workflow_dispatch" } },
          resolvedDependencies: [
            { uri: `git+https://github.com/${REPOSITORY}@${p.ref}`, digest: { gitCommit: p.sha } },
          ],
        },
        runDetails: {
          builder: { id: "https://github.com/actions/runner/github-hosted" },
          metadata: {
            invocationId:
              `https://github.com/${REPOSITORY}/actions/runs/${p.runId}/attempts/${p.attempt}`,
          },
        },
      },
    };
    const envelope = (payload: unknown) => ({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(payload)).toString("base64"),
        payloadType: "application/vnd.in-toto+json",
        signatures: [{ sig: "ZmFrZQ==", keyid: "" }],
      },
    });
    return {
      attestations: [
        {
          predicateType: PUBLISH_ATTESTATION,
          bundle: envelope({ ...statement, predicateType: PUBLISH_ATTESTATION, predicate: {} }),
        },
        { predicateType: SLSA, bundle: envelope(statement) },
      ],
    };
  }

  readonly fetch = async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    this.requests.push(url);
    const failure = this.failure;
    if (failure?.kind === "transport") throw failure.error;
    if (failure?.kind === "status") {
      return new Response(JSON.stringify({ error: "fake failure" }), { status: failure.status });
    }
    if (failure?.kind === "json") {
      return new Response("{\"name\": \"@fluent.xyz/connect\", \"versions\": {", { status: 200 });
    }
    const decoded = decodeURIComponent(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (decoded.startsWith(ATTESTATIONS)) {
      const version = decoded.slice(ATTESTATIONS.length).replace(`${this.name}@`, "");
      const body = this.attestations(version);
      return body ? json(body) : json({ error: "Not found" }, 404);
    }
    const prefix = `${REGISTRY}/${this.name}`;
    if (decoded === prefix || decoded === `${prefix}/`) {
      const packument = this.packument();
      return json(failure?.kind === "schema" ? failure.rewrite(packument) : packument);
    }
    if (decoded.startsWith(`${prefix}/`)) {
      const version = decoded.slice(prefix.length + 1);
      const doc = this.packument().versions as Record<string, unknown>;
      return doc[version] ? json(doc[version]) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  };
}

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

export type Answer = "approve" | "reject" | "cancel" | "pending";

/** Everything outside the workflow run: the repository, the registry and their history. */
export interface World {
  commits: Map<string, Tree>;
  branches: Map<string, string>;
  registry: FakeRegistry;
  tags: Map<string, string>;
  releases: Map<string, ReleaseRecord>;
  trace: Mutation[];
  checkpoints: Checkpoint[];
  /** Answers to approval requests, in the order the run asks; an empty queue leaves it waiting. */
  approvals: Answer[];
  /** Exact commands whose step exits nonzero. */
  failingCommands: Set<string>;
  npmFailures: Array<{ version: string; mode: "before_write" | "after_write" }>;
  releaseFailures: string[];
  /** Runs while the n-th approval request waits, before its answer: what changes meanwhile. */
  onApprovalRequested?: (
    request: number,
    world: World,
    run: { artifacts: Map<string, Map<string, Buffer>> },
  ) => void;
  runs: Map<string, RunHistory>;
  /** Every `npm pack`, with the job that ran it. */
  packs: Array<{ job: string; environment: string | null; version: string; integrity: string;
    archive: FakeArchive }>;
  nextRunId: number;
}

/** The job a fake IO acts for, as the runner and the registry see it. */
export interface JobContext {
  runId: string;
  attempt: number;
  job: string;
  workflow: string;
  environment: string | null;
  permissions: Record<string, string>;
  workspace: string;
  ref: string;
  eventSha: string;
  checkoutSha: () => string | null;
  commands: () => Array<{ command: string; manifestVersion: string | null }>;
}

export interface ReleaseIO {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  pack(packageDir: string, destination: string): Promise<string>;
  npmPublish(archive: string, distTag: string): Promise<{ exitCode: number; output: string }>;
  tagTarget(tag: string): Promise<string | null>;
  createTag(tag: string, sha: string): Promise<void>;
  getRelease(tag: string): Promise<ReleaseRecord | null>;
  createRelease(release: ReleaseRecord): Promise<void>;
  runHistory(runId: string): Promise<RunHistory>;
}

export function parseArchive(bytes: Buffer): FakeArchive | null {
  try {
    const archive = JSON.parse(bytes.toString("utf8")) as FakeArchive;
    return archive.format === "fake-npm-pack" ? archive : null;
  } catch {
    return null;
  }
}

export function createFakeIO(world: World, job: JobContext): ReleaseIO {
  const record = (kind: MutationKind, detail: Record<string, unknown>) =>
    world.trace.push({ kind, detail, runId: job.runId, attempt: job.attempt, job: job.job,
      via: "helper" });
  const canWriteContents = () => job.permissions.contents === "write";

  return {
    fetch: (input, init) => world.registry.fetch(input, init),

    async pack(packageDir, destination) {
      const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
        name: string;
        version: string;
      };
      const sha = job.checkoutSha();
      const tracked = sha ? (world.commits.get(sha) ?? {}) : {};
      const buildInput: Record<string, string | null> = {};
      for (const path of Object.keys(tracked)) {
        const file = join(job.workspace, path);
        buildInput[path] = existsSync(file) ? readFileSync(file, "utf8") : null;
      }
      const archive: FakeArchive = {
        format: "fake-npm-pack",
        name: manifest.name,
        version: manifest.version,
        buildInput,
        verifiedBy: job.commands(),
      };
      const bytes = Buffer.from(JSON.stringify(archive));
      const file = join(destination, `fluent.xyz-connect-${manifest.version}.tgz`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      world.packs.push({ job: job.job, environment: job.environment, version: manifest.version,
        integrity: integrityOf(bytes), archive });
      return file;
    },

    async npmPublish(archivePath, distTag) {
      if (!existsSync(archivePath)) {
        record("npm_publish", { archive: archivePath, distTag, version: null });
        return { exitCode: 254, output: `ENOENT: ${relative(job.workspace, archivePath)}` };
      }
      const bytes = readFileSync(archivePath);
      const integrity = integrityOf(bytes);
      const archive = parseArchive(bytes);
      const version = archive?.version ?? null;
      record("npm_publish", { version, distTag, integrity });
      if (!archive || !version) return { exitCode: 1, output: "npm error not a package archive" };
      const trusted =
        job.workflow === "release.yml" &&
        job.environment === "npm-publish" &&
        job.permissions["id-token"] === "write";
      if (!trusted) return { exitCode: 1, output: "npm error code ENEEDAUTH" };
      const failure = world.npmFailures.findIndex((f) => f.version === version);
      const mode = failure >= 0 ? world.npmFailures.splice(failure, 1)[0]?.mode : undefined;
      if (mode === "before_write") return { exitCode: 1, output: "npm error network ETIMEDOUT" };
      if (world.registry.versions.has(version)) {
        return { exitCode: 1, output: `npm error 403 cannot publish over ${version}` };
      }
      world.registry.versions.set(version, {
        integrity,
        provenance: {
          runId: job.runId,
          attempt: job.attempt,
          sha: job.eventSha,
          ref: job.ref,
          workflow: ".github/workflows/release.yml",
        },
      });
      world.registry.distTags[distTag || "latest"] = version;
      if (mode === "after_write") return { exitCode: 1, output: "npm error network ECONNRESET" };
      return { exitCode: 0, output: `+ ${PACKAGE}@${version}` };
    },

    async tagTarget(tag) {
      return world.tags.get(tag) ?? null;
    },

    async createTag(tag, sha) {
      record("git_tag", { tag, sha });
      if (!canWriteContents()) throw new Error("403 Resource not accessible by integration");
      if (world.tags.has(tag)) throw new Error("422 Reference already exists");
      world.tags.set(tag, sha);
    },

    async getRelease(tag) {
      return world.releases.get(tag) ?? null;
    },

    async createRelease(release) {
      record("github_release", { ...release });
      if (!canWriteContents()) throw new Error("403 Resource not accessible by integration");
      const failure = world.releaseFailures.indexOf(release.tag);
      if (failure >= 0) {
        world.releaseFailures.splice(failure, 1);
        throw new Error("502 Bad Gateway");
      }
      if (world.releases.has(release.tag)) throw new Error("422 already_exists");
      if (!world.tags.has(release.tag)) world.tags.set(release.tag, release.target);
      world.releases.set(release.tag, { ...release });
    },

    async runHistory(runId) {
      const history = world.runs.get(runId) ?? { approvals: [], attempts: [] };
      return {
        approvals: history.approvals.map((a) => ({ ...a })),
        attempts: history.attempts.map((a) => ({ ...a })),
      };
    },
  };
}
