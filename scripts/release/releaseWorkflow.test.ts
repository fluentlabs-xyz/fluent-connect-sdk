/**
 * The static shape of `.github/workflows/release.yml`, read from the file itself: its trigger,
 * its inputs, its concurrency and the environment of every job that can publish.
 *
 * Fakes: none; these tests read the workflow file.
 */
import { describe, expect, it } from "vitest";
import { readWorkflow, VERIFY_COMMANDS } from "./test/workflow.ts";

const release = readWorkflow("release.yml");
type Job = Record<string, any>;
const jobs = Object.entries<Job>(release.jobs ?? {});

function runSteps(job: Job): string[] {
  return ((job.steps ?? []) as Job[]).filter((s) => typeof s.run === "string").map(
    (s) => s.run as string);
}

describe("TRIGGER", () => {
  it("release.yml declares workflow_dispatch as its only trigger", () => {
    const on = release.on;
    const names = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
    expect(names).toEqual(["workflow_dispatch"]);
  });
});

describe("DRYRUN-DEFAULT", () => {
  it("the dry_run input is a boolean that defaults to true", () => {
    const inputs = release.on?.workflow_dispatch?.inputs ?? {};
    expect(inputs.dry_run).toMatchObject({ type: "boolean", default: true });
  });

  it("the expected_version input is a required string", () => {
    const inputs = release.on?.workflow_dispatch?.inputs ?? {};
    expect(inputs.expected_version).toMatchObject({ type: "string", required: true });
  });
});

describe("AUTH", () => {
  it("every job that can mint an OIDC token runs under the npm-publish environment", () => {
    const minting = jobs.filter(([, job]) => job.permissions?.["id-token"] === "write");
    expect(minting.length).toBeGreaterThanOrEqual(2);
    for (const [, job] of minting) {
      const environment = typeof job.environment === "string" ? job.environment
        : job.environment?.name;
      expect(environment).toBe("npm-publish");
    }
    expect(release.permissions?.["id-token"]).toBeUndefined();
  });
});

describe("CONCURRENCY", () => {
  it("release.yml serializes every run in the release group without cancelling", () => {
    expect(release.concurrency?.group).toBe("release");
    expect(release.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});

describe("Inputs as data", () => {
  it("no run step of release.yml interpolates a dispatch input into its script", () => {
    for (const [, job] of jobs) {
      for (const script of runSteps(job)) {
        expect(script).not.toMatch(/\$\{\{[^}]*(inputs\.|github\.event\.inputs)/);
      }
    }
  });
});

describe("Modelled steps", () => {
  it("every run step of release.yml is a verification command, npm setup or a helper phase",
    () => {
      const helper = /^node\s+(?:--[\w-]+\s+)*scripts\/release\/release\.ts\s+[\w-]+$/;
      const npmSetup = /^npm install -g npm@\S+$/;
      const scripts = jobs.flatMap(([, job]) => runSteps(job)).map((s) => s.trim());
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        const known = VERIFY_COMMANDS.includes(script) || helper.test(script) ||
          npmSetup.test(script);
        expect(known, script).toBe(true);
      }
    });
});
