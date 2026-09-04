import { describe, expect, it } from "vitest";

import { formatVerdict, shortenHex } from "./format";

describe("shortenHex", () => {
  it("shortens the address and keeps the words around it", () => {
    expect(shortenHex("Sponsored by 0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E (transfer)")).toBe(
      "Sponsored by 0x83Fed7…2D8E (transfer)",
    );
  });
});

describe("formatVerdict", () => {
  it("indents the verdict without changing what it says", () => {
    const raw = '{"proceed":true,"segments":["Has a Fluent profile"]}';

    expect(formatVerdict(raw)).toBe(
      ['{', '  "proceed": true,', '  "segments": [', '    "Has a Fluent profile"', '  ]', '}'].join(
        "\n",
      ),
    );
    expect(JSON.parse(formatVerdict(raw))).toEqual(JSON.parse(raw));
  });

  it("passes a non-JSON body through untouched, because that sentence is the diagnosis", () => {
    expect(formatVerdict("origin not allowed")).toBe("origin not allowed");
    expect(formatVerdict("")).toBe("");
  });

  it("keeps a large numeric string exact, rather than turning it into a number", () => {
    expect(formatVerdict('{"detail":"99999320831245852"}')).toContain('"99999320831245852"');
  });
});
