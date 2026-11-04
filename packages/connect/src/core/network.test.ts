import { describe, expect, it } from "vitest";
import { getFluentDefaultWidgetGasTokens } from "@fluent.xyz/connect-sdk";

import {
  getFluentChainForNetwork,
  getFluentWidgetDefaultScopes,
  isFaucetNetwork,
  normalizeFluentWidgetNetwork,
} from "./network";

describe("Fluent widget network policy", () => {
  it("enables Faucet only on development networks", () => {
    expect(isFaucetNetwork("testnet")).toBe(true);
    expect(isFaucetNetwork("mainnet")).toBe(false);
  });

  it("requests the faucet authorization scope only on development networks", () => {
    expect(getFluentWidgetDefaultScopes("testnet")).toContain("faucet");
    expect(getFluentWidgetDefaultScopes("mainnet")).not.toContain("faucet");
  });

  it("maps networks to Fluent chains and default gas tokens", () => {
    expect(getFluentChainForNetwork("testnet").id).toBe(20994);
    expect(getFluentChainForNetwork("mainnet").id).toBe(25363);
    expect(getFluentDefaultWidgetGasTokens("mainnet").map((token) => token.symbol)).toEqual([
      "BLEND",
      "USDnr",
      "ETH",
    ]);
  });
});

describe("normalizeFluentWidgetNetwork", () => {
  it.each([
    ["testnet", "testnet"],
    ["mainnet", "mainnet"],
    ["dev", "testnet"],
    ["development", "testnet"],
    ["prod", "mainnet"],
    ["production", "mainnet"],
    ["  Production ", "mainnet"],
    ["MAINNET", "mainnet"],
  ])("maps %j to %j, trimmed and in any case", (value, network) => {
    expect(normalizeFluentWidgetNetwork(value)).toBe(network);
  });

  it.each(["", "   ", "staging", "main net", undefined, null])(
    "answers undefined for %j rather than guessing a Network",
    (value) => {
      expect(normalizeFluentWidgetNetwork(value)).toBeUndefined();
    },
  );
});
