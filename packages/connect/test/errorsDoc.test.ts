// @vitest-environment node
/**
 * `docs/errors.md` lists every code of every public error class under the call that throws it
 * (FLU-1622, criterion 4.7).
 *
 * Two sources of truth sit in the code, and the census `test/apiCensus.ts` reads both with the
 * TypeScript checker: the literals of each class's code union, and the `@throws` tags in the
 * TSDoc of each throwing call, which name the class and then its codes in backticks. Each
 * class's table in `errors.md` must hold exactly the union's codes, and its "Thrown by" column
 * must agree with the `@throws` tags in both directions: a row names a call only if that call's
 * `@throws` names the code, every code a `@throws` names has its call in the row, and "none" is
 * written only for a code no `@throws` names; a cell is never empty. Whether a `@throws` tag is
 * true of the code behind it is for review. Nothing is faked.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusRow } from "./apiCensus";
import { readDoc, sectionOf } from "./docsText";

/** Each public error class and the union its `code` takes. */
const CLASSES: Record<string, string> = {
  FluentWidgetConfigError: "FluentWidgetConfigErrorCode",
  FluentAuthError: "FluentAuthErrorCode",
  FluentReviewRejectedError: "FluentReviewRejectedErrorCode",
  FluentSponsorshipFallbackError: "FluentSponsorshipReason",
  FluentUserOperationGasError: "FluentUserOperationGasErrorCode",
};

const ERRORS = readDoc("docs/errors.md");

let rows: CensusRow[] = [];

beforeAll(() => {
  rows = apiCensus();
}, 180_000);

const literalsOf = (union: string) => rows.find((row) => row.name === union)?.literals ?? [];

/** The `@throws` blocks of a TSDoc: from each tag to the next tag or the comment's end. */
function throwsBlocks(tsdoc: string): string[] {
  const text = tsdoc.replace(/^\s*\/?\*+\/?/gm, "");
  return [...text.matchAll(/@throws\b([\s\S]*?)(?=\n\s*@\w|$)/g)].map((m) => m[1] ?? "");
}

/**
 * Every `class:code` → the calls whose `@throws` name it. A call is a member by its declared
 * name (`FluentSignApi.signMessage` and `FluentBatchApi.signMessage` are one), or an export.
 */
function thrownByTsdoc(): Map<string, Set<string>> {
  const sources = new Map<string, { call: string; tsdoc: string }>();
  for (const row of rows) {
    sources.set(row.name, { call: row.name, tsdoc: row.declaration.tsdoc });
    for (const member of row.members) {
      sources.set(member.declaredAs, { call: member.name, tsdoc: member.tsdoc });
    }
  }
  const thrown = new Map<string, Set<string>>();
  for (const { call, tsdoc } of sources.values()) {
    for (const block of throwsBlocks(tsdoc)) {
      let current: string | null = null;
      for (const span of block.matchAll(/`([^`]+)`/g)) {
        const token = span[1] ?? "";
        if (token in CLASSES) current = token;
        else if (current && literalsOf(CLASSES[current] ?? "").includes(token)) {
          const key = `${current}:${token}`;
          thrown.set(key, (thrown.get(key) ?? new Set()).add(call));
        }
      }
    }
  }
  return thrown;
}

type TableRow = { code: string; thrownBy: Set<string> | "none" };

/** The rows of a class's table in `errors.md`: its code and the calls its "Thrown by" names. */
function tableOf(className: string): TableRow[] {
  const section = sectionOf(ERRORS, new RegExp(`^## \`${className}\`\\s*$`));
  return section
    .split("\n")
    // Every row but the header, whose first cell is `code` too.
    .filter((line) => /^\| `[a-z_]+` \|/.test(line) && !line.includes("| Thrown by |"))
    .map((line) => {
      const [, codeCell = "", thrownCell = ""] = line.split("|").map((cell) => cell.trim());
      const code = codeCell.replace(/`/g, "");
      if (thrownCell === "none") return { code, thrownBy: "none" };
      const calls = [...thrownCell.matchAll(/`([^`]+)`/g)].map((m) =>
        (m[1] ?? "")
          .replace(/^<|>$/g, "")
          .replace(/\(.*\)$/, "")
          .split(".")
          .pop() ?? "",
      );
      return { code, thrownBy: new Set(calls) };
    });
}

describe("criterion 4.7: docs/errors.md", () => {
  it.each(Object.keys(CLASSES))("has one table for %s whose codes equal its union", (name) => {
    const table = tableOf(name);
    expect(table.length, `## \`${name}\` has a table`).toBeGreaterThan(0);
    const listed = table.map((row) => row.code).sort();
    expect(listed).toEqual([...literalsOf(CLASSES[name] ?? "")].sort());
  });

  it("names under each code exactly the calls whose @throws name it", () => {
    const thrown = thrownByTsdoc();
    const wrong: string[] = [];
    for (const name of Object.keys(CLASSES)) {
      for (const { code, thrownBy } of tableOf(name)) {
        const fromTsdoc = thrown.get(`${name}:${code}`) ?? new Set<string>();
        if (thrownBy === "none") {
          if (fromTsdoc.size > 0) {
            wrong.push(`${name} ${code}: "none", but @throws of ${[...fromTsdoc].join(", ")}`);
          }
          continue;
        }
        if (thrownBy.size === 0) wrong.push(`${name} ${code}: an empty "Thrown by"; write none`);
        for (const call of thrownBy) {
          if (!fromTsdoc.has(call)) wrong.push(`${name} ${code}: ${call} has no @throws naming it`);
        }
        for (const call of fromTsdoc) {
          if (!thrownBy.has(call)) wrong.push(`${name} ${code}: the row leaves out ${call}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("reads @throws tags on every throwing call it lists", () => {
    const calls = new Set([...thrownByTsdoc().values()].flatMap((set) => [...set]));
    for (const call of [
      "FluentWidget",
      "execute",
      "signMessage",
      "signTypedData",
      "getAuthToken",
      "linkX",
      "useLinkX",
    ]) {
      expect(calls, call).toContain(call);
    }
  });
});
