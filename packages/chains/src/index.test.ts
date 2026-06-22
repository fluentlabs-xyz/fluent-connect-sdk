import { describe, expect, it } from "vitest";
import { fluent, fluentTestnet, sepolia } from "./index.js";

describe("@fluent/chains", () => {
  it("exports viem chains with correct ids", () => {
    expect(fluentTestnet.id).toBe(20994);
    expect(fluent.devnet.id).toBe(20993);
    expect(fluent.mainnet.id).toBe(25363);
  });

  it("includes bridge contract on testnet", () => {
    expect(fluentTestnet.contracts?.fluentBridge?.address).toBe(
      "0x22795142Ceb81A2b676c72a369edb99990A3622B",
    );
  });

  it("sets sourceId from parent L1", () => {
    expect(fluentTestnet.sourceId).toBe(11155111);
    expect(sepolia.contracts?.fluentBridge?.address).toBe(
      "0x990568FfaDddBDBF614ff1EA0eF5630BD8957Ddc",
    );
  });
});
