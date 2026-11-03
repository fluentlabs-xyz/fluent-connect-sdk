/**
 * Fakes: the network (`fetch`). The module under test runs for real.
 */
import {
  fluentMainnetTokenDefaults,
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
} from "@fluent.xyz/connect-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FLUENT_PRICE_REQUEST_TIMEOUT_MS,
  fetchFluentTokenUsdPricePoints,
  getCoinGeckoMarketChartRangeUrl,
  getDefiLlamaCurrentPricesUrl,
  getDefiLlamaHistoricalPricesUrl,
  resolveDefiLlamaCoinKey,
} from "./tokenPrices";

const DAY_MS = 24 * 60 * 60 * 1000;

const MAINNET = fluentMainnetTokenDefaults;
const TESTNET = fluentTestnetTokenDefaults;
const MAINNET_BLEND_KEY = `fluent:${MAINNET.BLEND.address}`;

type Answer = Response | "hang" | "unreachable";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function coinbaseSpot(amount: number) {
  return json({ data: { amount: String(amount), currency: "USD" } });
}

function coinGeckoChart(price24hAgo: number) {
  return json({ prices: [[Date.now() - DAY_MS, price24hAgo]] });
}

function defiLlama(prices: Record<string, number>) {
  const coins: Record<string, { price: number; timestamp: number; confidence: number }> = {};
  for (const [coinKey, price] of Object.entries(prices)) {
    coins[coinKey] = { price, timestamp: Math.floor(Date.now() / 1000), confidence: 0.99 };
  }
  return json({ coins });
}

const isCoinbase = (url: string) => url.includes("api.coinbase.com");
const isCoinGecko = (url: string) => url.includes("api.coingecko.com");
const isDefiLlamaCurrent = (url: string) => url.includes("coins.llama.fi/prices/current/");
const isDefiLlamaHistorical = (url: string) => url.includes("coins.llama.fi/prices/historical/");

/**
 * Stands in for the browser's `fetch`. `answer` decides per URL; a `"hang"`
 * answer settles only when the caller's abort signal fires, the way a request
 * the network never answers does.
 */
function stubFetch(answer: (url: string) => Answer) {
  const requests: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    const result = answer(url);
    if (result === "unreachable") throw new TypeError("Failed to fetch");
    if (result === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }
    return result;
  });
  vi.stubGlobal("fetch", fetch);
  return requests;
}

/** The feeds answering the way they do on a good day. */
function healthyFeeds(url: string): Answer {
  if (isCoinbase(url)) return coinbaseSpot(url.includes("BLEND") ? 0.05 : 2500);
  if (isCoinGecko(url)) return coinGeckoChart(url.includes("fluent-network") ? 0.04 : 2400);
  return json({}, 404);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchFluentTokenUsdPricePoints", () => {
  it("prices Default tokens from Coinbase and CoinGecko without asking DefiLlama", async () => {
    const requests = stubFetch(healthyFeeds);

    const points = await fetchFluentTokenUsdPricePoints([
      MAINNET.ETH,
      MAINNET.USDnr,
      MAINNET.BLEND,
    ]);

    expect(points).toEqual({
      [fluentTokenIdentity(MAINNET.ETH)]: { current: 2500, price24hAgo: 2400 },
      [fluentTokenIdentity(MAINNET.USDnr)]: { current: 1, price24hAgo: 1 },
      [fluentTokenIdentity(MAINNET.BLEND)]: { current: 0.05, price24hAgo: 0.04 },
    });
    expect(requests.some((url) => url.includes("llama.fi"))).toBe(false);
    expect(requests.some((url) => url.includes("USDnr"))).toBe(false);
  });

  it("asks DefiLlama by Token identity when Coinbase fails for a mainnet ERC-20", async () => {
    const requests = stubFetch((url) => {
      if (isCoinbase(url) && url.includes("BLEND")) return json({ errors: [] }, 403);
      if (isDefiLlamaCurrent(url)) return defiLlama({ [MAINNET_BLEND_KEY]: 0.048 });
      return healthyFeeds(url);
    });

    const points = await fetchFluentTokenUsdPricePoints([MAINNET.ETH, MAINNET.BLEND]);

    expect(points[fluentTokenIdentity(MAINNET.BLEND)]).toEqual({
      current: 0.048,
      price24hAgo: 0.04,
    });
    expect(points[fluentTokenIdentity(MAINNET.ETH)]?.current).toBe(2500);
    expect(requests.filter(isDefiLlamaCurrent)).toEqual([
      getDefiLlamaCurrentPricesUrl([MAINNET_BLEND_KEY]),
    ]);
  });

  it("asks DefiLlama by CoinGecko id for the chain's own coin and on the testnet", async () => {
    const requests = stubFetch((url) => {
      if (isCoinbase(url)) return "unreachable";
      if (isDefiLlamaCurrent(url)) {
        return defiLlama({ "coingecko:ethereum": 2510, "coingecko:fluent-network": 0.047 });
      }
      return healthyFeeds(url);
    });

    const points = await fetchFluentTokenUsdPricePoints([TESTNET.ETH, TESTNET.BLEND]);

    expect(points[fluentTokenIdentity(TESTNET.ETH)]?.current).toBe(2510);
    expect(points[fluentTokenIdentity(TESTNET.BLEND)]?.current).toBe(0.047);
    expect(requests.filter(isDefiLlamaCurrent)).toEqual([
      getDefiLlamaCurrentPricesUrl(["coingecko:ethereum", "coingecko:fluent-network"]),
    ]);
  });

  it("matches a DefiLlama answer to its token whatever the address's case", async () => {
    stubFetch((url) => {
      if (isCoinbase(url) && url.includes("BLEND")) return "unreachable";
      if (isDefiLlamaCurrent(url)) {
        return defiLlama({ [MAINNET_BLEND_KEY.toUpperCase()]: 0.048 });
      }
      return healthyFeeds(url);
    });

    const points = await fetchFluentTokenUsdPricePoints([MAINNET.BLEND]);

    expect(points[fluentTokenIdentity(MAINNET.BLEND)]?.current).toBe(0.048);
  });

  it("takes the price 24 hours ago from DefiLlama when CoinGecko's chart fails", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00Z") });
    const requests = stubFetch((url) => {
      if (isCoinGecko(url)) return json({ status: { error_code: 429 } }, 429);
      if (isDefiLlamaHistorical(url)) return defiLlama({ [MAINNET_BLEND_KEY]: 0.051 });
      return healthyFeeds(url);
    });

    const points = await fetchFluentTokenUsdPricePoints([MAINNET.BLEND]);

    expect(points[fluentTokenIdentity(MAINNET.BLEND)]).toEqual({
      current: 0.05,
      price24hAgo: 0.051,
    });
    expect(requests.filter(isDefiLlamaHistorical)).toEqual([
      getDefiLlamaHistoricalPricesUrl(
        [MAINNET_BLEND_KEY],
        Math.floor(Date.now() / 1000) - 24 * 60 * 60,
      ),
    ]);
  });

  it("reports the current price as the 24-hour one when no history source answers", async () => {
    stubFetch((url) => {
      if (isCoinGecko(url)) return "unreachable";
      if (isDefiLlamaHistorical(url)) return json({ message: "down" }, 500);
      return healthyFeeds(url);
    });

    const points = await fetchFluentTokenUsdPricePoints([MAINNET.ETH]);

    expect(points[fluentTokenIdentity(MAINNET.ETH)]).toEqual({
      current: 2500,
      price24hAgo: 2500,
    });
  });

  it("leaves a token out when no provider has its current price", async () => {
    stubFetch(() => "unreachable");

    const points = await fetchFluentTokenUsdPricePoints([MAINNET.ETH, MAINNET.USDnr]);

    expect(points).toEqual({
      [fluentTokenIdentity(MAINNET.USDnr)]: { current: 1, price24hAgo: 1 },
    });
  });

  it("gives up on a hanging provider after the timeout and moves on to DefiLlama", async () => {
    vi.useFakeTimers();
    stubFetch((url) => {
      if (isCoinbase(url)) return "hang";
      if (isDefiLlamaCurrent(url)) return defiLlama({ [MAINNET_BLEND_KEY]: 0.048 });
      return healthyFeeds(url);
    });

    const pending = fetchFluentTokenUsdPricePoints([MAINNET.BLEND]);
    await vi.advanceTimersByTimeAsync(FLUENT_PRICE_REQUEST_TIMEOUT_MS);
    const points = await pending;

    expect(points[fluentTokenIdentity(MAINNET.BLEND)]).toEqual({
      current: 0.048,
      price24hAgo: 0.04,
    });
  });
});

describe("resolveDefiLlamaCoinKey", () => {
  it("names a mainnet ERC-20 by its address and everything else by CoinGecko id", () => {
    expect(resolveDefiLlamaCoinKey(MAINNET.BLEND)).toBe(MAINNET_BLEND_KEY);
    expect(resolveDefiLlamaCoinKey(MAINNET.ETH)).toBe("coingecko:ethereum");
    expect(resolveDefiLlamaCoinKey(TESTNET.BLEND)).toBe("coingecko:fluent-network");
  });

  it("has no key for a token no feed knows", () => {
    expect(resolveDefiLlamaCoinKey({ ...TESTNET.BLEND, symbol: "WHAT" })).toBeNull();
  });
});

describe("price feed URLs", () => {
  it("builds a CoinGecko market chart range URL", () => {
    expect(getCoinGeckoMarketChartRangeUrl("fluent-network", 1_700_000_000, 1_700_086_400)).toBe(
      "https://api.coingecko.com/api/v3/coins/fluent-network/market_chart/range" +
        "?vs_currency=usd&from=1700000000&to=1700086400",
    );
  });

  it("builds DefiLlama current and historical price URLs", () => {
    expect(getDefiLlamaCurrentPricesUrl(["coingecko:ethereum", MAINNET_BLEND_KEY])).toBe(
      `https://coins.llama.fi/prices/current/coingecko:ethereum,${MAINNET_BLEND_KEY}`,
    );
    expect(getDefiLlamaHistoricalPricesUrl([MAINNET_BLEND_KEY], 1_700_000_000)).toBe(
      `https://coins.llama.fi/prices/historical/1700000000/${MAINNET_BLEND_KEY}`,
    );
  });
});
