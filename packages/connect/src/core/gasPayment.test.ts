import { fluentTestnetTokenDefaults } from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import {
  formatFluentGasTokenBalance,
  getFluentGasPaymentTokens,
  getFluentGasTokenAddress,
} from "./gasPayment";

describe("getFluentGasPaymentTokens", () => {
  it("orders the payable tokens by gasPriority", () => {
    const gas = getFluentGasPaymentTokens(Object.values(fluentTestnetTokenDefaults));

    expect(gas.map((token) => token.symbol)).toEqual(["BLEND", "USDnr", "ETH"]);
  });

  it("ignores a gasPriority on a token we do not ship", () => {
    // An integrator's tokens come straight off a prop, so the flag alone must
    // not be enough to have the widget pay fees in someone else's token.
    const integratorToken = {
      chainId: 20994,
      address: "0x000000000000000000000000000000000000dEaD" as const,
      symbol: "THEIRS",
      name: "A builder's token",
      decimals: 18,
      gasPriority: 0,
    };

    const gas = getFluentGasPaymentTokens([
      integratorToken,
      fluentTestnetTokenDefaults.USDnr,
    ]);

    expect(gas.map((token) => token.symbol)).toEqual(["USDnr"]);
  });

  it("leaves out a token we ship without a gasPriority", () => {
    const notPayable = { ...fluentTestnetTokenDefaults.USDnr, gasPriority: undefined };

    expect(getFluentGasPaymentTokens([notPayable])).toEqual([]);
  });
});

describe("getFluentGasTokenAddress", () => {
  it("returns the paymaster address for an ERC-20 fee token", () => {
    expect(getFluentGasTokenAddress("USDnr", "testnet")).toBe(
      fluentTestnetTokenDefaults.USDnr.address,
    );
  });

  it("returns nothing for the native currency and for unknown symbols", () => {
    // ETH pays gas directly, so there is no paymaster token to charge.
    expect(getFluentGasTokenAddress("ETH", "testnet")).toBeUndefined();
    expect(getFluentGasTokenAddress("THEIRS", "testnet")).toBeUndefined();
  });
});

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
    })).toBe("1.2");

    expect(formatFluentGasTokenBalance({
      raw: 115456n,
      decimals: 3,
      formatted: "115.456",
    })).toBe("115.5");
  });

  it("does not pad balances that already have one or fewer decimals", () => {
    expect(formatFluentGasTokenBalance({
      raw: 12n,
      decimals: 1,
      formatted: "1.2",
    })).toBe("1.2");
  });

  it("uses en-US thousands separators", () => {
    expect(formatFluentGasTokenBalance({
      raw: 100000n * 10n ** 18n,
      decimals: 18,
      formatted: "100000",
    })).toBe("100,000");
  });

  it("widens precision instead of rounding a non-zero balance down to 0", () => {
    // 0.001 ETH: the wallet menu asks for 0 decimals, but a flat "0" next to a
    // non-zero USD value is wrong.
    expect(formatFluentGasTokenBalance({
      raw: 10n ** 15n,
      decimals: 18,
      formatted: "0.001",
    }, 0)).toBe("0.001");

    expect(formatFluentGasTokenBalance({
      raw: 25n * 10n ** 4n,
      decimals: 6,
      formatted: "0.25",
    }, 0)).toBe("0.3");
  });

  it("keeps the requested precision when it already shows a significant digit", () => {
    expect(formatFluentGasTokenBalance({
      raw: 12345n * 10n ** 15n,
      decimals: 18,
      formatted: "12.345",
    }, 0)).toBe("12");

    expect(formatFluentGasTokenBalance({
      raw: 0n,
      decimals: 18,
      formatted: "0",
    }, 0)).toBe("0");
  });

  it("collapses dust below the precision cap to 0", () => {
    // Worth no USD either, so the row stays readable; the exact amount is shown
    // on hover instead.
    expect(formatFluentGasTokenBalance({
      raw: 1n,
      decimals: 18,
      formatted: "0.000000000000000001",
    }, 0)).toBe("0");
  });
});
