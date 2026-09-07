import { describe, expect, it } from "vitest";

import { FLUENT_DECIMAL_SEPARATOR, formatFluentLocaleAmount } from "../utils";
import {
  formatFluentPortfolioPnlAbsolute,
  formatFluentPortfolioPnlPercent,
  formatFluentPortfolioTotal,
} from "./useFluentTokenBalances";

describe("portfolio formatting", () => {
  it("splits the total into parts that rejoin into the same string a token row shows", () => {
    const total = 6448.58;
    const { whole, fraction, separator } = formatFluentPortfolioTotal(total);

    expect(`${whole}${separator}${fraction}`).toBe(formatFluentLocaleAmount(total, 2));
    expect(`$${whole}${separator}${fraction}`).toBe("$6,448.58");
  });

  // The bug this guards: the locale moved to en-US, the hand-written separators
  // did not, and the header read `$6,448,58` above rows reading `$6,448.58`.
  it("uses the locale's decimal separator, not a hardcoded one", () => {
    expect(formatFluentPortfolioTotal(1.5).separator).toBe(FLUENT_DECIMAL_SEPARATOR);
    expect(formatFluentPortfolioTotal(1.5).separator).not.toBe(",");
  });

  it("keeps two fraction digits, including trailing zeros", () => {
    expect(formatFluentPortfolioTotal(10)).toMatchObject({ whole: "10", fraction: "00" });
    expect(formatFluentPortfolioTotal(0.5)).toMatchObject({ whole: "0", fraction: "50" });
  });

  it("groups thousands", () => {
    expect(formatFluentPortfolioTotal(1234567.89).whole).toBe("1,234,567");
  });

  it("formats pnl with the same separator and a typographic minus", () => {
    expect(formatFluentPortfolioPnlAbsolute(-189.28)).toBe("$ −189.28");
    expect(formatFluentPortfolioPnlAbsolute(189.28)).toBe("$ +189.28");
  });

  it("formats the pnl percentage unsigned", () => {
    expect(formatFluentPortfolioPnlPercent(-2.85)).toBe("2.85%");
  });
});
