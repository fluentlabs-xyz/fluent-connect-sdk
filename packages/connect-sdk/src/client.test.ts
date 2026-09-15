import { describe, expect, it } from "vitest";
import { http } from "viem";
import { createFluentClient } from "./client.js";
import { fluentTestnet } from "./chains.js";

describe("createFluentClient", () => {
  it("resolves bridge addresses for testnet", () => {
    const client = createFluentClient({
      chain: fluentTestnet,
      transport: http(),
    });

    // Both sides answer at the same address on the live deployment; the
    // per-chain addresses this used to pin revert on-chain.
    expect(client.addresses.bridge.l2?.proxy).toBe(
      "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc",
    );
    expect(client.addresses.bridge.l1?.proxy).toBe(
      "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc",
    );
    expect(client.definition.id).toBe("fluent-testnet");
  });

  it("resolves the chain from `network` and defaults transport", () => {
    const client = createFluentClient({ network: "testnet" });
    expect(client.chain.id).toBe(fluentTestnet.id);
    expect(client.definition.id).toBe("fluent-testnet");
  });

  it("defaults to testnet when called with no config", () => {
    const client = createFluentClient();
    expect(client.chain.id).toBe(fluentTestnet.id);
  });

  it("selects mainnet when requested", () => {
    const client = createFluentClient({ network: "mainnet" });
    expect(client.definition.id).toBe("fluent-mainnet");
  });
});
