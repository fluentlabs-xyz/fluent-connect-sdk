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
  // The live deployment answers `getSentMessageFee()` at the same address on
  // every chain; the per-chain addresses this registry used to carry revert,
  // so they were a stale generation. Verified against Sepolia and Fluent
  // testnet RPC before being pinned here.
  it("loads fluent testnet with bridge contracts", () => {
    expect(fluentChains.testnet.chainId).toBe(20994);
    expect(fluentChains.testnet.contracts?.fluentBridge?.address).toBe(
      "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc",
    );
    expect(fluentChains.testnet.contracts?.nativeGateway?.address).toBe(
      "0x8976Ca4E0c8467097Da675399fB7DB454a1b56dd",
    );
  });

  it("pairs testnet with sepolia", () => {
    const l1 = getL1ForFluentChain(fluentChains.testnet);
    expect(l1?.chainId).toBe(11155111);
    expect(l1?.contracts?.fluentBridge?.address).toBe(
      "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc",
    );
  });

  it("pairs mainnet with ethereum, both carrying a native gateway", () => {
    const l1 = getL1ForFluentChain(fluentChains.mainnet);
    expect(l1?.chainId).toBe(1);
    expect(l1?.contracts?.nativeGateway?.address).toBe(
      fluentChains.mainnet.contracts?.nativeGateway?.address,
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
