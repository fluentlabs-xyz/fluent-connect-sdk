import { describe, expect, it } from "vitest";
import { getFluentChainForNetwork, getFluentDefaultDisplayTokens, getFluentDefaultGasTokens, getFluentWidgetDefaultScopes, isFaucetNetwork } from "./network";

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
    expect(getFluentDefaultGasTokens("mainnet").map((token) => token.symbol)).toEqual([
      "USDnr",
      "BLEND",
      "ETH",
    ]);
  });

  it("displays tokens the paymaster cannot charge", () => {
    expect(getFluentDefaultDisplayTokens("testnet").map((token) => token.symbol)).toContain(
      "USDC",
    );
    expect(getFluentDefaultGasTokens("testnet").map((token) => token.symbol)).not.toContain(
      "USDC",
    );
  });
});
