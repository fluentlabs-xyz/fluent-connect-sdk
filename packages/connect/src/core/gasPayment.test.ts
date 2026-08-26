import { describe, expect, it } from "vitest";

import { formatFluentGasTokenBalance } from "./gasPayment";

describe("formatFluentGasTokenBalance", () => {
  it("rounds ERC20 balances to at most one decimal place", () => {
    expect(formatFluentGasTokenBalance({
      raw: 115999999999974027019n,
      decimals: 18,
      formatted: "115.999999999974027019",
    })).toBe("116");

    expect(formatFluentGasTokenBalance({
      raw: 1234567n,
      decimals: 6,
      formatted: "1.234567",
    })).toBe("1,2");

    expect(formatFluentGasTokenBalance({
      raw: 115456n,
      decimals: 3,
      formatted: "115.456",
    })).toBe("115,5");
  });

  it("does not pad balances that already have one or fewer decimals", () => {
    expect(formatFluentGasTokenBalance({
      raw: 12n,
      decimals: 1,
      formatted: "1.2",
    })).toBe("1,2");
  });

  it("uses de-DE thousands separators", () => {
    expect(formatFluentGasTokenBalance({
      raw: 100000n * 10n ** 18n,
      decimals: 18,
      formatted: "100000",
    })).toBe("100.000");
  });
});
