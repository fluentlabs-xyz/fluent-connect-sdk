import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFluentTokenUsdPriceCache,
  FLUENT_TOKEN_PRICE_TTL_MS,
  getCoinGeckoMarketChartRangeUrl,
  getFluentTokenUsdPriceExpiry,
  peekFluentTokenUsdPricePoints,
  readFluentTokenUsdPricePoints,
} from "./tokenPrices";

describe("getCoinGeckoMarketChartRangeUrl", () => {
  it("builds a CoinGecko market chart range URL", () => {
    expect(getCoinGeckoMarketChartRangeUrl("fluent-network", 1_700_000_000, 1_700_086_400)).toBe(
      "https://api.coingecko.com/api/v3/coins/fluent-network/market_chart/range?vs_currency=usd&from=1700000000&to=1700086400",
    );
  });
});

/**
 * Fakes: `fetch`, standing in for Coinbase (a spot price) and CoinGecko (a
 * chart with one sample); and the clock, which the cache reads through `Date.now()`.
 */
describe("readFluentTokenUsdPricePoints", () => {
  const spotCalls = () =>
    vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("coinbase")).length;

  function stubFeeds(spot = "2000") {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("coinbase")
        ? { data: { amount: spot, base: "ETH", currency: "USD" } }
        : { prices: [[Date.now() - 24 * 60 * 60 * 1000, 1900]] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    clearFluentTokenUsdPriceCache();
    vi.stubGlobal("fetch", stubFeeds());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks the feeds once for a symbol read twice within the TTL", async () => {
    const first = await readFluentTokenUsdPricePoints(["ETH", "USDnr"]);
    vi.advanceTimersByTime(FLUENT_TOKEN_PRICE_TTL_MS - 1);
    const second = await readFluentTokenUsdPricePoints(["ETH", "USDnr"]);

    expect(spotCalls()).toBe(1);
    expect(second).toEqual(first);
    expect(second.ETH).toEqual({ current: 2000, price24hAgo: 1900 });
    // A fixed price is answered without a feed, so it never counts toward the quota.
    expect(second.USDnr).toEqual({ current: 1, price24hAgo: 1 });
  });

  it("asks the feeds again once the TTL has run out", async () => {
    await readFluentTokenUsdPricePoints(["ETH"]);
    vi.stubGlobal("fetch", stubFeeds("2100"));
    vi.advanceTimersByTime(FLUENT_TOKEN_PRICE_TTL_MS);

    const refreshed = await readFluentTokenUsdPricePoints(["ETH"]);

    expect(spotCalls()).toBe(1);
    expect(refreshed.ETH?.current).toBe(2100);
  });

  it("shares one request between readers that ask at the same time", async () => {
    const [a, b] = await Promise.all([
      readFluentTokenUsdPricePoints(["ETH"]),
      readFluentTokenUsdPricePoints(["ETH", "BLEND"]),
    ]);

    expect(spotCalls()).toBe(2);
    expect(a.ETH).toEqual(b.ETH);
  });

  it("does not ask again before the TTL for a symbol the feeds had no answer for", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const first = await readFluentTokenUsdPricePoints(["ETH"]);
    vi.stubGlobal("fetch", stubFeeds());
    const second = await readFluentTokenUsdPricePoints(["ETH"]);

    expect(first.ETH).toBeUndefined();
    expect(second.ETH).toBeUndefined();
    expect(spotCalls()).toBe(0);

    vi.advanceTimersByTime(FLUENT_TOKEN_PRICE_TTL_MS);
    const third = await readFluentTokenUsdPricePoints(["ETH"]);
    expect(third.ETH?.current).toBe(2000);
  });

  it("peeks only at answers that are still fresh, and names when the oldest ages out", async () => {
    const start = Date.now();
    await readFluentTokenUsdPricePoints(["ETH"]);

    expect(peekFluentTokenUsdPricePoints(["ETH", "USDnr"])).toEqual({
      ETH: { current: 2000, price24hAgo: 1900 },
      USDnr: { current: 1, price24hAgo: 1 },
    });
    expect(getFluentTokenUsdPriceExpiry(["ETH", "USDnr"])).toBe(start + FLUENT_TOKEN_PRICE_TTL_MS);
    expect(getFluentTokenUsdPriceExpiry(["USDnr"])).toBeNull();

    vi.advanceTimersByTime(FLUENT_TOKEN_PRICE_TTL_MS);
    expect(peekFluentTokenUsdPricePoints(["ETH"])).toEqual({});
  });
});
