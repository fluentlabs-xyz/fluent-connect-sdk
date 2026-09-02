import { describe, expect, it, vi } from "vitest";

import {
  fluentTestnetTokenDefaults,
  fluentTokenKey,
  getFluentDefaultWidgetDisplayTokens,
  getFluentDefaultWidgetGasTokens,
  readFluentTokenBalances,
} from "./balances.js";

describe("display tokens vs gas tokens", () => {
  it("lists more display tokens than the paymaster can charge", () => {
    const display = getFluentDefaultWidgetDisplayTokens("testnet");
    const gas = getFluentDefaultWidgetGasTokens("testnet");

    expect(display.map((token) => token.symbol)).toEqual([
      "ETH",
      "USDnr",
      "BLEND",
      "USDC",
      "USDT",
    ]);
    // Gas order is paymaster priority, independent of display order.
    expect(gas.map((token) => token.symbol)).toEqual(["USDnr", "BLEND", "ETH"]);
  });

  it("keeps gas tokens a subset of display tokens on every network", () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const displayKeys = new Set(
        getFluentDefaultWidgetDisplayTokens(network).map(fluentTokenKey),
      );
      for (const token of getFluentDefaultWidgetGasTokens(network)) {
        expect(displayKeys.has(fluentTokenKey(token))).toBe(true);
      }
    }
  });
});

describe("fluentTokenKey", () => {
  it("identifies a token by chain and address, ignoring symbol and casing", () => {
    const blend = fluentTestnetTokenDefaults.BLEND;

    expect(fluentTokenKey(blend)).toBe(`20994:${blend.address.toLowerCase()}`);
    // A hand-added impostor claiming the same symbol gets a different identity.
    expect(
      fluentTokenKey({
        chainId: 20994,
        address: "0x000000000000000000000000000000000000dEaD",
      }),
    ).not.toBe(fluentTokenKey(blend));
    // Same token, different checksum casing, same identity.
    expect(
      fluentTokenKey({ chainId: 20994, address: blend.address.toUpperCase() as `0x${string}` }),
    ).toBe(fluentTokenKey(blend));
  });

  it("separates native currency from an ERC-20 on the same chain", () => {
    expect(fluentTokenKey(fluentTestnetTokenDefaults.ETH)).toBe("20994:native");
    expect(fluentTokenKey(fluentTestnetTokenDefaults.USDnr)).not.toBe("20994:native");
  });
});

describe("readFluentTokenBalances", () => {
  it("returns native, ERC-20, and unconfigured token states", async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n),
      readContract: vi.fn()
        .mockResolvedValueOnce(5_000_000n)
        .mockResolvedValueOnce(5_000_000_000_000_000_000n),
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

    // Nativeness comes from the `native` flag, so the impostor is charged
    // against its own contract rather than reporting the account's ETH.
    expect(client.getBalance).not.toHaveBeenCalled();
    expect(client.readContract).toHaveBeenCalledOnce();
    expect(balance).toMatchObject({ symbol: "ETH", formatted: "7", status: "ready" });
  });
});
