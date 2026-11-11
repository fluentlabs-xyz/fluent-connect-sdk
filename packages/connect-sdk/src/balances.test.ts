import { describe, expect, it, vi } from "vitest";

import {
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  getFluentDefaultWidgetDisplayTokens,
  getFluentDefaultWidgetGasTokens,
  getFluentTokenDefaultsForNetwork,
  readFluentTokenBalances,
} from "./balances.js";

describe("getFluentTokenDefaultsForNetwork", () => {
  it("defaults testnet USDnr to the six-decimal token that matches mainnet", () => {
    // The address and the decimals are asserted together: either alone passes while the pair
    // is wrong.
    expect(getFluentTokenDefaultsForNetwork("testnet").USDnr).toMatchObject({
      address: "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1",
      decimals: 6,
    });
    expect(getFluentTokenDefaultsForNetwork("mainnet").USDnr.decimals).toBe(6);
  });
});

describe("Display tokens and Gas tokens", () => {
  it("ships the same three tokens in both lists, ordered for their own purpose", () => {
    // Every Default token is a Gas token, yet the lists stay apart: Integrator and User tokens
    // join the display list and never the gas one.
    const display = getFluentDefaultWidgetDisplayTokens("testnet");
    const gas = getFluentDefaultWidgetGasTokens("testnet");

    expect(display.map((token) => token.symbol)).toEqual(["ETH", "USDnr", "BLEND"]);
    // Gas tokens go by `gasPriority`, independent of display order.
    expect(gas.map((token) => token.symbol)).toEqual(["BLEND", "USDnr", "ETH"]);
  });

  it("keeps gas tokens a subset of display tokens on every network", () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const displayKeys = new Set(
        getFluentDefaultWidgetDisplayTokens(network).map(fluentTokenIdentity),
      );
      for (const token of getFluentDefaultWidgetGasTokens(network)) {
        expect(displayKeys.has(fluentTokenIdentity(token))).toBe(true);
      }
    }
  });
});

describe("fluentTokenIdentity", () => {
  it("identifies a token by chain and address, ignoring symbol and casing", () => {
    const blend = fluentTestnetTokenDefaults.BLEND;

    expect(fluentTokenIdentity(blend)).toBe(`20994:${blend.address.toLowerCase()}`);
    // Another address on the same chain is another token, whatever symbol it claims.
    expect(
      fluentTokenIdentity({
        chainId: 20994,
        address: "0x000000000000000000000000000000000000dEaD",
      }),
    ).not.toBe(fluentTokenIdentity(blend));
    expect(
      fluentTokenIdentity({
        chainId: 20994,
        address: blend.address.toUpperCase() as `0x${string}`,
      }),
    ).toBe(fluentTokenIdentity(blend));
  });

  it("separates native currency from an ERC-20 on the same chain", () => {
    expect(fluentTokenIdentity(fluentTestnetTokenDefaults.ETH)).toBe("20994:native");
    expect(fluentTokenIdentity(fluentTestnetTokenDefaults.USDnr)).not.toBe("20994:native");
  });
});

describe("readFluentTokenBalances", () => {
  it("returns native, ERC-20, and unconfigured token states", async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n),
      readContract: vi
        .fn()
        // In token order: BLEND's eighteen decimals, then USDnr's six.
        .mockResolvedValueOnce(5_000_000n)
        .mockResolvedValueOnce(5_000_000n),
    };

    const balances = await readFluentTokenBalances({
      client: client as never,
      account: "0x0000000000000000000000000000000000000001",
      tokens: [
        fluentTestnetTokenDefaults.ETH,
        fluentTestnetTokenDefaults.BLEND,
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
      symbol: "BLEND",
      formatted: "0.000000000005",
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

  it("reads an ERC-20 that calls itself ETH through its contract", async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n),
      readContract: vi.fn().mockResolvedValue(7_000_000_000_000_000_000n),
    };

    const [balance] = await readFluentTokenBalances({
      client: client as never,
      account: "0x0000000000000000000000000000000000000001",
      tokens: [
        {
          chainId: 20994,
          symbol: "ETH",
          name: "Not actually ether",
          decimals: 18,
          address: "0x000000000000000000000000000000000000dEaD",
        },
      ],
    });

    // Only `native` makes a token the chain's own currency, so a token named ETH is read from
    // its contract.
    expect(client.getBalance).not.toHaveBeenCalled();
    expect(client.readContract).toHaveBeenCalledOnce();
    expect(balance).toMatchObject({ symbol: "ETH", formatted: "7", status: "ready" });
  });
});
