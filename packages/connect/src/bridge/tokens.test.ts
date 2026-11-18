/** Which token the Bridge page opens with on each network. No fakes. */
import { describe, expect, it } from "vitest";

import { getDefaultBridgeToken, getDeliveredToken } from "./tokens";

describe("the token the Bridge page opens with", () => {
  it("is USDC on mainnet, delivered as USDnr", () => {
    const token = getDefaultBridgeToken("mainnet");
    expect(token.symbol).toBe("USDC");
    expect(getDeliveredToken("mainnet", token).symbol).toBe("USDnr");
  });

  it("is ETH where USDC cannot be bridged", () => {
    expect(getDefaultBridgeToken("testnet").symbol).toBe("ETH");
  });
});
