import {
  fluentMainnet,
  fluentTokenIdentity,
  isFluentDefaultToken,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";

import { debugWarn } from "./debugLogger";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const DEFILLAMA_COINS_API = "https://coins.llama.fi";

/**
 * How long one price request may take before its provider is given up on. A
 * request that hangs would otherwise hold the USD lines in their busy state for
 * as long as the browser lets it hang, and the fallback provider would never be
 * asked.
 */
export const FLUENT_PRICE_REQUEST_TIMEOUT_MS = 5_000;

/** The chain name DefiLlama's coins API gives the Fluent mainnet in a `<chain>:<address>` key. */
const DEFILLAMA_FLUENT_MAINNET_CHAIN = "fluent";

/** Stablecoins — always $1, never fetched from price APIs. */
const FIXED_USD_PRICES: Record<string, number> = {
  USDnr: 1,
};

/** Fluent token symbol → Coinbase spot base asset. */
const COINBASE_BASE_BY_SYMBOL: Record<string, string> = {
  ETH: "ETH",
  BLEND: "BLEND",
};

/**
 * Fluent token symbol → CoinGecko coin id for historical chart data
 * BLEND maps to `fluent-network`
 */
const COINGECKO_COIN_ID_BY_SYMBOL: Record<string, string> = {
  ETH: "ethereum",
  BLEND: "fluent-network",
};

type CoinbaseSpotPriceResponse = {
  data?: {
    amount?: string;
    base?: string;
    currency?: string;
  };
};

type CoinGeckoMarketChartRange = {
  prices?: [number, number][];
};

type DefiLlamaPricesResponse = {
  coins?: Record<string, { price?: number; timestamp?: number; confidence?: number }>;
};

/** The fields of a token definition the price feeds are addressed by. */
export type FluentPriceableToken = Pick<
  FluentTokenDefinition,
  "symbol" | "chainId" | "address" | "native"
>;

export type FluentTokenUsdPricePoint = {
  current: number;
  price24hAgo: number;
};

export function getCoinbaseSpotPriceUrl(symbol: string): string {
  return `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
}

export function getCoinGeckoMarketChartRangeUrl(
  coinId: string,
  fromUnixSeconds: number,
  toUnixSeconds: number,
): string {
  const url = new URL(`${COINGECKO_API}/coins/${encodeURIComponent(coinId)}/market_chart/range`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(fromUnixSeconds));
  url.searchParams.set("to", String(toUnixSeconds));
  return url.toString();
}

/**
 * DefiLlama's current prices for `coinKeys`, which are `<chain>:<address>` or
 * `coingecko:<id>` as {@link resolveDefiLlamaCoinKey} builds them. The keys
 * hold no character the path would need escaped.
 */
export function getDefiLlamaCurrentPricesUrl(coinKeys: readonly string[]): string {
  return `${DEFILLAMA_COINS_API}/prices/current/${coinKeys.join(",")}`;
}

/** DefiLlama's prices for `coinKeys` nearest to `unixSeconds`. */
export function getDefiLlamaHistoricalPricesUrl(
  coinKeys: readonly string[],
  unixSeconds: number,
): string {
  return `${DEFILLAMA_COINS_API}/prices/historical/${unixSeconds}/${coinKeys.join(",")}`;
}

export function resolveCoinbaseBaseSymbol(symbol: string): string | null {
  return COINBASE_BASE_BY_SYMBOL[symbol] ?? null;
}

export function resolveCoinGeckoCoinId(symbol: string): string | null {
  return COINGECKO_COIN_ID_BY_SYMBOL[symbol] ?? null;
}

/**
 * The key DefiLlama's coins API knows a Default token by, or `null` for a token
 * it has no name for.
 *
 * An ERC-20 on the Fluent mainnet goes by its Token identity: DefiLlama indexes
 * that chain, so the price is the contract's and not a ticker's. The chain's own
 * coin has no address, and the testnet is not indexed, so both go by the CoinGecko
 * id the chart feed already uses.
 */
export function resolveDefiLlamaCoinKey(token: FluentPriceableToken): string | null {
  if (!token.native && token.address && token.chainId === fluentMainnet.id) {
    return `${DEFILLAMA_FLUENT_MAINNET_CHAIN}:${token.address}`;
  }
  const coinId = resolveCoinGeckoCoinId(token.symbol);
  return coinId ? `coingecko:${coinId}` : null;
}

export function getFixedUsdPrice(symbol: string): number | null {
  return FIXED_USD_PRICES[symbol] ?? null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLUENT_PRICE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, provider: string): Promise<T> {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} request failed: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchCoinbaseSpotUsdPrice(coinbaseSymbol: string): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(getCoinbaseSpotPriceUrl(coinbaseSymbol));
    if (!response.ok) return null;
    const payload = (await response.json()) as CoinbaseSpotPriceResponse;
    const amount = Number(payload.data?.amount);
    return Number.isFinite(amount) ? amount : null;
  } catch (error) {
    debugWarn("[fluent-connect] Coinbase spot price request failed", coinbaseSymbol, error);
    return null;
  }
}

function pickNearestChartPrice(points: readonly [number, number][], targetMs: number) {
  if (points.length === 0) return null;

  const nearest = points.reduce((best, point) => {
    const bestDistance = Math.abs(best[0] - targetMs);
    const pointDistance = Math.abs(point[0] - targetMs);
    return pointDistance < bestDistance ? point : best;
  });

  const price = nearest[1];
  return Number.isFinite(price) ? price : null;
}

/** Price ~24h ago from CoinGecko market chart (nearest hourly sample). */
export async function fetchCoinGeckoPrice24hAgo(coinId: string): Promise<number> {
  const nowMs = Date.now();
  const targetMs = nowMs - 24 * 60 * 60 * 1000;
  const fromUnixSeconds = Math.floor((targetMs - 2 * 60 * 60 * 1000) / 1000);
  const toUnixSeconds = Math.floor(nowMs / 1000);

  const chart = await fetchJson<CoinGeckoMarketChartRange>(
    getCoinGeckoMarketChartRangeUrl(coinId, fromUnixSeconds, toUnixSeconds),
    "CoinGecko",
  );

  const price24hAgo = pickNearestChartPrice(chart.prices ?? [], targetMs);
  if (price24hAgo === null) {
    throw new Error(`No CoinGecko chart data found for ${coinId} near the 24-hour target`);
  }

  return price24hAgo;
}

/**
 * The prices DefiLlama answers `url` with, keyed by the lower-cased coin key.
 * Empty, never thrown, when the request fails: the caller has nothing better to
 * do with the failure than price what it can.
 */
async function fetchDefiLlamaUsdPrices(url: string): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const payload = await fetchJson<DefiLlamaPricesResponse>(url, "DefiLlama");
    for (const [coinKey, coin] of Object.entries(payload.coins ?? {})) {
      const price = coin?.price;
      if (typeof price !== "number" || !Number.isFinite(price)) continue;
      prices.set(coinKey.toLowerCase(), price);
    }
  } catch (error) {
    debugWarn("[fluent-connect] DefiLlama price request failed", error);
  }
  return prices;
}

/**
 * The tokens worth asking a price API about. Restricted to tokens Fluent
 * ships: the price feeds are keyed by ticker or by an address Fluent vouches
 * for, and a ticker on a hand-added token is not proof of anything.
 */
export function getFluentPriceableTokens<T extends FluentPriceableToken>(
  tokens: readonly T[],
): T[] {
  return tokens.filter((token) => isFluentDefaultToken(token));
}

/**
 * USD prices for the Default tokens among `tokens`, keyed by
 * `fluentTokenIdentity`. A token absent from the result could not be priced.
 *
 * A stablecoin is priced at its fixed value without a request. For the rest,
 * Coinbase's spot price and CoinGecko's chart are asked first, one request to
 * each per token; whatever they leave unanswered goes to DefiLlama in one
 * request per kind of price, keyed as {@link resolveDefiLlamaCoinKey} describes. A token
 * whose current price no provider returned is left out; one whose price 24
 * hours ago no provider returned reports its current price there, so that the
 * portfolio total still counts it and its change reads as zero.
 *
 * Never throws: each provider's failure is logged through `debugWarn` and the
 * next one is tried.
 */
export async function fetchFluentTokenUsdPricePoints(
  tokens: readonly FluentPriceableToken[],
): Promise<Record<string, FluentTokenUsdPricePoint>> {
  const subjects = new Map<string, FluentPriceableToken>();
  for (const token of getFluentPriceableTokens(tokens)) {
    subjects.set(fluentTokenIdentity(token), token);
  }

  const current = new Map<string, number>();
  const price24hAgo = new Map<string, number>();
  const fetched: [identity: string, token: FluentPriceableToken][] = [];
  for (const [identity, token] of subjects) {
    const fixed = getFixedUsdPrice(token.symbol);
    if (fixed !== null) {
      current.set(identity, fixed);
      price24hAgo.set(identity, fixed);
    } else {
      fetched.push([identity, token]);
    }
  }

  await Promise.all(
    fetched.map(async ([identity, token]) => {
      const coinbaseSymbol = resolveCoinbaseBaseSymbol(token.symbol);
      const coinGeckoCoinId = resolveCoinGeckoCoinId(token.symbol);
      const [spot, chart] = await Promise.all([
        coinbaseSymbol ? fetchCoinbaseSpotUsdPrice(coinbaseSymbol) : null,
        coinGeckoCoinId
          ? fetchCoinGeckoPrice24hAgo(coinGeckoCoinId).catch((error: unknown) => {
              debugWarn("[fluent-connect] CoinGecko chart request failed", coinGeckoCoinId, error);
              return null;
            })
          : null,
      ]);
      if (spot !== null) current.set(identity, spot);
      if (chart !== null) price24hAgo.set(identity, chart);
    }),
  );

  const missingCurrent = coinKeysOf(fetched.filter(([identity]) => !current.has(identity)));
  const missing24hAgo = coinKeysOf(fetched.filter(([identity]) => !price24hAgo.has(identity)));
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  const [llamaCurrent, llama24hAgo] = await Promise.all([
    missingCurrent.size > 0
      ? fetchDefiLlamaUsdPrices(getDefiLlamaCurrentPricesUrl(uniqueCoinKeys(missingCurrent)))
      : new Map<string, number>(),
    missing24hAgo.size > 0
      ? fetchDefiLlamaUsdPrices(
          getDefiLlamaHistoricalPricesUrl(
            uniqueCoinKeys(missing24hAgo),
            nowUnixSeconds - 24 * 60 * 60,
          ),
        )
      : new Map<string, number>(),
  ]);
  applyDefiLlamaPrices(missingCurrent, llamaCurrent, current);
  applyDefiLlamaPrices(missing24hAgo, llama24hAgo, price24hAgo);

  const points: Record<string, FluentTokenUsdPricePoint> = {};
  for (const identity of subjects.keys()) {
    const currentPrice = current.get(identity);
    if (currentPrice === undefined) continue;
    points[identity] = {
      current: currentPrice,
      price24hAgo: price24hAgo.get(identity) ?? currentPrice,
    };
  }
  return points;
}

/** Token identity → DefiLlama coin key, for the tokens DefiLlama has a key for. */
function coinKeysOf(
  entries: readonly [identity: string, token: FluentPriceableToken][],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [identity, token] of entries) {
    const coinKey = resolveDefiLlamaCoinKey(token);
    if (coinKey) keys.set(identity, coinKey);
  }
  return keys;
}

function uniqueCoinKeys(keysByIdentity: ReadonlyMap<string, string>): string[] {
  return [...new Set(keysByIdentity.values())];
}

function applyDefiLlamaPrices(
  keysByIdentity: ReadonlyMap<string, string>,
  pricesByCoinKey: ReadonlyMap<string, number>,
  target: Map<string, number>,
) {
  for (const [identity, coinKey] of keysByIdentity) {
    const price = pricesByCoinKey.get(coinKey.toLowerCase());
    if (price !== undefined) target.set(identity, price);
  }
}

/** Split price points into current / 24h-ago maps for portfolio math. */
export function splitFluentTokenUsdPricePoints(
  points: Readonly<Record<string, FluentTokenUsdPricePoint>>,
) {
  const prices: Record<string, number> = {};
  const prices24hAgo: Record<string, number> = {};

  for (const [identity, point] of Object.entries(points)) {
    prices[identity] = point.current;
    prices24hAgo[identity] = point.price24hAgo;
  }

  return { prices, prices24hAgo };
}
