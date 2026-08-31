import { describe, expect, it } from "vitest";
import {
  fluentChains,
  fluentZeroDevChainIds,
  getFluentChainByChainId,
  getL1ForFluentChain,
  getZeroDevRpcUrl,
  l1Chains,
} from "./data.js";

describe("registry data", () => {
  it("loads fluent testnet with bridge contracts", () => {
    expect(fluentChains.testnet.chainId).toBe(20994);
    expect(fluentChains.testnet.contracts?.fluentBridge?.address).toBe(
      "0x22795142Ceb81A2b676c72a369edb99990A3622B",
    );
  });

  it("pairs testnet with sepolia", () => {
    const l1 = getL1ForFluentChain(fluentChains.testnet);
    expect(l1?.chainId).toBe(11155111);
    expect(l1?.contracts?.fluentBridge?.address).toBe(
      "0x990568FfaDddBDBF614ff1EA0eF5630BD8957Ddc",
    );
  });

  it("resolves chain by id", () => {
    expect(getFluentChainByChainId(20994)?.id).toBe("fluent-testnet");
    expect(getFluentChainByChainId(25363)?.id).toBe("fluent-mainnet");
  });

  it("loads sepolia L1 bridge", () => {
    expect(l1Chains.sepolia.pairedL2).toBe("fluent-testnet");
  });

  it("builds ZeroDev RPC URL for Fluent testnet", () => {
    expect(fluentZeroDevChainIds).toContain(20994);
    expect(fluentZeroDevChainIds).toContain(25363);
    expect(
      getZeroDevRpcUrl({ projectId: "test-proj", chainId: 20994 }),
    ).toBe("https://rpc.zerodev.app/api/v3/test-proj/chain/20994");
  });
});
