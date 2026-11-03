import { describe, expect, it } from "vitest";

import { formatAmount } from "./AmountForm";

describe("formatAmount", () => {
  it("cuts a dollar-pegged token to cents without rounding up", () => {
    expect(formatAmount(12_349_999n, 6, "USDnr")).toBe("12.34");
    expect(formatAmount(5_000_000n, 6, "USDC")).toBe("5");
  });

  it("keeps up to six places for any other token", () => {
    expect(formatAmount(1_234_567_890_000_000n, 18, "ETH")).toBe("0.001234");
    expect(formatAmount(12_345_678n, 6)).toBe("12.345678");
  });

  it("marks a dollar-pegged amount below a cent instead of printing zero", () => {
    expect(formatAmount(4_000n, 6, "USDnr")).toBe("<0.01");
    expect(formatAmount(0n, 6, "USDnr")).toBe("0");
  });
});
