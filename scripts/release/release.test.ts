/**
 * The release protocol, observed through `.github/workflows/release.yml` as dispatched with
 * `gh workflow run release.yml --ref main`: the jobs its `needs` and `if` admit, the commit each
 * checkout resolves to, the archives its artifacts carry between jobs, and what the release
 * helper (`scripts/release/release.ts`) decides and writes in them.
 *
 * Fakes: the npm registry and `npm publish`/`npm pack`, Git tags and GitHub Releases, deployment
 * approvals and the run history (`test/fakes.ts`). The helper reports through step outputs:
 * `state` (the run's state), `decision` (a publication decision), and on a dry run `sha`,
 * `version`, `channel` (`stable` or `rc`), `publishable` and `reason`. A receipt is a run-artifact
 * file named `*receipt.json` holding `runId`, `sourceSha`, `version`, `distTag` and `integrity`.
 */
import { describe, expect, it } from "vitest";
import { integrityOf, type FakeArchive, type World } from "./test/fakes.ts";
import { A, advanceMain, createWorld, LATEST, MANIFEST, treeAt } from "./test/fixtures.ts";
import { dispatch, rerunFailed, traceAfter, VERIFY_COMMANDS,
  type RunResult } from "./test/workflow.ts";

type Inputs = { expected_version?: string; dry_run?: boolean };

const publishInputs = (version: string): Inputs => ({ expected_version: version,
  dry_run: false });

function npmPublishes(world: World, version?: string) {
  return world.trace.filter(
    (m) => m.kind === "npm_publish" && (version === undefined || m.detail.version === version),
  );
}

function metadataWrites(world: World) {
  return world.trace.filter((m) => m.kind === "git_tag" || m.kind === "github_release");
}

function gatedJobs(run: RunResult) {
  return run.jobs.filter((job) => job.environment === "npm-publish");
}

function receipts(run: RunResult): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const files of run.artifacts.values()) {
    for (const [path, bytes] of files) {
      if (path.endsWith("receipt.json")) {
        found.push(JSON.parse(bytes.toString("utf8")) as Record<string, unknown>);
      }
    }
  }
  return found;
}

/** The archive npm received for `version`, recovered from the pack that produced its bytes. */
function publishedArchive(world: World, version: string): FakeArchive | undefined {
  const publish = npmPublishes(world, version).at(-1);
  return world.packs.find((p) => p.integrity === publish?.detail.integrity)?.archive;
}

async function directStable(options: { approvals?: World["approvals"] } = {}) {
  const world = createWorld({ version: "0.6.0", approvals: options.approvals ?? ["approve"] });
  const run = await dispatch(world, { inputs: publishInputs("0.6.0") });
  return { world, run };
}

/** 0.6.0-rc.1 published under next, then promoted to 0.6.0; main moves to B meanwhile. */
async function candidate(approvals: World["approvals"], advanceAt = 2) {
  const world = createWorld({ version: "0.6.0-rc.1", approvals });
  const latestBefore = world.registry.distTags.latest;
  world.onApprovalRequested = (request, w) => {
    if (request === advanceAt) advanceMain(w);
  };
  const run = await dispatch(world, { inputs: publishInputs("0.6.0-rc.1") });
  return { world, run, latestBefore };
}

function expectBlocked(world: World, run: RunResult) {
  expect(run.state).toBe("blocked");
  expect(run.decision).toBe("blocked");
  expect(npmPublishes(world)).toEqual([]);
  expect(metadataWrites(world)).toEqual([]);
  expect(traceAfter(world, "state:blocked") ?? traceAfter(world, "decision:blocked")).toEqual([]);
}

function manifestDiff(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((key) =>
    manifestDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key],
      `${path}/${key}`));
}

describe("DIRECT", () => {
  it("a direct stable release skips the RC jobs, gets its own approval and ends published",
    async () => {
      const { world, run } = await directStable();
      expect(run.state).toBe("published");
      expect(run.approvals).toEqual([{ job: expect.any(String), answer: "approve" }]);
      const gated = gatedJobs(run);
      expect(gated.filter((job) => job.result === "success")).toHaveLength(1);
      expect(gated.filter((job) => job.result === "skipped").length).toBeGreaterThan(0);
      expect(npmPublishes(world, "0.6.0")).toHaveLength(1);
      expect(world.registry.versions.has("0.6.0")).toBe(true);
      expect(world.tags.get("v0.6.0")).toBe(A);
      expect(world.releases.get("v0.6.0")).toMatchObject({ target: A, prerelease: false });
    });
});

describe("PIN", () => {
  it("every checkout of an RC promotion resolves to the dispatch SHA after main moves to B",
    async () => {
      const { world, run } = await candidate(["approve", "approve"], 2);
      expect(world.branches.get("main")).not.toBe(A);
      const checkouts = run.jobs.flatMap((job) => job.checkouts);
      expect(checkouts.length).toBeGreaterThan(0);
      expect(new Set(checkouts)).toEqual(new Set([A]));
      expect(run.state).toBe("published");
    });

  it("every checkout of a same-run retry resolves to the dispatch SHA after main moves to B",
    async () => {
      const world = createWorld({ version: "0.6.0", approvals: ["approve", "approve"] });
      world.npmFailures.push({ version: "0.6.0", mode: "after_write" });
      const first = await dispatch(world, { inputs: publishInputs("0.6.0") });
      advanceMain(world);
      const retry = await rerunFailed(world, first);
      const checkouts = [...first.jobs, ...retry.jobs].flatMap((job) => job.checkouts);
      expect(checkouts.length).toBeGreaterThan(0);
      expect(new Set(checkouts)).toEqual(new Set([A]));
      expect(retry.attempt).toBe(2);
    });
});

describe("TAG-SHA", () => {
  it("the direct stable version tag and Release target the dispatch SHA", async () => {
    const { world } = await directStable();
    expect(world.tags.get("v0.6.0")).toBe(A);
    expect(world.releases.get("v0.6.0")?.target).toBe(A);
  });

  it("both RC promotion tags target the dispatch SHA although main moved to B", async () => {
    const { world } = await candidate(["approve", "approve"], 1);
    expect(world.tags.get("v0.6.0-rc.1")).toBe(A);
    expect(world.tags.get("v0.6.0")).toBe(A);
    expect(world.registry.versions.get("0.6.0")?.provenance?.sha).toBe(A);
  });
});

describe("TAG-STABLE", () => {
  it("the direct stable publication uses the npm dist-tag latest", async () => {
    const { world } = await directStable();
    expect(npmPublishes(world, "0.6.0").map((m) => m.detail.distTag)).toEqual(["latest"]);
    expect(world.registry.distTags.latest).toBe("0.6.0");
  });
});

describe("TAG-RC", () => {
  it("the candidate publication uses the npm dist-tag next", async () => {
    const { world } = await candidate(["approve", "pending"]);
    expect(npmPublishes(world, "0.6.0-rc.1").map((m) => m.detail.distTag)).toEqual(["next"]);
    expect(world.registry.distTags.next).toBe("0.6.0-rc.1");
  });
});

describe("RC-LATEST", () => {
  it("the latest dist-tag after candidate publication equals its value before", async () => {
    const { world, latestBefore } = await candidate(["approve", "pending"]);
    expect(world.registry.versions.has("0.6.0-rc.1")).toBe(true);
    expect(latestBefore).toBe(LATEST);
    expect(world.registry.distTags.latest).toBe(latestBefore);
  });
});

describe("GH-RC", () => {
  it("the candidate GitHub Release is a prerelease", async () => {
    const { world } = await candidate(["approve", "pending"]);
    expect(world.releases.get("v0.6.0-rc.1")).toMatchObject({ target: A, prerelease: true });
  });
});

describe("APPROVAL", () => {
  it("a published candidate enters awaiting_stable_approval at a second, separate approval",
    async () => {
      const { world, run } = await candidate(["approve", "pending"]);
      expect(run.state).toBe("awaiting_stable_approval");
      expect(run.approvals.map((a) => a.answer)).toEqual(["approve", "pending"]);
      expect(run.approvals[0]?.job).not.toBe(run.approvals[1]?.job);
      expect(world.registry.versions.has("0.6.0-rc.1")).toBe(true);
      expect(world.registry.versions.has("0.6.0")).toBe(false);
      expect(npmPublishes(world, "0.6.0")).toEqual([]);
    });
});

describe("SNAPSHOT", () => {
  it("the stable build's tracked source differs from A only in the manifest version",
    async () => {
      const { world, run } = await candidate(["approve", "approve"], 2);
      expect(run.state).toBe("published");
      const archive = publishedArchive(world, "0.6.0");
      expect(archive).toBeDefined();
      const atA = treeAt("0.6.0-rc.1", "A");
      const input = archive?.buildInput ?? {};
      expect(Object.keys(input).sort()).toEqual(Object.keys(atA).sort());
      const changed = Object.keys(atA).filter((path) => input[path] !== atA[path]);
      expect(changed).toEqual([MANIFEST]);
      expect(manifestDiff(JSON.parse(atA[MANIFEST] as string),
        JSON.parse(input[MANIFEST] ?? "null"))).toEqual(["/version"]);
      const verifiedBy = archive?.verifiedBy ?? [];
      expect(verifiedBy.map((c) => c.command)).toContain(VERIFY_COMMANDS[0]);
      const rebuilt = verifiedBy.filter((c) => VERIFY_COMMANDS.slice(1).includes(c.command));
      expect(rebuilt.map((c) => c.command)).toEqual(VERIFY_COMMANDS.slice(1));
      expect(new Set(rebuilt.map((c) => c.manifestVersion))).toEqual(new Set(["0.6.0"]));
    });
});

describe("PROMOTED-VERSION", () => {
  it("the promoted package version equals the candidate's base version", async () => {
    const { world } = await candidate(["approve", "approve"]);
    const archive = publishedArchive(world, "0.6.0");
    expect(archive?.version).toBe("0.6.0");
    expect(npmPublishes(world).map((m) => m.detail.version)).toEqual(["0.6.0-rc.1", "0.6.0"]);
    expect(world.registry.distTags.latest).toBe("0.6.0");
  });
});

describe("CANCEL", () => {
  it.each([
    ["at its stable approval", ["approve", "cancel"]],
    ["at its RC approval", ["cancel"]],
  ] as const)("a candidate cancelled %s reaches the terminal state abandoned",
    async (_, approvals) => {
      const { world, run } = await candidate([...approvals]);
      expect(run.state).toBe("abandoned");
      expect(world.registry.versions.has("0.6.0")).toBe(false);
    });
});

const abandonments: Array<[string, () => Promise<{ world: World; checkpoint: string }>]> = [
  ["a rejected direct stable approval", async () => {
    const { world } = await directStable({ approvals: ["reject"] });
    return { world, checkpoint: "approval_rejected" };
  }],
  ["a rejected stable promotion", async () => {
    const { world } = await candidate(["approve", "reject"]);
    return { world, checkpoint: "approval_rejected" };
  }],
  ["a cancelled stable promotion", async () => {
    const { world } = await candidate(["approve", "cancel"]);
    return { world, checkpoint: "cancelled" };
  }],
  ["a retry of a rejected stable promotion", async () => {
    const { world, run } = await candidate(["approve", "reject", "approve"]);
    await rerunFailed(world, run);
    return { world, checkpoint: "approval_rejected" };
  }],
];

describe("ABANDONED-WRITES", () => {
  it.each(abandonments)("%s attempts no external write after abandonment", async (_, scenario) => {
    const { world, checkpoint } = await scenario();
    expect(traceAfter(world, checkpoint)).toEqual([]);
  });

  it("an abandoned candidate keeps the RC writes completed before abandonment", async () => {
    const { world } = await candidate(["approve", "reject"]);
    expect(npmPublishes(world, "0.6.0-rc.1")).toHaveLength(1);
    expect(world.releases.get("v0.6.0-rc.1")?.prerelease).toBe(true);
  });
});

describe("INPUT", () => {
  it.each([
    ["a dispatch from a branch other than main", "0.6.0",
      { ref: "refs/heads/feature", inputs: publishInputs("0.6.0") }],
    ["a missing expected_version", "0.6.0", { inputs: { dry_run: false } }],
    ["an expected_version that differs from the manifest", "0.6.0",
      { inputs: publishInputs("0.6.1") }],
    ["an invalid manifest version", "0.6", { inputs: publishInputs("0.6") }],
    ["an unsupported prerelease", "0.6.0-beta.1", { inputs: publishInputs("0.6.0-beta.1") }],
    ["an RC without a number", "0.6.0-rc", { inputs: publishInputs("0.6.0-rc") }],
    ["a dry run with a mismatched version", "0.6.0",
      { inputs: { expected_version: "0.6.1", dry_run: true } }],
  ] as const)("%s produces blocked", async (_, version, options) => {
    const world = createWorld({ version, approvals: ["approve", "approve"] });
    world.branches.set("feature", A);
    const run = await dispatch(world, { ...options, inputs: { ...options.inputs } });
    expectBlocked(world, run);
  });
});

describe("NEW-VERSION", () => {
  it.each([
    ["a stable target equal to latest", LATEST, []],
    ["an RC whose base is below latest", "0.5.2-rc.1", []],
    ["a stable target below latest that was never published", "0.4.5", []],
    ["an RC whose base is at latest", "0.5.3-rc.1", []],
    ["a stable version published by another run", "0.6.0", ["0.6.0"]],
    ["an RC version published by another run", "0.6.0-rc.1", ["0.6.0-rc.1"]],
    ["an RC whose stable version another run published", "0.6.0-rc.1", ["0.6.0"]],
  ] as const)("%s produces blocked", async (_, version, published) => {
    const world = createWorld({ version, published: [...published],
      approvals: ["approve", "approve"] });
    const run = await dispatch(world, { inputs: publishInputs(version) });
    expect(run.state).toBe("blocked");
    expect(run.decision).toBe("blocked");
    expect(npmPublishes(world)).toEqual([]);
    expect(metadataWrites(world)).toEqual([]);
  });
});

async function withRegistryFailure(failure: World["registry"]["failure"]) {
  const world = createWorld({ version: "0.6.0", approvals: ["approve"] });
  world.registry.failure = failure;
  const run = await dispatch(world, { inputs: publishInputs("0.6.0") });
  return { world, run };
}

describe("REGISTRY-TRANSPORT", () => {
  it.each([
    ["a timeout", Object.assign(new Error("The operation was aborted due to timeout"),
      { name: "TimeoutError" })],
    ["a connection failure", new TypeError("fetch failed")],
  ])("%s before any HTTP response produces blocked", async (_, error) => {
    const { world, run } = await withRegistryFailure({ kind: "transport", error });
    expectBlocked(world, run);
  });
});

describe("REGISTRY-HTTP", () => {
  it.each([404, 500, 503, 429])("HTTP %i from the registry produces blocked", async (status) => {
    const { world, run } = await withRegistryFailure({ kind: "status", status });
    expectBlocked(world, run);
  });
});

describe("REGISTRY-JSON", () => {
  it("a registry response that is not valid JSON produces blocked", async () => {
    const { world, run } = await withRegistryFailure({ kind: "json" });
    expectBlocked(world, run);
  });
});

describe("REGISTRY-SCHEMA", () => {
  const without = (key: string) => (doc: Record<string, unknown>) => {
    const copy = { ...doc };
    delete copy[key];
    return copy;
  };
  it.each([
    ["a body that is not an object", () => ["@fluent.xyz/connect"]],
    ["a missing package name", without("name")],
    ["another package's name", (doc: Record<string, unknown>) => ({ ...doc, name: "connect" })],
    ["a missing versions map", without("versions")],
    ["a versions value that is not an object", (doc: Record<string, unknown>) => ({ ...doc,
      versions: ["0.5.3"] })],
    ["missing dist-tags", without("dist-tags")],
    ["a missing latest", (doc: Record<string, unknown>) => ({ ...doc, "dist-tags": {} })],
    ["a latest that is not a version", (doc: Record<string, unknown>) => ({ ...doc,
      "dist-tags": { latest: "banana" } })],
    ["a prerelease latest", (doc: Record<string, unknown>) => ({ ...doc,
      "dist-tags": { latest: "0.5.3-rc.1" } })],
  ])("registry metadata with %s produces blocked", async (_, rewrite) => {
    const { world, run } = await withRegistryFailure({ kind: "schema", rewrite });
    expectBlocked(world, run);
  });
});

describe("VERIFY", () => {
  it.each(VERIFY_COMMANDS.slice(1))("a failing `%s` makes the publication decision blocked",
    async (command) => {
      const world = createWorld({ version: "0.6.0", approvals: ["approve"] });
      world.failingCommands.add(command);
      const run = await dispatch(world, { inputs: publishInputs("0.6.0") });
      expect(run.decision).toBe("blocked");
      expect(run.state).toBe("blocked");
      expect(npmPublishes(world)).toEqual([]);
      expect(run.approvals).toEqual([]);
    });
});

describe("VERIFY-JOB", () => {
  it.each([
    ["direct stable", "0.6.0"],
    ["RC", "0.6.0-rc.1"],
  ])("after failed verification every %s publishing job is skipped", async (_, version) => {
    const world = createWorld({ version, approvals: ["approve", "approve"] });
    world.failingCommands.add("pnpm exec turbo run test --filter=@fluent.xyz/connect...");
    const run = await dispatch(world, { inputs: publishInputs(version) });
    const gated = gatedJobs(run);
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.map((job) => job.result)).toEqual(gated.map(() => "skipped"));
  });
});

/** Changes the run's artifacts while the first approval waits. */
function tamper(world: World, change: (files: Map<string, Buffer>) => void) {
  world.onApprovalRequested = (request, _w, run) => {
    if (request !== 1) return;
    for (const files of run.artifacts.values()) change(files);
  };
}

describe("ARTIFACT", () => {
  it.each([
    ["a missing archive", (files: Map<string, Buffer>) => {
      for (const path of [...files.keys()]) if (path.endsWith(".tgz")) files.delete(path);
    }],
    ["a missing receipt", (files: Map<string, Buffer>) => {
      for (const path of [...files.keys()]) if (path.endsWith("receipt.json")) files.delete(path);
    }],
    ["an archive whose digest differs from its receipt", (files: Map<string, Buffer>) => {
      for (const [path, bytes] of files) {
        if (path.endsWith(".tgz")) files.set(path, Buffer.concat([bytes, Buffer.from(" ")]));
      }
    }],
  ])("%s produces blocked", async (_, change) => {
    const world = createWorld({ version: "0.6.0", approvals: ["approve"] });
    tamper(world, change);
    const run = await dispatch(world, { inputs: publishInputs("0.6.0") });
    expectBlocked(world, run);
  });
});

describe("REVIEW", () => {
  it.each([
    ["a rejected direct stable approval", "0.6.0", ["reject"]],
    ["a rejected RC approval", "0.6.0-rc.1", ["reject"]],
    ["a rejected stable promotion", "0.6.0-rc.1", ["approve", "reject"]],
    ["a cancelled stable promotion", "0.6.0-rc.1", ["approve", "cancel"]],
  ] as const)("%s blocks publication and abandons the candidate", async (_, version, answers) => {
    const world = createWorld({ version, approvals: [...answers] });
    const run = await dispatch(world, { inputs: publishInputs(version) });
    expect(run.decision).toBe("blocked");
    expect(run.state).toBe("abandoned");
    expect(world.registry.versions.has(version.replace(/-rc\.\d+$/, ""))).toBe(false);
  });

  it("a retry of an abandoned previous attempt cannot resume stable promotion", async () => {
    const { world, run } = await candidate(["approve", "reject", "approve"]);
    const retry = await rerunFailed(world, run);
    expect(retry.attempt).toBe(2);
    expect(retry.decision).toBe("blocked");
    expect(retry.state).toBe("abandoned");
    expect(retry.trace.filter((m) => m.kind === "npm_publish")).toEqual([]);
    expect(world.registry.versions.has("0.6.0")).toBe(false);
  });
});

describe("RACE", () => {
  it.each([
    ["a direct stable release", "0.6.0", ["approve"], 1, "0.6.0"],
    ["an RC publication", "0.6.0-rc.1", ["approve", "approve"], 1, "0.6.0-rc.1"],
    ["a stable promotion", "0.6.0-rc.1", ["approve", "approve"], 2, "0.6.0"],
  ] as const)("a version another run publishes during the approval wait of %s produces blocked",
    async (_, version, answers, request, conflicting) => {
      const world = createWorld({ version, approvals: [...answers] });
      world.onApprovalRequested = (n, w) => {
        if (n === request) w.registry.publishedElsewhere(conflicting, undefined, "4242");
      };
      const run = await dispatch(world, { inputs: publishInputs(version) });
      expect(run.state).toBe("blocked");
      expect(run.decision).toBe("blocked");
      expect(npmPublishes(world, conflicting)).toEqual([]);
      expect(traceAfter(world, "state:blocked") ?? traceAfter(world, "decision:blocked"))
        .toEqual([]);
    });
});

describe("TAG-CONFLICT", () => {
  it.each([
    ["v0.6.0", "0.6.0"],
    ["v0.6.0-rc.1", "0.6.0-rc.1"],
  ])("an existing %s tag on another commit produces blocked", async (tag, version) => {
    const world = createWorld({ version, approvals: ["approve", "approve"] });
    world.tags.set(tag, "d".repeat(40));
    const run = await dispatch(world, { inputs: publishInputs(version) });
    expectBlocked(world, run);
    expect(world.tags.get(tag)).toBe("d".repeat(40));
  });
});

/** Attempt 1 publishes 0.6.0 but npm exits nonzero, so the run waits for reconciliation. */
async function ambiguousPublication() {
  const world = createWorld({ version: "0.6.0", approvals: ["approve", "approve"] });
  world.npmFailures.push({ version: "0.6.0", mode: "after_write" });
  const first = await dispatch(world, { inputs: publishInputs("0.6.0") });
  return { world, first };
}

describe("PUBLISH-ERROR", () => {
  it.each(["after_write", "before_write"] as const)(
    "a nonzero npm publish exit (%s) enters reconcile_required without another write",
    async (mode) => {
      const world = createWorld({ version: "0.6.0", approvals: ["approve"] });
      world.npmFailures.push({ version: "0.6.0", mode });
      const run = await dispatch(world, { inputs: publishInputs("0.6.0") });
      expect(run.state).toBe("reconcile_required");
      expect(run.trace.filter((m) => m.kind === "npm_publish")).toHaveLength(1);
      expect(run.trace.filter((m) => m.kind !== "npm_publish")).toEqual([]);
    });
});

const retries: Array<[string, () => Promise<{ world: World; first: RunResult }>]> = [
  ["an ambiguous npm exit after the write", ambiguousPublication],
  ["a failed Release after a completed publication", async () => {
    const world = createWorld({ version: "0.6.0", approvals: ["approve", "approve"] });
    world.releaseFailures.push("v0.6.0");
    const first = await dispatch(world, { inputs: publishInputs("0.6.0") });
    return { world, first };
  }],
];

describe("RETRY", () => {
  it.each(retries)("a matching same-run retry after %s selects metadata_only", async (_, setup) => {
    const { world, first } = await setup();
    expect(world.registry.versions.has("0.6.0")).toBe(true);
    const retry = await rerunFailed(world, first);
    expect(retry.decisions).toContain("metadata_only");
    expect(retry.decisions).not.toContain("publish");
    expect(retry.state).toBe("published");
    expect(world.tags.get("v0.6.0")).toBe(A);
    expect(world.releases.get("v0.6.0")).toMatchObject({ target: A, prerelease: false });
  });
});

describe("RETRY-NPM", () => {
  it.each(retries)("a matching same-run retry after %s calls npm publish zero times",
    async (_, setup) => {
      const { world, first } = await setup();
      const retry = await rerunFailed(world, first);
      expect(retry.attempt).toBe(2);
      expect(retry.trace.filter((m) => m.kind === "npm_publish")).toEqual([]);
      expect(retry.state).toBe("published");
    });
});

describe("RETRY-PROOF", () => {
  it.each([
    ["a missing receipt", (world: World, first: RunResult) => {
      for (const files of first.artifacts.values()) {
        for (const path of [...files.keys()]) if (path.endsWith("receipt.json")) files.delete(path);
      }
      void world;
    }],
    ["a registry integrity that differs from the receipt", (world: World) => {
      const entry = world.registry.versions.get("0.6.0");
      if (entry) entry.integrity = integrityOf(Buffer.from("another archive"));
    }],
    ["provenance from another run", (world: World) => {
      const entry = world.registry.versions.get("0.6.0");
      if (entry?.provenance) entry.provenance = { ...entry.provenance, runId: "4242" };
    }],
    ["provenance from another commit", (world: World) => {
      const entry = world.registry.versions.get("0.6.0");
      if (entry?.provenance) entry.provenance = { ...entry.provenance, sha: "e".repeat(40) };
    }],
    ["missing provenance", (world: World) => {
      const entry = world.registry.versions.get("0.6.0");
      if (entry) entry.provenance = null;
    }],
  ])("a same-run retry with %s produces blocked", async (_, mismatch) => {
    const { world, first } = await ambiguousPublication();
    expect(world.registry.versions.has("0.6.0")).toBe(true);
    mismatch(world, first);
    const retry = await rerunFailed(world, first);
    expect(retry.attempt).toBe(2);
    expect(retry.state).toBe("blocked");
    expect(retry.decision).toBe("blocked");
    expect(retry.trace).toEqual([]);
  });
});

describe("DRYRUN", () => {
  it.each([
    ["a direct stable version", "0.6.0", "stable", { dry_run: true }],
    ["an RC version", "0.6.0-rc.1", "rc", { dry_run: true }],
    ["a dispatch that omits dry_run", "0.6.0", "stable", {}],
  ] as const)("a dry run of %s produces a verification_only trace", async (_, version, channel,
    extra) => {
    const world = createWorld({ version, approvals: ["approve", "approve"] });
    const run = await dispatch(world, { inputs: { expected_version: version, ...extra } });
    expect(run.state).toBe("verification_only");
    const reported = Object.fromEntries(run.outputs.map((o) => [o.key, o.value]));
    expect(reported).toMatchObject({ sha: A, version, channel, publishable: "true" });
    expect(run.approvals).toEqual([]);
    expect(world.trace).toEqual([]);
  });

  it("an RC dry run verifies both the candidate and the promoted stable archive", async () => {
    const world = createWorld({ version: "0.6.0-rc.1" });
    const run = await dispatch(world, { inputs: { expected_version: "0.6.0-rc.1",
      dry_run: true } });
    expect(run.state).toBe("verification_only");
    expect(new Set(world.packs.map((p) => p.version))).toEqual(new Set(["0.6.0", "0.6.0-rc.1"]));
    expect(world.packs.every((p) => p.environment === null)).toBe(true);
  });
});

describe("DRYRUN-JOB", () => {
  it.each(["0.6.0", "0.6.0-rc.1"])("every publishing job of a %s dry run is skipped",
    async (version) => {
      const world = createWorld({ version, approvals: ["approve", "approve"] });
      const run = await dispatch(world, { inputs: { expected_version: version, dry_run: true } });
      const gated = gatedJobs(run);
      expect(gated.length).toBeGreaterThan(0);
      expect(gated.map((job) => job.result)).toEqual(gated.map(() => "skipped"));
    });
});

describe("PUBLISHED-DRYRUN", () => {
  it("a dry run of registry latest completes at verification_only as not publishable",
    async () => {
      const world = createWorld({ version: LATEST });
      const run = await dispatch(world, { inputs: { expected_version: LATEST, dry_run: true } });
      expect(run.state).toBe("verification_only");
      const reported = Object.fromEntries(run.outputs.map((o) => [o.key, o.value]));
      expect(reported).toMatchObject({ version: LATEST, publishable: "false",
        reason: "version_already_published" });
      expect(new Set(world.packs.map((p) => p.version))).toEqual(new Set([LATEST]));
      expect(world.trace).toEqual([]);
    });
});

describe("ARCHIVE", () => {
  it.each([
    ["a direct stable release", "0.6.0", "0.6.0"],
    ["a stable promotion", "0.6.0-rc.1", "0.6.0"],
  ])("the archive npm receives in %s has the verified receipt's SHA-512 digest",
    async (_, version, published) => {
      const world = createWorld({ version, approvals: ["approve", "approve"] });
      const run = await dispatch(world, { inputs: publishInputs(version) });
      const publish = npmPublishes(world, published);
      expect(publish).toHaveLength(1);
      const receipt = receipts(run).find((r) => r.version === published);
      expect(receipt).toMatchObject({ runId: run.runId, sourceSha: A, version: published });
      expect(publish[0]?.detail.integrity).toBe(receipt?.integrity);
      const packed = world.packs.filter((p) => p.version === published);
      expect(packed.map((p) => p.integrity)).toContain(receipt?.integrity);
      expect(packed.every((p) => p.environment === null)).toBe(true);
      const verified = (publishedArchive(world, published)?.verifiedBy ?? []).map(
        (c) => c.command);
      for (const command of VERIFY_COMMANDS) expect(verified).toContain(command);
    });
});

describe("AUTH", () => {
  it.each([
    ["a direct stable release", "0.6.0"],
    ["an RC promotion", "0.6.0-rc.1"],
  ])("every write of %s comes from a job under npm-publish", async (_, version) => {
    const world = createWorld({ version, approvals: ["approve", "approve"] });
    const run = await dispatch(world, { inputs: publishInputs(version) });
    expect(run.state).toBe("published");
    const writers = new Set(world.trace.map((m) => m.job));
    for (const name of writers) {
      expect(run.jobs.find((job) => job.name === name)?.environment).toBe("npm-publish");
    }
  });
});

