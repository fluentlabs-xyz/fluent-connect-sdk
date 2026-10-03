import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { sanitizeBridgeAmountInput, validateBridgeAmount } from "./amount";

describe("sanitizeBridgeAmountInput", () => {
  it("passes plain decimals through", () => {
    expect(sanitizeBridgeAmountInput("1.25")).toBe("1.25");
    expect(sanitizeBridgeAmountInput("0.5")).toBe("0.5");
  });

  it("accepts a comma as the separator", () => {
    expect(sanitizeBridgeAmountInput("0,5")).toBe("0.5");
  });

  it("keeps a trailing separator so the user can carry on typing", () => {
    expect(sanitizeBridgeAmountInput("0.")).toBe("0.");
  });

  it("drops keystrokes it cannot read instead of clearing the field", () => {
    expect(sanitizeBridgeAmountInput("1.2x", "1.2")).toBe("1.2");
    expect(sanitizeBridgeAmountInput("-1", "1")).toBe("1");
    expect(sanitizeBridgeAmountInput("1.2.3", "1.2")).toBe("1.2");
  });

  it("collapses leading zeros without eating a leading '0.'", () => {
    expect(sanitizeBridgeAmountInput("007")).toBe("7");
    expect(sanitizeBridgeAmountInput("0.7")).toBe("0.7");
    expect(sanitizeBridgeAmountInput("0")).toBe("0");
  });

  it("caps the fraction at wei precision", () => {
    // 20 decimals in, 18 out — parseEther would throw on the rest.
    expect(sanitizeBridgeAmountInput(`1.${"1".repeat(20)}`)).toBe(`1.${"1".repeat(18)}`);
  });

  it("clears on an empty field", () => {
    expect(sanitizeBridgeAmountInput("", "1.2")).toBe("");
  });
});

describe("validateBridgeAmount", () => {
  const symbol = "ETH";
  const spendable = parseEther("2");

  it("says nothing while the field is empty or half-typed", () => {
    for (const input of ["", "  ", ".", "0", "0.", "1."]) {
      const result = validateBridgeAmount({ input, spendable, symbol });
      expect(result.error, input).toBeUndefined();
      expect(result.incomplete, input).toBe(true);
      expect(result.wei, input).toBeUndefined();
    }
  });

  it("accepts an amount within reach", () => {
    expect(validateBridgeAmount({ input: "1.5", spendable, symbol })).toEqual({
      wei: parseEther("1.5"),
      incomplete: false,
    });
  });

  it("accepts exactly the spendable amount", () => {
    expect(validateBridgeAmount({ input: "2", spendable, symbol }).error).toBeUndefined();
  });

  it("reports the ceiling when the amount overshoots", () => {
    const result = validateBridgeAmount({ input: "2.000000000000000001", spendable, symbol });
    expect(result.error).toBe("Maximum 2 ETH");
  });

  it("explains a balance that cannot cover fee and gas", () => {
    expect(validateBridgeAmount({ input: "1", spendable: 0n, symbol }).error).toBe(
      "Not enough ETH to cover the deposit and its gas",
    );
  });

  it("rejects a settled zero", () => {
    expect(validateBridgeAmount({ input: "0.0", spendable, symbol }).error).toBe(
      "Enter an amount greater than zero",
    );
  });

  it("rejects text that slipped past the field", () => {
    expect(validateBridgeAmount({ input: "abc", spendable, symbol }).error).toBe(
      "Enter a valid amount",
    );
  });

  it("does not judge the ceiling before the balance has loaded", () => {
    expect(validateBridgeAmount({ input: "999", spendable: undefined, symbol })).toEqual({
      wei: parseEther("999"),
      incomplete: false,
    });
  });
});

describe("token decimals", () => {
  it("caps the fraction at the token's own decimals", () => {
    expect(sanitizeBridgeAmountInput("1.1234567", "", 6)).toBe("1.123456");
  });

  it("parses and reports the ceiling in the token's units", () => {
    // 6-decimal USDnr: 2.5 tokens, ceiling 2 tokens
    const result = validateBridgeAmount({ input: "2.5", spendable: 2_000_000n, symbol: "USDnr", decimals: 6 });
    expect(result.wei).toBe(2_500_000n);
    expect(result.error).toBe("Maximum 2 USDnr");
  });

  it("accepts a 6-decimal amount within the balance", () => {
    expect(validateBridgeAmount({ input: "0.25", spendable: 2_000_000n, symbol: "USDnr", decimals: 6 })).toEqual({
      wei: 250_000n,
      incomplete: false,
    });
  });

  it("does not blame gas for an empty ERC-20 balance", () => {
    expect(validateBridgeAmount({ input: "1", spendable: 0n, symbol: "USDnr", decimals: 6, native: false }).error).toBe(
      "You have no USDnr to deposit",
    );
  });
});
