/**
 * Runs the repository's actual workflow files against a fake world, far enough to decide what
 * the release criteria need: which workflows an event triggers, which jobs run or are skipped
 * from their `needs` and `if`, what each checkout resolves to, which commands each job runs,
 * how artifacts move between jobs, and what the release helper decides and writes.
 *
 * It is not a GitHub Actions interpreter. A `run` step is understood when it is one of the CI or
 * release verification commands, the npm CLI setup, or one call of the release helper
 * (`node scripts/release/release.ts <phase>`); any other step is recorded in `unsupported`, and
 * a shell step that publishes, tags or creates a Release is recorded in the mutation trace.
 *
 * Runner semantics mirrored, as of 2026-10: a job without a status function in `if` runs only
 * when every job it needs, directly or not, succeeded; a skipped or failed need skips it; a
 * cancelled run still starts jobs whose `if` holds under `cancelled()` or `always()`; a job
 * under an environment waits for a deployment approval, and a rejected approval fails it; the
 * `npm-publish` environment admits `refs/heads/main` only; `actions/checkout` without `ref`
 * checks out the event's commit, also on a re-run; a re-run of failed jobs re-runs them and
 * their dependents with the original commit and keeps the run's artifacts and the outputs of
 * the jobs it does not re-run; `upload-artifact@v4` refuses an existing name unless `overwrite`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { condition, interpolate, stringify, type StatusFunctions } from "./expression.ts";
import { createFakeIO, REPOSITORY, type Answer, type JobContext, type Mutation,
  type MutationKind, type ReleaseIO, type World } from "./fakes.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const HELPER = join(REPO_ROOT, "scripts/release/release.ts");
const MANIFEST = "packages/connect/package.json";

export const CI_COMMANDS = [
  "pnpm install --frozen-lockfile",
  "pnpm exec turbo run build",
  "pnpm exec turbo run typecheck",
  "pnpm exec turbo run test",
  "pnpm --filter @fluent.xyz/connect run lint:pack",
  "pnpm run test:release",
];

export const VERIFY_COMMANDS = [
  "pnpm install --frozen-lockfile",
  "pnpm exec turbo run build --filter=@fluent.xyz/connect...",
  "pnpm exec turbo run typecheck --filter=@fluent.xyz/connect...",
  "pnpm exec turbo run test --filter=@fluent.xyz/connect...",
  "pnpm --filter @fluent.xyz/connect run lint:pack",
];

const NPM_SETUP = /^npm install -g npm@\S+$/;
const HELPER_CALL = /^node\s+(?:--[\w-]+\s+)*scripts\/release\/release\.ts\s+([\w-]+)\s*$/;
const SHELL_MUTATIONS: Array<[RegExp, MutationKind]> = [
  [/\bnpm\s+publish\b/, "npm_publish"],
  [/\bnpm\s+dist-tag\b/, "npm_dist_tag"],
  [/\bgh\s+release\b/, "github_release"],
  [/\bgit\s+tag\b|\bgit\s+push\b|\bgh\s+api\b[^\n]*git\/refs/, "git_tag"],
];

/** The helper's contract with the workflow: one phase per step, its exit code the step's. */
export interface PhaseContext {
  env: Record<string, string | undefined>;
  cwd: string;
  io: ReleaseIO;
  setOutput(name: string, value: string): void;
  log(line: string): void;
}
export type Phase = (context: PhaseContext) => Promise<number>;

export type JobResult = "success" | "failure" | "cancelled" | "skipped" | "waiting";

export interface JobRecord {
  workflow: string;
  id: string;
  name: string;
  result: JobResult;
  environment: string | null;
  attempt: number;
  checkouts: string[];
  commands: Array<{ command: string; manifestVersion: string | null }>;
  phases: string[];
  unsupported: string[];
  outputs: Record<string, string>;
  log: string[];
}

export interface RunResult {
  runId: string;
  attempt: number;
  workflow: string;
  event: WorkflowEvent;
  jobs: JobRecord[];
  approvals: Array<{ job: string; answer: Answer }>;
  outputs: Array<{ job: string; key: string; value: string }>;
  /** The last `state` the helper reported in this attempt. */
  state: string | undefined;
  /** Every `decision` the helper reported in this attempt, in order. */
  decisions: string[];
  /** The last `decision`. */
  decision: string | undefined;
  /** Mutations attempted during this attempt. */
  trace: Mutation[];
  conclusion: "success" | "failure" | "cancelled" | "waiting";
  artifacts: Map<string, Map<string, Buffer>>;
}

export interface WorkflowEvent {
  name: "push" | "pull_request" | "workflow_dispatch";
  /** `refs/heads/<branch>`: the pushed or dispatched branch, or the pull request's base. */
  ref: string;
  sha: string;
  inputs?: Record<string, unknown>;
}

type Doc = Record<string, any>;

export function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
}

export function readWorkflow(file: string): Doc {
  return parse(readFileSync(join(WORKFLOW_DIR, file), "utf8")) as Doc;
}

function branchMatches(patterns: unknown, branch: string): boolean {
  if (patterns === undefined || patterns === null) return true;
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(String);
  return list.some((pattern) => {
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(
        /(?<!\.)\*/g, "[^/]*")}$`,
    );
    return regex.test(branch);
  });
}

/** Whether a workflow's `on` admits the event. */
export function triggers(doc: Doc, event: WorkflowEvent): boolean {
  const on = doc.on ?? doc[true as unknown as string];
  const names: Record<string, any> =
    typeof on === "string"
      ? { [on]: null }
      : Array.isArray(on)
        ? Object.fromEntries(on.map((name: string) => [name, null]))
        : (on ?? {});
  if (!(event.name in names)) return false;
  const filter = names[event.name] ?? {};
  const branch = event.ref.replace(/^refs\/heads\//, "");
  if (event.name === "workflow_dispatch") return true;
  if (filter["branches-ignore"] && branchMatches(filter["branches-ignore"], branch)) return false;
  return branchMatches(filter.branches, branch);
}

function dispatchInputs(doc: Doc, given: Record<string, unknown> = {}): Record<string, unknown> {
  const declared: Record<string, any> = doc.on?.workflow_dispatch?.inputs ?? {};
  const inputs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(declared)) {
    let value = name in given ? given[name] : spec?.default;
    if (spec?.type === "boolean" && typeof value === "string") value = value === "true";
    inputs[name] = value ?? (spec?.type === "boolean" ? false : "");
  }
  return inputs;
}

interface JobInstance {
  id: string;
  name: string;
  spec: Doc;
  matrix: Record<string, unknown>;
}

function expandJobs(doc: Doc): JobInstance[] {
  const instances: JobInstance[] = [];
  for (const [id, spec] of Object.entries<Doc>(doc.jobs ?? {})) {
    const matrix = spec.strategy?.matrix as Record<string, unknown> | undefined;
    const axes = Object.entries(matrix ?? {}).filter(([key]) => !["include", "exclude"].includes(
      key));
    if (axes.length === 0) {
      instances.push({ id, name: String(spec.name ?? id), spec, matrix: {} });
      continue;
    }
    let combos: Array<Record<string, unknown>> = [{}];
    for (const [axis, values] of axes) {
      combos = combos.flatMap((combo) =>
        (values as unknown[]).map((value) => ({ ...combo, [axis]: value })));
    }
    for (const combo of combos) {
      const suffix = Object.values(combo).map(stringify).join(", ");
      instances.push({ id, name: `${String(spec.name ?? id)} (${suffix})`, spec, matrix: combo });
    }
  }
  return instances;
}

function needsOf(spec: Doc): string[] {
  if (!spec.needs) return [];
  return Array.isArray(spec.needs) ? spec.needs.map(String) : [String(spec.needs)];
}

function environmentOf(spec: Doc): string | null {
  if (!spec.environment) return null;
  return typeof spec.environment === "string" ? spec.environment : String(spec.environment.name);
}

function permissionsOf(doc: Doc, spec: Doc): Record<string, string> {
  const merged = spec.permissions ?? doc.permissions ?? {};
  if (typeof merged === "string") {
    return merged === "write-all" ? { contents: "write", "id-token": "write" } : {};
  }
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)]));
}

function filesUnder(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path), readFileSync(path));
    }
  };
  walk(dir);
  return files;
}

function writeTree(root: string, tree: Record<string, string>): void {
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function manifestVersion(workspace: string): string | null {
  const file = join(workspace, MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return String((JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version);
  } catch {
    return null;
  }
}

function scriptLines(script: string): string[] {
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line !== "set -euo pipefail");
}

let phasesPromise: Promise<Record<string, Phase> | null> | null = null;

/** The helper's phases, or null while `scripts/release/release.ts` does not exist. */
async function loadPhases(): Promise<Record<string, Phase> | null> {
  if (!existsSync(HELPER)) return null;
  phasesPromise ??= import(pathToFileURL(HELPER).href).then(
    (module: { phases?: Record<string, Phase> }) => module.phases ?? null,
  );
  return phasesPromise;
}

interface Previous {
  run: RunResult;
}

/** Runs one workflow file for one event, or re-runs a finished run's failed jobs. */
export async function runWorkflow(
  world: World,
  file: string,
  event: WorkflowEvent,
  previous?: Previous,
): Promise<RunResult> {
  const doc = readWorkflow(file);
  const runId = previous?.run.runId ?? String(world.nextRunId++);
  const attempt = (previous?.run.attempt ?? 0) + 1;
  const history = world.runs.get(runId) ?? { approvals: [], attempts: [] };
  world.runs.set(runId, history);
  history.attempts.push({ attempt, conclusion: null });
  const traceStart = world.trace.length;
  const inputs = dispatchInputs(doc, event.inputs);
  const artifacts = previous?.run.artifacts ?? new Map<string, Map<string, Buffer>>();
  const instances = expandJobs(doc);
  const records = new Map<string, JobRecord[]>();
  const result: RunResult = {
    runId, attempt, workflow: file, event, jobs: [], approvals: [], outputs: [],
    state: undefined, decisions: [], decision: undefined, trace: [], conclusion: "success",
    artifacts,
  };
  let cancelled = false;
  let waiting = false;

  const rerun = new Set<string>();
  if (previous) {
    for (const job of previous.run.jobs) {
      if (job.result === "failure" || job.result === "cancelled") rerun.add(job.id);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const instance of instances) {
        if (!rerun.has(instance.id) && needsOf(instance.spec).some((need) => rerun.has(need))) {
          rerun.add(instance.id);
          grew = true;
        }
      }
    }
  }

  const jobResult = (id: string): JobResult | null => {
    const list = records.get(id);
    if (!list || list.length === 0) return null;
    if (list.some((job) => job.result === "failure")) return "failure";
    if (list.some((job) => job.result === "cancelled")) return "cancelled";
    if (list.every((job) => job.result === "skipped")) return "skipped";
    if (list.some((job) => job.result === "waiting")) return "waiting";
    return "success";
  };
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    const spec = (doc.jobs ?? {})[id] as Doc | undefined;
    for (const need of needsOf(spec ?? {})) {
      if (!seen.has(need)) {
        seen.add(need);
        ancestors(need, seen);
      }
    }
    return seen;
  };

  const ordered: JobInstance[] = [];
  const placed = new Set<string>();
  while (ordered.length < instances.length) {
    const before = ordered.length;
    for (const instance of instances) {
      if (ordered.includes(instance)) continue;
      if (needsOf(instance.spec).every((need) => placed.has(need))) ordered.push(instance);
    }
    for (const instance of ordered) {
      if (instances.filter((i) => i.id === instance.id).every((i) => ordered.includes(i))) {
        placed.add(instance.id);
      }
    }
    if (ordered.length === before) throw new Error(`${file}: a job needs a job that never runs`);
  }

  for (const instance of ordered) {
    if (waiting) break;
    const { id, name, spec } = instance;
    const prior = previous?.run.jobs.find((job) => job.name === name);
    if (previous && prior && !rerun.has(id)) {
      records.set(id, [...(records.get(id) ?? []), prior]);
      result.jobs.push(prior);
      continue;
    }
    const needs: Record<string, unknown> = {};
    for (const need of needsOf(spec)) {
      const list = records.get(need) ?? [];
      needs[need] = {
        result: jobResult(need),
        outputs: Object.assign({}, ...list.map((job) => job.outputs)) as Record<string, string>,
      };
    }
    const lineage = [...ancestors(id)];
    const status: StatusFunctions = {
      success: () => !cancelled && lineage.every((need) => jobResult(need) === "success"),
      failure: () => lineage.some((need) => jobResult(need) === "failure"),
      cancelled: () => cancelled,
      always: () => true,
    };
    const job: JobRecord = {
      workflow: file, id, name, result: "success", environment: environmentOf(spec), attempt,
      checkouts: [], commands: [], phases: [], unsupported: [], outputs: {}, log: [],
    };
    records.set(id, [...(records.get(id) ?? []), job]);
    result.jobs.push(job);

    const workspace = mkdtempSync(join(tmpdir(), "release-ws-"));
    const runnerTemp = mkdtempSync(join(tmpdir(), "release-tmp-"));
    const github = {
      ref: event.ref, ref_name: event.ref.replace(/^refs\/heads\//, ""), sha: event.sha,
      event_name: event.name, run_id: runId, run_attempt: String(attempt),
      repository: REPOSITORY, workspace, token: "fake-token", job: id,
      event: { inputs: event.name === "workflow_dispatch" ? inputs : undefined },
    };
    const baseContext: Record<string, unknown> = {
      github, inputs, needs, matrix: instance.matrix, runner: { temp: runnerTemp, os: "Linux" },
      vars: {}, secrets: { GITHUB_TOKEN: "fake-token" },
      env: { ...(doc.env ?? {}) },
    };
    if (!condition(spec.if, baseContext, status)) {
      job.result = "skipped";
      continue;
    }

    if (job.environment === "npm-publish" && event.ref !== "refs/heads/main") {
      job.log.push("Branch is not allowed to deploy to npm-publish due to environment rules");
      job.result = "failure";
      continue;
    }
    if (job.environment) {
      const request = result.approvals.length + 1;
      world.checkpoints.push({ name: "approval_requested", at: world.trace.length, runId,
        attempt, job: name });
      world.onApprovalRequested?.(request, world, result);
      const answer = world.approvals.shift() ?? "pending";
      result.approvals.push({ job: name, answer });
      if (answer === "pending") {
        job.result = "waiting";
        waiting = true;
        break;
      }
      if (answer === "reject" || answer === "cancel") {
        world.checkpoints.push({ name: answer === "reject" ? "approval_rejected" : "cancelled",
          at: world.trace.length, runId, attempt, job: name });
        if (answer === "reject") {
          history.approvals.push({ state: "rejected", environment: job.environment, job: name });
          job.result = "failure";
        } else {
          job.result = "cancelled";
          cancelled = true;
        }
        continue;
      }
      history.approvals.push({ state: "approved", environment: job.environment, job: name });
    }

    let checkoutSha: string | null = null;
    const steps = (spec.steps ?? []) as Doc[];
    const stepsContext: Record<string, { outputs: Record<string, string>; outcome: string;
      conclusion: string }> = {};
    let failed = false;
    const jobContext: JobContext = {
      runId, attempt, job: name, workflow: file, environment: job.environment,
      permissions: permissionsOf(doc, spec), workspace, ref: event.ref, eventSha: event.sha,
      checkoutSha: () => checkoutSha, commands: () => job.commands.map((c) => ({ ...c })),
    };
    const io = createFakeIO(world, jobContext);

    for (const step of steps) {
      // Cancellation happens only at an approval gate here, between jobs, so a job that still
      // starts (through `always()` or `cancelled()`) runs its steps on their own outcomes.
      const stepStatus: StatusFunctions = {
        success: () => !failed,
        failure: () => failed,
        cancelled: () => cancelled,
        always: () => true,
      };
      const context = { ...baseContext, steps: stepsContext,
        env: { ...(doc.env ?? {}), ...(spec.env ?? {}), ...(step.env ?? {}) } };
      if (!condition(step.if, context, stepStatus)) continue;
      const outputs: Record<string, string> = {};
      let ok = true;
      const withArgs = Object.fromEntries(Object.entries<unknown>(step.with ?? {}).map(
        ([key, value]) => [key, interpolate(value, context, stepStatus)]));

      if (typeof step.uses === "string") {
        const action = step.uses.split("@")[0];
        if (action === "actions/checkout") {
          const ref = withArgs.ref === undefined || withArgs.ref === "" ? null
            : stringify(withArgs.ref);
          let sha = event.sha;
          if (ref !== null) {
            const branch = ref.replace(/^refs\/heads\//, "");
            sha = /^[0-9a-f]{40}$/.test(ref) ? ref : (world.branches.get(branch) ?? ref);
          }
          const tree = world.commits.get(sha);
          if (!tree) {
            ok = false;
            job.log.push(`checkout: unknown ref ${sha}`);
          } else {
            writeTree(workspace, tree);
            checkoutSha = sha;
            job.checkouts.push(sha);
          }
        } else if (action === "actions/upload-artifact") {
          const artifactName = stringify(withArgs.name ?? "artifact");
          const paths = stringify(withArgs.path).split("\n").map((p) => p.trim()).filter(Boolean);
          const files = new Map<string, Buffer>();
          for (const path of paths) {
            if (/[*?]/.test(path)) {
              job.unsupported.push(`upload-artifact glob ${path}`);
              continue;
            }
            const absolute = isAbsolute(path) ? path : join(workspace, path);
            if (!existsSync(absolute)) continue;
            if (statSync(absolute).isDirectory()) {
              for (const [rel, bytes] of filesUnder(absolute)) {
                files.set(paths.length === 1 ? rel : join(basename(absolute), rel), bytes);
              }
            } else {
              files.set(basename(absolute), readFileSync(absolute));
            }
          }
          if (files.size === 0) {
            if (withArgs["if-no-files-found"] === "error") ok = false;
          } else if (artifacts.has(artifactName) && withArgs.overwrite !== true) {
            ok = false;
            job.log.push(`upload-artifact: an artifact named ${artifactName} already exists`);
          } else {
            artifacts.set(artifactName, files);
          }
        } else if (action === "actions/download-artifact") {
          const target = withArgs.path ? stringify(withArgs.path) : workspace;
          const absolute = isAbsolute(target) ? target : join(workspace, target);
          const names = withArgs.name ? [stringify(withArgs.name)] : [...artifacts.keys()];
          for (const artifactName of names) {
            const files = artifacts.get(artifactName);
            if (!files) {
              ok = false;
              job.log.push(`download-artifact: artifact not found: ${artifactName}`);
              continue;
            }
            const root = withArgs.name ? absolute : join(absolute, artifactName);
            for (const [rel, bytes] of files) {
              mkdirSync(dirname(join(root, rel)), { recursive: true });
              writeFileSync(join(root, rel), bytes);
            }
          }
        } else if (!["pnpm/action-setup", "actions/setup-node"].includes(action ?? "")) {
          job.unsupported.push(`uses: ${step.uses}`);
        }
      } else if (typeof step.run === "string") {
        const script = stringify(interpolate(step.run, context, stepStatus));
        const lines = scriptLines(script);
        const only = lines.length === 1 ? (lines[0] as string) : null;
        const helper = only ? HELPER_CALL.exec(only) : null;
        const env: Record<string, string | undefined> = {
          CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPOSITORY,
          GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_SHA: event.sha,
          GITHUB_REF: event.ref, GITHUB_REF_NAME: github.ref_name, GITHUB_EVENT_NAME: event.name,
          GITHUB_JOB: id, GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp,
          GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/${file}@${event.ref}`,
          GITHUB_EVENT_PATH: join(runnerTemp, "event.json"),
        };
        writeFileSync(env.GITHUB_EVENT_PATH as string, JSON.stringify({
          ref: event.ref, inputs: event.name === "workflow_dispatch" ? inputs : undefined,
        }));
        for (const [key, value] of Object.entries<unknown>(context.env)) {
          env[key] = stringify(interpolate(value, context, stepStatus));
        }
        if (helper) {
          const phase = helper[1] as string;
          job.phases.push(phase);
          job.commands.push({ command: `release.ts ${phase}`,
            manifestVersion: manifestVersion(workspace) });
          const phases = await loadPhases();
          const run = phases?.[phase];
          if (!run) {
            ok = false;
            job.unsupported.push(`release.ts has no phase ${phase}`);
          } else {
            let code = 1;
            try {
              code = await run({
                env, cwd: workspace, io,
                setOutput: (key, value) => {
                  outputs[key] = value;
                  result.outputs.push({ job: name, key, value });
                  if (key === "state") result.state = value;
                  if (key === "decision") {
                    result.decisions.push(value);
                    result.decision = value;
                  }
                  if ((key === "state" || key === "decision") &&
                    ["blocked", "abandoned"].includes(value)) {
                    world.checkpoints.push({ name: `${key}:${value}`, at: world.trace.length,
                      runId, attempt, job: name });
                  }
                },
                log: (line) => job.log.push(line),
              });
            } catch (error) {
              job.log.push(`release.ts ${phase} threw: ${String(error)}`);
            }
            ok = code === 0;
          }
        } else if (only && (CI_COMMANDS.includes(only) || VERIFY_COMMANDS.includes(only))) {
          job.commands.push({ command: only, manifestVersion: manifestVersion(workspace) });
          ok = !world.failingCommands.has(only);
        } else if (only && NPM_SETUP.test(only)) {
          job.commands.push({ command: only, manifestVersion: manifestVersion(workspace) });
        } else {
          job.unsupported.push(script);
          for (const [pattern, kind] of SHELL_MUTATIONS) {
            if (pattern.test(script)) {
              world.trace.push({ kind, detail: { script }, runId, attempt, job: name,
                via: "shell" });
            }
          }
        }
      } else {
        job.unsupported.push(JSON.stringify(step));
      }

      if (typeof step.id === "string") {
        stepsContext[step.id] = { outputs, outcome: ok ? "success" : "failure",
          conclusion: ok ? "success" : "failure" };
      }
      if (!ok && step["continue-on-error"] !== true) failed = true;
    }

    const outputContext = { ...baseContext, steps: stepsContext };
    for (const [key, value] of Object.entries<unknown>(spec.outputs ?? {})) {
      job.outputs[key] = stringify(interpolate(value, outputContext, status));
    }
    job.result = failed ? "failure" : "success";
  }

  result.trace = world.trace.slice(traceStart);
  result.conclusion = waiting
    ? "waiting"
    : cancelled
      ? "cancelled"
      : result.jobs.some((job) => job.result === "failure")
        ? "failure"
        : "success";
  const entry = history.attempts.find((a) => a.attempt === attempt);
  if (entry) entry.conclusion = waiting ? null : result.conclusion;
  return result;
}

/** Every workflow the event triggers, each run to its end. */
export async function runEvent(world: World, event: WorkflowEvent): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (const file of workflowFiles()) {
    if (triggers(readWorkflow(file), event)) runs.push(await runWorkflow(world, file, event));
  }
  return runs;
}

/** `gh workflow run <file> --ref <branch>`: the dispatch resolves the branch to its head once. */
export async function dispatch(
  world: World,
  options: { ref?: string; inputs?: Record<string, unknown>; file?: string } = {},
): Promise<RunResult> {
  const ref = options.ref ?? "refs/heads/main";
  const sha = world.branches.get(ref.replace(/^refs\/heads\//, ""));
  if (!sha) throw new Error(`no branch ${ref}`);
  const event: WorkflowEvent = { name: "workflow_dispatch", ref, sha, inputs: options.inputs };
  const file = options.file ?? "release.yml";
  if (!existsSync(join(WORKFLOW_DIR, file)) || !triggers(readWorkflow(file), event)) {
    return {
      runId: "none", attempt: 0, workflow: file, event, jobs: [], approvals: [], outputs: [],
      state: undefined, decisions: [], decision: undefined, trace: [], conclusion: "failure",
      artifacts: new Map(),
    };
  }
  return runWorkflow(world, file, event);
}

/** `gh run rerun <run-id> --failed`. */
export async function rerunFailed(world: World, run: RunResult): Promise<RunResult> {
  if (run.attempt === 0) return run;
  return runWorkflow(world, run.workflow, run.event, { run });
}

/** Mutations attempted after the first checkpoint with this name, across every later attempt. */
export function traceAfter(world: World, name: string): Mutation[] | null {
  const checkpoint = world.checkpoints.find((c) => c.name === name);
  return checkpoint ? world.trace.slice(checkpoint.at) : null;
}
