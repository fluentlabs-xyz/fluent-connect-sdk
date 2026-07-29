import { describe, expect, it } from "vitest";
import { getFluentWidgetDefaultScopes, isFaucetNetwork } from "./network";

describe("Fluent widget network policy", () => {
  it("enables Faucet only on development networks", () => {
    expect(isFaucetNetwork("devnet")).toBe(true);
    expect(isFaucetNetwork("testnet")).toBe(true);
    expect(isFaucetNetwork("mainnet")).toBe(false);
  });

  it("requests the faucet authorization scope only on development networks", () => {
    expect(getFluentWidgetDefaultScopes("testnet")).toContain("faucet");
    expect(getFluentWidgetDefaultScopes("mainnet")).not.toContain("faucet");
  });
});
