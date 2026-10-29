// @vitest-environment node
/**
 * `docs/api.md` is the reference the source generates (FLU-1622, criterion 5.9).
 *
 * The reference is never edited by hand: `scripts/api-doc.ts` renders it from the census
 * `test/apiCensus.ts` builds with the TypeScript checker, so every export and every member,
 * each `@experimental` one marked, is there by construction. This case renders it again in
 * memory and compares; a difference means the TSDoc or the API changed after the file was
 * written. Nothing is faked.
 */
import { describe, expect, it } from "vitest";

import { renderApiDoc } from "../scripts/api-doc";
import { apiCensus } from "./apiCensus";
import { API_DOC, readDoc } from "./docsText";

const REGENERATE = "run `pnpm --filter @fluent.xyz/connect docs:api`";

describe("criterion 5.9: docs/api.md", () => {
  it(
    "equals a fresh generation from the census",
    () => {
      const written = readDoc(API_DOC);
      const fresh = renderApiDoc(apiCensus());
      if (written !== fresh) {
        // The first UTF-16 unit that differs; the end of the shorter text if one is a prefix.
        let at = 0;
        while (at < fresh.length && fresh[at] === written[at]) at++;
        const line = fresh.slice(0, at).split("\n").length;
        expect.fail(`docs/api.md is stale from line ${line}: ${REGENERATE}`);
      }
    },
    // Building the census program takes several seconds, more under load.
    180_000,
  );

  it("shows every branch of a union: `FluentLinkXResult` keeps `redirecting`", () => {
    const written = readDoc(API_DOC);
    const start = written.indexOf("### `FluentLinkXResult`");
    const section = written.slice(start, written.indexOf("\n### ", start + 1));
    expect(section).toContain('{ status: "redirecting" }');
  });

  it("gives a union inside an intersection no member table: `FluentGasPayment`", () => {
    const written = readDoc(API_DOC);
    const start = written.indexOf("### `FluentGasPayment`");
    const section = written.slice(start, written.indexOf("\n### ", start + 1));
    expect(section).toContain("includeApproval?: false;");
    expect(section).not.toContain("| Member |");
  });

  it("marks every experimental export and member of the census", () => {
    const written = readDoc(API_DOC);
    for (const row of apiCensus()) {
      const heading = `### \`${row.name}\`\n\n*${row.kind}*`;
      const marked = `${heading} · **experimental**`;
      expect(written, row.name).toContain(row.tags.includes("experimental") ? marked : heading);
      for (const member of row.members.filter((m) => m.tags.includes("experimental"))) {
        const name = member.path.slice(row.name.length + 1);
        const cell = `\`${name.replace(/\./g, "\\.")}\``;
        expect(written, member.path).toMatch(
          new RegExp(`^\\| ${cell} \\|[^\\n]*\\| \\*\\*yes\\*\\* \\|`, "m"),
        );
      }
    }
  });
});
