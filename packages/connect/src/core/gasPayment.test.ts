import { fluentTestnetTokenDefaults } from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import { getFluentGasPaymentTokens, getFluentGasTokenAddress } from "./gasPayment";

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
