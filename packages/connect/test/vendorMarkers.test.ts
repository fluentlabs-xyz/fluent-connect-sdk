// @vitest-environment node
/**
 * The public API of `@fluent.xyz/connect` speaks no vendor's name (FLU-1622, criterion 1.5).
 *
 * A failure here means the change broke the public API: fix the change, never this file; the
 * file changes only by the maintainer's own edit.
 *
 * A vendor word in a name, a TSDoc or a declaration a builder reads is a promise about which
 * vendor sits under the widget, kept for good after 0.6.0. The exceptions are inputs a host
 * passes, each listed here with its reason: an input can become optional later (review rule
 * A9), where a word in something a host reads, a union above all, cannot be taken back. The
 * text is read by the TypeScript checker (`test/apiCensus.ts`). Nothing is faked.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusRow } from "./apiCensus";

const VENDOR = /privy|zerodev|kernel|reown|wagmi|swapper/i;

/** Whole exports exempt from the scan, with the reason. */
const EXEMPT_EXPORTS: Record<string, string> = {
  FluentPrivyAdapter:
    "the one @experimental provider seam (D41): a host that runs Privy's own SDK hands it in",
};

/** Members exempt from the scan, by path, with the reason. */
const EXEMPT_MEMBERS: Record<string, string> = {
  "FluentWidgetProps.privyAdapter":
    "an @experimental input naming the seam above; an input can become optional later (A9)",
  "FluentWidgetConfig.privyClientId":
    "an @experimental input while login runs on Privy; it goes when Fluent's own login " +
    "replaces it (A9)",
  "FluentWidgetConfig.swapper":
    "an @experimental input naming the deposit provider; it can be renamed or removed in a " +
    "minor release, and its chain and token should derive from `network`",
};

let rows: CensusRow[] = [];

// Building the program over the package takes several seconds, more under load.
beforeAll(() => {
  rows = apiCensus();
}, 180_000);

describe("criterion 1.5: the name, TSDoc and declaration of every export", () => {
  it("are free of vendor words, apart from the listed inputs", () => {
    const hits: string[] = [];
    for (const row of rows) {
      if (row.name in EXEMPT_EXPORTS) continue;
      let text = `${row.name}\n${row.declaration.text}`;
      for (const exempt of row.members.filter((candidate) => candidate.path in EXEMPT_MEMBERS)) {
        text = text.replace(exempt.text, "");
      }
      for (const line of text.split("\n")) {
        if (VENDOR.test(line)) hits.push(`${row.name}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("lists only inputs as exceptions, none of them a member of a union a host reads", () => {
    for (const path of Object.keys(EXEMPT_MEMBERS)) {
      const owner = rows.find((row) => path.startsWith(`${row.name}.`));
      const exempt = owner?.members.find((candidate) => candidate.path === path);
      expect(exempt, path).toBeDefined();
      expect(owner?.literals, path).toEqual([]);
      expect(exempt?.typeText, path).not.toMatch(/^\s*\|?\s*["'`]/);
    }
    for (const name of Object.keys(EXEMPT_EXPORTS)) {
      const row = rows.find((candidate) => candidate.name === name);
      expect(row, name).toBeDefined();
      expect(row?.literals, name).toEqual([]);
    }
  });
});
