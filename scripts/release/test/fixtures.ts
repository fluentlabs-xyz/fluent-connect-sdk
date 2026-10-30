/**
 * The worlds the release tests start from: a repository whose `main` points at commit A, with
 * the published manifest's other fields kept, and a registry that holds `@fluent.xyz/connect`
 * up to 0.5.3 as `latest`, each version published by an earlier run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeRegistry, type Answer, type Tree, type World } from "./fakes.ts";
import { REPO_ROOT } from "./workflow.ts";

export const A = "a".repeat(40);
export const B = "b".repeat(40);
export const LATEST = "0.5.3";
export const MANIFEST = "packages/connect/package.json";

const REAL_MANIFEST = readFileSync(join(REPO_ROOT, MANIFEST), "utf8");

/** A tracked tree whose manifest carries `version`; `marker` tells two commits apart. */
export function treeAt(version: string, marker: string): Tree {
  return {
    [MANIFEST]: REAL_MANIFEST.replace(/"version": "[^"]*"/, `"version": "${version}"`),
    "pnpm-lock.yaml": `lockfileVersion: '9.0'\n# lockfile at ${marker}\n`,
    "packages/connect/src/index.ts": `import "./polyfills/buffer";\n// source at ${marker}\n`,
    "packages/connect/README.md": `# @fluent.xyz/connect at ${marker}\n`,
  };
}

export interface WorldOptions {
  /** The manifest version at A. */
  version: string;
  approvals?: Answer[];
  /** Versions published before the run, besides 0.4.0 to 0.5.3. */
  published?: string[];
}

export function createWorld(options: WorldOptions): World {
  const registry = new FakeRegistry();
  for (const version of ["0.4.0", "0.5.0", "0.5.1", "0.5.2", LATEST, ...(options.published ??
    [])]) {
    registry.publishedElsewhere(version);
  }
  registry.distTags.latest = LATEST;
  return {
    commits: new Map([[A, treeAt(options.version, "A")]]),
    branches: new Map([["main", A]]),
    registry,
    tags: new Map([[`v${LATEST}`, "c".repeat(40)]]),
    releases: new Map(),
    trace: [],
    checkpoints: [],
    approvals: [...(options.approvals ?? [])],
    failingCommands: new Set(),
    npmFailures: [],
    releaseFailures: [],
    runs: new Map(),
    packs: [],
    nextRunId: 5000,
  };
}

/** Advances `main` to B, whose manifest and source differ from A. */
export function advanceMain(world: World, version = "0.7.0"): void {
  world.commits.set(B, treeAt(version, "B"));
  world.branches.set("main", B);
}
