/**
 * Fakes: the network (`fetch`), in the pricing barrier's fetch case only.
 */
import {
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  isFluentDefaultToken,
  type FluentTokenBalance,
} from "@fluent.xyz/connect-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFluentTokenUsdPricePoints, getFluentPriceableTokens } from "./tokenPrices";
import { sumFluentTokenBalancesUsd } from "../hooks/useFluentTokenBalances";

/** Claims Fluent's own stablecoin ticker from a different contract. */
const FAKE_USDNR = {
  chainId: 20994,
  address: "0x000000000000000000000000000000000000dEaD" as const,
  symbol: "USDnr",
  name: "Definitely USDnr",
  decimals: 18,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isFluentDefaultToken", () => {
  it("matches on identity, not on symbol", () => {
    expect(isFluentDefaultToken(fluentTestnetTokenDefaults.USDnr)).toBe(true);
    expect(isFluentDefaultToken(fluentTestnetTokenDefaults.ETH)).toBe(true);
    expect(isFluentDefaultToken(FAKE_USDNR)).toBe(false);
  });

  it("does not let a token be one of ours on the wrong chain", () => {
    expect(
      isFluentDefaultToken({ ...fluentTestnetTokenDefaults.USDnr, chainId: 999 }),
    ).toBe(false);
  });
});

describe("pricing barrier", () => {
  const pricesByIdentity = { [fluentTokenIdentity(fluentTestnetTokenDefaults.USDnr)]: 1 };

  it("only asks the price feeds about tokens we vouch for", () => {
    const tokens = getFluentPriceableTokens([fluentTestnetTokenDefaults.ETH, FAKE_USDNR]);

    expect(tokens).toEqual([fluentTestnetTokenDefaults.ETH]);
  });

  it("refuses to price an impostor even though its symbol is priced", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    const points = await fetchFluentTokenUsdPricePoints([
      fluentTestnetTokenDefaults.USDnr,
      FAKE_USDNR,
    ]);

    expect(points[fluentTokenIdentity(fluentTestnetTokenDefaults.USDnr)]?.current).toBe(1);
    expect(points[fluentTokenIdentity(FAKE_USDNR)]).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an impostor's balance out of the portfolio total", () => {
    const balances: FluentTokenBalance[] = [
      {
        ...fluentTestnetTokenDefaults.USDnr,
        raw: 5_000_000n,
        formatted: "5",
        status: "ready",
      },
      // A million of these would read as $1,000,000 if pricing went by symbol.
      { ...FAKE_USDNR, raw: 10n ** 24n, formatted: "1000000", status: "ready" },
    ];

    expect(sumFluentTokenBalancesUsd(balances, pricesByIdentity)).toBe(5);
  });

  it("returns null when nothing on the list can be priced", () => {
    const balances: FluentTokenBalance[] = [
      { ...FAKE_USDNR, raw: 1n, formatted: "1", status: "ready" },
    ];

    expect(sumFluentTokenBalancesUsd(balances, pricesByIdentity)).toBeNull();
  });
});
