/**
 * @vitest-environment jsdom
 *
 * The wallet menu and the Bridge page mount this hook every time they open,
 * and the feeds behind it belong to other people: a page opened ten times in a
 * minute asks them once, and a page left open asks again only when the cache's
 * TTL runs out.
 *
 * Fakes: `fetch`, standing in for Coinbase and CoinGecko; and the clock.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fluentTestnetTokenDefaults } from "@fluent.xyz/connect-sdk";
import { clearFluentTokenUsdPriceCache, FLUENT_TOKEN_PRICE_TTL_MS } from "../core/tokenPrices";
import { useFluentTokenUsdPrices } from "./useFluentTokenUsdPrices";

const TOKENS = [fluentTestnetTokenDefaults.ETH, fluentTestnetTokenDefaults.USDnr];
const ETH_IDENTITY = "20994:native";

const spotCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("coinbase")).length;

function stubFeeds(spot: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("coinbase")
      ? { data: { amount: spot, base: "ETH", currency: "USD" } }
      : { prices: [[Date.now() - 24 * 60 * 60 * 1000, 1900]] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  clearFluentTokenUsdPriceCache();
  vi.stubGlobal("fetch", stubFeeds("2000"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useFluentTokenUsdPrices", () => {
  it("asks the feeds once however often it mounts within the TTL", async () => {
    const first = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    expect(first.result.current.busy).toBe(true);
    await settle();
    expect(first.result.current.busy).toBe(false);
    expect(first.result.current.prices[ETH_IDENTITY]).toBe(2000);
    first.unmount();

    const second = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    // Served from the cache on the first render: no loading state to wait out.
    expect(second.result.current.busy).toBe(false);
    expect(second.result.current.prices[ETH_IDENTITY]).toBe(2000);
    await settle();

    expect(spotCalls()).toBe(1);
  });

  it("reads again when the TTL runs out while it stays mounted, and not before", async () => {
    const { result } = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    await settle();
    vi.stubGlobal("fetch", stubFeeds("2100"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUENT_TOKEN_PRICE_TTL_MS - 1);
    });
    expect(spotCalls()).toBe(0);
    expect(result.current.prices[ETH_IDENTITY]).toBe(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(spotCalls()).toBe(1);
    expect(result.current.prices[ETH_IDENTITY]).toBe(2100);
  });

  it("stops reading once it unmounts", async () => {
    const { unmount } = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    await settle();
    vi.stubGlobal("fetch", stubFeeds("2100"));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUENT_TOKEN_PRICE_TTL_MS * 2);
    });
    expect(spotCalls()).toBe(0);
  });
});
