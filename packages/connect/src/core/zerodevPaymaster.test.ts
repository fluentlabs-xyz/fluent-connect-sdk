import {
  fluentMainnetTokenDefaults,
  fluentTestnetTokenDefaults,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
} from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import {
  getFluentZeroDevErc20PaymasterTokens,
  resolveFluentZeroDevErc20PaymasterToken,
} from "./zerodevPaymaster";

describe("getFluentZeroDevErc20PaymasterTokens", () => {
  it("derives address and decimals from the token definitions", () => {
    expect(getFluentZeroDevErc20PaymasterTokens("testnet")).toEqual({
      USDNR: {
        address: fluentTestnetTokenDefaults.USDnr.address,
        decimals: fluentTestnetTokenDefaults.USDnr.decimals,
        symbol: "USDnr",
      },
      BLEND: {
        address: fluentTestnetTokenDefaults.BLEND.address,
        decimals: fluentTestnetTokenDefaults.BLEND.decimals,
        symbol: "BLEND",
      },
    });
  });

  it("uses each network's own addresses", () => {
    const mainnet = getFluentZeroDevErc20PaymasterTokens("mainnet");

    expect(mainnet.USDNR?.address).toBe(fluentMainnetTokenDefaults.USDnr.address);
    expect(mainnet.USDNR?.address).not.toBe(fluentTestnetTokenDefaults.USDnr.address);
  });

  it("leaves out the native currency, which has no token to approve", () => {
    expect(getFluentZeroDevErc20PaymasterTokens("testnet")).not.toHaveProperty("ETH");
  });

  it("stays in step with the gas tokens on every network", () => {
    // The regression this whole derivation exists for: a token given a
    // `gasPriority` used to appear in the gas selector while this map, being
    // hand-written, stayed unaware of it — so the UserOp would fail.
    for (const network of ["testnet", "mainnet"] as const) {
      const payable = getFluentDefaultWidgetGasTokens(network).filter(
        (token) => !isFluentNativeToken(token),
      );
      const paymaster = getFluentZeroDevErc20PaymasterTokens(network);

      expect(Object.keys(paymaster).sort()).toEqual(
        payable.map((token) => token.symbol.toUpperCase()).sort(),
      );
    }
  });
});

describe("resolveFluentZeroDevErc20PaymasterToken", () => {
  it("defaults to BLEND", () => {
    expect(resolveFluentZeroDevErc20PaymasterToken()).toMatchObject({
      address: fluentTestnetTokenDefaults.BLEND.address,
      symbol: "BLEND",
    });
  });

  it("accepts the symbol in any casing", () => {
    expect(resolveFluentZeroDevErc20PaymasterToken("USDnr")).toEqual(
      resolveFluentZeroDevErc20PaymasterToken("USDNR"),
    );
  });

  it("passes a raw address through untouched", () => {
    const address = "0x000000000000000000000000000000000000dEaD" as const;

    expect(resolveFluentZeroDevErc20PaymasterToken(address)).toEqual({ address });
  });

  it("passes an explicit token object through untouched", () => {
    const token = { address: "0x000000000000000000000000000000000000dEaD" as const, symbol: "X" };

    expect(resolveFluentZeroDevErc20PaymasterToken(token)).toBe(token);
  });

  it("throws on a symbol the paymaster cannot charge", () => {
    // Callers reach straight for `.address`, so returning undefined would send
    // `gasToken: undefined` to the paymaster instead of failing here.
    expect(() => resolveFluentZeroDevErc20PaymasterToken("ETH")).toThrow(/cannot pay gas/);
    expect(() => resolveFluentZeroDevErc20PaymasterToken("NOPE")).toThrow(/BLEND, USDNR/);
  });
});
