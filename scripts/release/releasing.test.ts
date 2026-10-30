/**
 * The maintainer documents of the release process: `RELEASING.md`, the branch rule in
 * `AGENTS.md`, the trunk ADR in `docs/adr/` and the root `test:release` script.
 *
 * Fakes: none; these tests read the files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./test/workflow.ts";

function read(path: string): string {
  const file = join(REPO_ROOT, path);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const releasing = read("RELEASING.md");
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The body of a `## <title>` section, up to the next `## ` heading. */
function section(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Paragraphs and list items, each one block of text. */
function blocks(text: string): string[] {
  return text.split(/\n\s*\n|\n(?=\s*(?:\d+\.|[-*]) )/).map(flat);
}

const migration = section(releasing, "Migration");
const requiredCheck = (name: string) =>
  blocks(migration).some((block) => block.includes(`\`${name}\``) && /requir/i.test(block) &&
    block.includes("`main`"));

describe("BRANCH", () => {
  it("AGENTS.md names main as the only active long-lived integration branch", () => {
    const agents = flat(read("AGENTS.md"));
    expect(agents).toMatch(/`main` is the (?:only|sole) active long-lived integration branch/);
    expect(agents).toMatch(/pull request targets `main`/i);
    expect(agents).not.toMatch(/targets `devel`/);
  });
});

describe("DOCS", () => {
  it("RELEASING.md gives the publishing dispatch command", () => {
    expect(releasing).toContain(
      "gh workflow run release.yml --ref main -f expected_version=<version> -f dry_run=false");
  });
});

describe("MIGRATION", () => {
  it("the first migration stage in RELEASING.md is Pause legacy publication", () => {
    const first = /^\s*1\.\s+(.*)$/m.exec(migration)?.[1] ?? "";
    expect(first.replace(/[*_`]/g, "")).toMatch(/^Pause legacy publication\b/);
  });
});

describe("CHECK-22", () => {
  it("RELEASING.md names check (22) as a required status check of main", () => {
    expect(requiredCheck("check (22)")).toBe(true);
  });
});

describe("CHECK-24", () => {
  it("RELEASING.md names check (24) as a required status check of main", () => {
    expect(requiredCheck("check (24)")).toBe(true);
  });
});

describe("ADMIN", () => {
  it("RELEASING.md requires main's status checks to apply to repository administrators",
    () => {
      const applies = blocks(migration).some((block) =>
        /status checks?/i.test(block) && /administrators/i.test(block) &&
        /\b(?:apply|applies|include|includes|including|enforce)/i.test(block) &&
        block.includes("`main`"));
      expect(applies).toBe(true);
    });
});

describe("HANDOFF", () => {
  it("RELEASING.md requires main as repos.fluent-connect-sdk.base in the hub config.yaml",
    () => {
      const handoff = blocks(releasing).some((block) =>
        block.includes("config.yaml") &&
        (block.includes("`repos.fluent-connect-sdk.base: main`") ||
          (block.includes("`repos.fluent-connect-sdk.base`") && block.includes("`main`"))));
      expect(handoff).toBe(true);
    });
});

const APPROVED_ADR =
  "The SDK previously integrated work on `devel` and published every merge into `main`, " +
  "coupling the branch switch to npm publication. Use `main` as the only active long-lived " +
  "branch, kept releasable by required CI, and publish explicitly selected immutable revisions " +
  "independently of subsequent merges. This replaces freezing development or maintaining " +
  "release branches during validation with validating and approving a fixed commit, so main " +
  "can advance without changing the release candidate.";

describe("ADR", () => {
  it("the newest numbered ADR records main as the SDK trunk in the approved text", () => {
    const adrs = readdirSync(join(REPO_ROOT, "docs/adr")).filter((f) => /^\d{4}-.*\.md$/.test(f))
      .sort();
    expect(adrs.map((f) => Number(f.slice(0, 4)))).toEqual(adrs.map((_, i) => i + 1));
    const newest = adrs.at(-1) ?? "";
    const text = read(join("docs/adr", newest));
    expect(text.split("\n")[0]).toMatch(
      /^# Use `?main`? as the SDK trunk and select releases explicitly$/);
    expect(flat(text)).toContain(APPROVED_ADR);
  });
});

describe("Runbook", () => {
  it.each(["Version PR", "Dry run", "Direct stable", "RC promotion", "Cancellation",
    "Retry and repair", "Migration"])("RELEASING.md has a %s section", (title) => {
    expect(section(releasing, title).trim()).not.toBe("");
  });

  it.each([
    "gh workflow run release.yml --ref main -f expected_version=<version> -f dry_run=true",
    "gh run rerun <run-id> --failed",
    "pnpm add @fluent.xyz/connect@0.6.0-rc.1",
    "0.6.0-rc.1 → next → validation → second approval → 0.6.0 → latest",
  ])("RELEASING.md gives `%s`", (text) => {
    expect(releasing).toContain(text);
  });
});

describe("test:release", () => {
  it("the root test:release script runs the release suite's own Vitest config", () => {
    const manifest = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.["test:release"]).toBe(
      "vitest run --config scripts/release/vitest.config.ts");
  });
});
