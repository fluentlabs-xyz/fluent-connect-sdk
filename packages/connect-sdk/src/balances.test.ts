import { describe, expect, it, vi } from "vitest";

import {
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
} from "./balances.js";

describe("readFluentTokenBalances", () => {
  it("returns native, ERC-20, and unconfigured token states", async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n),
      readContract: vi.fn().mockResolvedValue(5_000_000n),
    };

    const balances = await readFluentTokenBalances({
      client: client as never,
      account: "0x0000000000000000000000000000000000000001",
      tokens: [
        fluentTestnetTokenDefaults.ETH,
        fluentTestnetTokenDefaults.USDC,
        fluentTestnetTokenDefaults.USDnr,
        {
          chainId: 20994,
          symbol: "MISSING",
          name: "Unconfigured token",
          decimals: 18,
        },
      ],
    });

    expect(balances[0]).toMatchObject({
      symbol: "ETH",
      formatted: "2",
      status: "ready",
    });
    expect(balances[1]).toMatchObject({
      symbol: "USDC",
      formatted: "5",
      status: "ready",
    });
    expect(balances[2]).toMatchObject({
      symbol: "USDnr",
      formatted: "5",
      status: "ready",
    });
    expect(balances[3]).toMatchObject({
      symbol: "MISSING",
      formatted: null,
      status: "not-configured",
    });
  });
});
