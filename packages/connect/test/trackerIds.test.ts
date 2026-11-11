// @vitest-environment node
/**
 * No file of the repository points into the private tracker: no tracker id and no Issue
 * criterion number (`docs/standards/docs-and-comments.md` D8). The repository and the npm
 * bundle are public, so a reader without tracker access cannot resolve such a reference, and a
 * comment that carries one in place of its reason says nothing to them.
 *
 * The scan reads every file `git ls-files` lists at the repository root, as it stands in the
 * working tree, and skips binary files; `node_modules/`, `dist/` and untracked files are never
 * read. Nothing is faked: the cases about the scan itself run it over a throwaway git
 * repository in the OS temp directory. This file builds its patterns and samples from parts, so
 * it holds no reference it would flag and passes its own scan.
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./docsText";

/** The tracker's team keys; an id is a key, a hyphen and a number. */
const TEAM_KEYS = ["FLU", "DSK", "PER"];
const TRACKER_ID = new RegExp(`\\b(?:${TEAM_KEYS.join("|")})-\\d+\\b`);
/** An Issue criterion cited by number: one criterion or a list of them, any case. */
const CRITERION_NUMBER = new RegExp(`\\b${"criteri"}(?:on|a) \\d+`, "i");

/** The files `git ls-files` lists under `root`, relative to it. */
function trackedFiles(root: string): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return output.split("\0").filter((file) => file !== "");
}

/**
 * Every line of a tracked text file under `root` that names a tracker id or an Issue criterion
 * number, as `<file>:<line>: <text>`.
 */
function trackerReferences(root: string): string[] {
  const found: string[] = [];
  for (const file of trackedFiles(root)) {
    const absolute = path.join(root, file);
    // A tracked file deleted in the working tree, or a submodule, has nothing to read.
    let isFile = false;
    try {
      isFile = statSync(absolute).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    bytes
      .toString("utf8")
      .split("\n")
      .forEach((line, index) => {
        if (TRACKER_ID.test(line) || CRITERION_NUMBER.test(line)) {
          found.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

/** The guard: throws, naming each offending file and line, when `root` points into the tracker. */
function assertNoTrackerReferences(root: string): void {
  const found = trackerReferences(root);
  if (found.length === 0) return;
  throw new Error(
    `${found.length} line(s) point into the private tracker; write the behaviour, condition ` +
      `or defect instead (docs/standards/docs-and-comments.md D8):\n${found.join("\n")}`,
  );
}

/** The lines of the guard's failure message under `root` that name a file and line. */
function failureLines(root: string): string[] {
  try {
    assertNoTrackerReferences(root);
  } catch (error) {
    return (error as Error).message.split("\n").slice(1);
  }
  return [];
}

/** A tracker id built from parts, so this file never holds one literally. */
const id = (key: string, number: number) => [key, number].join("-");
/** An Issue criterion reference built from parts, for the same reason. */
const criterion = (number: string) => ["criterion", number].join(" ");

const SELF = "packages/connect/test/trackerIds.test.ts";

describe("the repository's tracked files", () => {
  it("name no tracker id and no Issue criterion number", () => {
    assertNoTrackerReferences(REPO_ROOT);
  });
});

describe("the guard over a throwaway repository", () => {
  let root = "";

  afterEach(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true });
    root = "";
  });

  /** A repository holding `files`, each added to the index unless it is `untracked`. */
  function repository(files: Record<string, string>, untracked: string[] = []): string {
    root = mkdtempSync(path.join(tmpdir(), "tracker-ids-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    const tracked = Object.keys(files).filter((file) => !untracked.includes(file));
    if (tracked.length > 0) execFileSync("git", ["add", "--", ...tracked], { cwd: root });
    return root;
  }

  it.each([id("FLU", 1234), id("DSK", 12), id("PER", 7)])(
    "fails when a tracked file gains a line holding the tracker id %s",
    (sample) => {
      const dir = repository({ "src/a.ts": "export const a = 1;\n" });
      expect(() => assertNoTrackerReferences(dir)).not.toThrow();

      appendFileSync(path.join(dir, "src/a.ts"), `// see ${sample}\n`);

      expect(() => assertNoTrackerReferences(dir)).toThrow(`src/a.ts:2: // see ${sample}`);
    },
  );

  it("fails when a tracked file gains a line citing an Issue criterion by number", () => {
    const dir = repository({ "src/a.test.ts": 'import { it } from "vitest";\n' });
    expect(() => assertNoTrackerReferences(dir)).not.toThrow();

    appendFileSync(path.join(dir, "src/a.test.ts"), `// ${criterion("4.2")}\n`);

    expect(() => assertNoTrackerReferences(dir)).toThrow(`src/a.test.ts:2: // ${criterion("4.2")}`);
  });

  it("names each offending file and line in its failure message", () => {
    const dir = repository({
      "src/a.ts": `const a = 1;\n// ${id("FLU", 1234)}\nconst b = 2;\n// ${id("PER", 7)}\n`,
      "docs/b.md": `# B\n\nText.\n\nSettled in ${criterion("4.2")}.\n`,
      "src/clean.ts": "export const clean = true;\n",
    });

    expect(failureLines(dir).sort()).toEqual(
      [
        `docs/b.md:5: Settled in ${criterion("4.2")}.`,
        `src/a.ts:2: // ${id("FLU", 1234)}`,
        `src/a.ts:4: // ${id("PER", 7)}`,
      ].sort(),
    );
  });

  it("passes lines holding the standard identifiers ERC-20, EIP-712 and ERC-4337", () => {
    const standards = "// An ERC-20 token.\n// An EIP-712 signature.\n// An ERC-4337 account.\n";
    const dir = repository({ "src/tokens.ts": standards });

    expect(() => assertNoTrackerReferences(dir)).not.toThrow();
    // The file is read: a tracker id added below them is the one line flagged.
    appendFileSync(path.join(dir, "src/tokens.ts"), `// ${id("FLU", 1234)}\n`);
    expect(failureLines(dir)).toEqual([`src/tokens.ts:4: // ${id("FLU", 1234)}`]);
  });

  it("passes its own source file", () => {
    const source = readFileSync(path.join(REPO_ROOT, SELF), "utf8");
    const dir = repository({ "trackerIds.test.ts": source });

    expect(() => assertNoTrackerReferences(dir)).not.toThrow();
    // The whole file is read: a tracker id appended after its last line is flagged there.
    appendFileSync(path.join(dir, "trackerIds.test.ts"), `// ${id("FLU", 1234)}\n`);
    const lastLine = source.split("\n").length;
    expect(failureLines(dir)).toEqual([`trackerIds.test.ts:${lastLine}: // ${id("FLU", 1234)}`]);
  });

  it("reads only the files git ls-files lists", () => {
    const dir = repository(
      {
        ".gitignore": "node_modules/\ndist/\n",
        "src/clean.ts": "export const clean = true;\n",
        "node_modules/pkg/index.js": `// ${id("FLU", 1)}\n`,
        "dist/index.js": `// ${id("FLU", 2)}\n`,
        "notes.md": `${id("FLU", 3)}\n`,
      },
      ["node_modules/pkg/index.js", "dist/index.js", "notes.md"],
    );

    expect(() => assertNoTrackerReferences(dir)).not.toThrow();
  });

  it("reads a tracked file as it stands in the working tree", () => {
    const dir = repository({ "src/a.ts": "export const a = 1;\n" });
    writeFileSync(path.join(dir, "src/a.ts"), `export const a = 1;\n// ${id("FLU", 1234)}\n`);

    expect(failureLines(dir)).toEqual([`src/a.ts:2: // ${id("FLU", 1234)}`]);
  });
});
