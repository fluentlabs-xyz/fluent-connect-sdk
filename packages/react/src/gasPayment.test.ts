import { describe, expect, it } from "vitest";

import { formatFluentGasTokenBalance } from "./gasPayment";

describe("formatFluentGasTokenBalance", () => {
  it("rounds ERC20 balances to at most three decimal places", () => {
    expect(formatFluentGasTokenBalance({
      raw: 115999999999974027019n,
      decimals: 18,
      formatted: "115.999999999974027019",
    })).toBe("116");

    expect(formatFluentGasTokenBalance({
      raw: 1234567n,
      decimals: 6,
      formatted: "1.234567",
    })).toBe("1.235");
  });

  it("does not pad balances that already have three or fewer decimals", () => {
    expect(formatFluentGasTokenBalance({
      raw: 1250n,
      decimals: 3,
      formatted: "1.25",
    })).toBe("1.25");
  });
});
