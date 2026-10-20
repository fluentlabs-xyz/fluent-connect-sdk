/**
 * The bench's one execution switch. No fakes: the table and its lookup are the whole subject.
 */
import { describe, expect, it } from "vitest";

import { EXECUTION_MODES, executionFor } from "./executionMode";

describe("the execution switch", () => {
  it("offers exactly the two paths the comparison is between", () => {
    expect(EXECUTION_MODES.map((mode) => mode.id)).toEqual(["chain", "zerodev"]);
  });

  it("asks the chain for everything in its first position", () => {
    expect(executionFor("chain")).toEqual({
      feeSource: "chain",
      receiptSource: "chain",
      chainCheckBeforeSign: false,
    });
  });

  it("asks ZeroDev for everything in its second position", () => {
    // What the widget did before FLU-1591, to the last of the three settings.
    expect(executionFor("zerodev")).toEqual({
      feeSource: "bundler",
      receiptSource: "bundler",
      chainCheckBeforeSign: true,
    });
  });

  it("moves all three settings together, never one of them", () => {
    const [chain, zerodev] = [executionFor("chain"), executionFor("zerodev")];
    const fields = ["feeSource", "receiptSource", "chainCheckBeforeSign"] as const;
    expect(fields.filter((field) => chain[field] === zerodev[field])).toEqual([]);
  });

  it("opens on the path the widget ships with", () => {
    expect(EXECUTION_MODES[0]?.id).toBe("chain");
  });
});
