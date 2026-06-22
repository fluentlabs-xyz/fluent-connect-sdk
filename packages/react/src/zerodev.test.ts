import { describe, expect, it } from "vitest";
import { assertFluentZeroDevChain } from "./zerodev.js";

describe("assertFluentZeroDevChain", () => {
  it("accepts Fluent testnet and mainnet", () => {
    expect(() => assertFluentZeroDevChain(20994)).not.toThrow();
    expect(() => assertFluentZeroDevChain(25363)).not.toThrow();
  });

  it("rejects unsupported chains", () => {
    expect(() => assertFluentZeroDevChain(1)).toThrow(/20994/);
  });
});
