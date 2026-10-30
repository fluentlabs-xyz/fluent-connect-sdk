/**
 * Ordinary trunk work through the repository's actual workflow set: a pull request into `main`
 * and pushes to `main` run CI and publish nothing, whatever version the manifest carries.
 *
 * Fakes: the registry, Git tags and Releases, and deployment approvals (`test/fakes.ts`). Every
 * approval a push fixture asks for is granted, so a residual publishing path is observed rather
 * than held at a gate.
 */
import { describe, expect, it } from "vitest";
import { A, createWorld, LATEST } from "./test/fixtures.ts";
import { CI_COMMANDS, runEvent, type RunResult, type WorkflowEvent } from "./test/workflow.ts";

const NODE_22 = CI_COMMANDS.slice(0, 4);
const NODE_24 = CI_COMMANDS;

const pullRequest: WorkflowEvent = { name: "pull_request", ref: "refs/heads/main", sha: A };
const pushToMain: WorkflowEvent = { name: "push", ref: "refs/heads/main", sha: A };

async function observe(version: string, event: WorkflowEvent) {
  const world = createWorld({ version, approvals: ["approve", "approve", "approve"] });
  const runs = await runEvent(world, event);
  return { world, runs };
}

function commandsOf(runs: RunResult[], name: string): string[] | undefined {
  const job = runs.flatMap((run) => run.jobs).find((j) => j.name === name);
  return job?.commands.map((c) => c.command);
}

/** CI only: every triggered job is a CI check that ran CI commands and wrote nothing. */
function expectCiOnly(world: ReturnType<typeof createWorld>, runs: RunResult[]) {
  const jobs = runs.flatMap((run) => run.jobs);
  expect(runs.map((run) => run.workflow)).toEqual(["ci.yml"]);
  expect(jobs.map((job) => [job.name, job.result])).toEqual([
    ["check (22)", "success"],
    ["check (24)", "success"],
  ]);
  for (const job of jobs) {
    expect(job.unsupported).toEqual([]);
    expect(job.phases).toEqual([]);
    expect(job.environment).toBeNull();
  }
  expect(runs.flatMap((run) => run.approvals)).toEqual([]);
  expect(world.trace.filter((m) => m.kind === "npm_publish")).toHaveLength(0);
  expect(world.trace).toEqual([]);
}

describe("PR", () => {
  it("an ordinary pull request into main with the published version completes its CI path",
    async () => {
      const { world, runs } = await observe(LATEST, pullRequest);
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        expect(run.conclusion).toBe("success");
        for (const job of run.jobs) {
          expect(job.result).toBe("success");
          expect(job.unsupported).toEqual([]);
        }
      }
      expect(commandsOf(runs, "check (22)")).toEqual(NODE_22);
      expect(commandsOf(runs, "check (24)")).toEqual(NODE_24);
      expect(world.trace).toEqual([]);
    });
});

describe("MAIN-PUSH", () => {
  it("a push to main with the published version follows the ci_only path", async () => {
    const { world, runs } = await observe(LATEST, pushToMain);
    expectCiOnly(world, runs);
  });
});

describe("VERSION-PR-PUSH", () => {
  it("a merged stable version PR with an unpublished greater version follows the ci_only path",
    async () => {
      const { world, runs } = await observe("0.6.0", pushToMain);
      expectCiOnly(world, runs);
    });
});

describe("RC-PR-PUSH", () => {
  it("a merged RC version PR with an unpublished candidate follows the ci_only path",
    async () => {
      const { world, runs } = await observe("0.6.0-rc.1", pushToMain);
      expectCiOnly(world, runs);
    });
});

describe("CI-RELEASE", () => {
  it.each([
    ["pull request", pullRequest],
    ["push", pushToMain],
  ])("the Node 24 check runs pnpm run test:release as its own last step on a %s",
    async (_, event) => {
      const { runs } = await observe(LATEST, event);
      const commands = commandsOf(runs, "check (24)") ?? [];
      expect(commands.at(-1)).toBe("pnpm run test:release");
      expect(commands.filter((c) => c === "pnpm run test:release")).toHaveLength(1);
      expect(commands.indexOf("pnpm run test:release")).toBeGreaterThan(
        commands.indexOf("pnpm exec turbo run test"));
    });
});

describe("CI-PACK", () => {
  it.each([
    ["pull request", pullRequest],
    ["push", pushToMain],
  ])("the Node 24 check runs lint:pack as its own step after the tests on a %s",
    async (_, event) => {
      const { runs } = await observe(LATEST, event);
      const commands = commandsOf(runs, "check (24)") ?? [];
      const lintPack = "pnpm --filter @fluent.xyz/connect run lint:pack";
      expect(commands.filter((c) => c === lintPack)).toHaveLength(1);
      expect(commands.indexOf(lintPack)).toBeGreaterThan(
        commands.indexOf("pnpm exec turbo run test"));
    });
});

describe("CI contract", () => {
  it.each([
    ["pull request", pullRequest],
    ["push", pushToMain],
  ])("check (22) and check (24) run the contract's commands in order on a %s",
    async (_, event) => {
      const { runs } = await observe(LATEST, event);
      expect(commandsOf(runs, "check (22)")).toEqual(NODE_22);
      expect(commandsOf(runs, "check (24)")).toEqual(NODE_24);
    });
});
