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

/** Stablecoins, priced at a fixed USD value and never asked of a price feed. */
const FIXED_USD_PRICES: Record<string, number> = {
  USDnr: 1,
};

/** Default token symbol → Coinbase spot base asset. */
const COINBASE_BASE_BY_SYMBOL: Record<string, string> = {
  ETH: "ETH",
  BLEND: "BLEND",
};

/**
 * Default token symbol → CoinGecko coin id, for CoinGecko's chart and for DefiLlama's
 * `coingecko:<id>` key.
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
 * Returns the URL of DefiLlama's current prices for `coinKeys`, which are `<chain>:<address>` or
 * `coingecko:<id>` as {@link resolveDefiLlamaCoinKey} builds them. The keys hold no character
 * the path would need escaped.
 */
export function getDefiLlamaCurrentPricesUrl(coinKeys: readonly string[]): string {
  return `${DEFILLAMA_COINS_API}/prices/current/${coinKeys.join(",")}`;
}

/** Returns the URL of DefiLlama's prices for `coinKeys` nearest to `unixSeconds`. */
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
 * Returns the key DefiLlama's coins API knows a Default token by, or `null` for a token it has
 * no name for.
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

/**
 * Reads the USD price of `coinId` about 24 hours ago: the CoinGecko market chart sample nearest
 * to that moment. Throws an `Error` when the request fails or the chart has no usable sample.
 */
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
 * Reads the prices DefiLlama answers `url` with, keyed by the lower-cased coin key. Empty, never
 * thrown, when the request fails: the caller has nothing better to do with the failure than
 * price what it can.
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
 * Returns the tokens worth asking a price feed about: the Default tokens. The feeds are keyed by
 * ticker or by an address Fluent vouches for, and a ticker on an Integrator or User token is not
 * proof of anything.
 */
export function getFluentPriceableTokens<T extends FluentPriceableToken>(
  tokens: readonly T[],
): T[] {
  return tokens.filter((token) => isFluentDefaultToken(token));
}

/**
 * Reads USD prices for the Default tokens among `tokens`, keyed by `fluentTokenIdentity`, from
 * the feeds every time it is called. A token absent from the result could not be priced.
 * `readFluentTokenUsdPricePoints` is the cached read the widget uses.
 *
 * A stablecoin is priced at its fixed value without a request. For the rest, Coinbase's spot
 * price and CoinGecko's chart are asked first, one request to each that knows the token;
 * whatever they leave unanswered goes to DefiLlama in one request per kind of price, keyed as
 * {@link resolveDefiLlamaCoinKey} describes.
 * A token whose current price no provider returned is left out; one whose price
 * 24 hours ago no provider returned reports its current price there, so that the
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

/**
 * How long a price answer serves before the feeds are asked again. Coinbase,
 * CoinGecko and DefiLlama are other people's public APIs, so a price is read at
 * most this often per token, however many times the wallet menu or the Bridge
 * page mounts in between. A token no feed had an answer for is asked about
 * again after the same wait.
 */
export const FLUENT_TOKEN_PRICE_TTL_MS = 5 * 60_000;

type FluentTokenUsdPriceCacheEntry = {
  point: FluentTokenUsdPricePoint | null;
  /** When the answer arrived, by `Date.now()`. */
  readAt: number;
};

/** By Token identity. */
const priceCache = new Map<string, FluentTokenUsdPriceCacheEntry>();
// One read per token at a time: two pages mounting together share it.
const priceInFlight = new Map<string, Promise<FluentTokenUsdPricePoint | null>>();

function isFreshPriceEntry(entry: FluentTokenUsdPriceCacheEntry | undefined, now: number) {
  return entry !== undefined && now - entry.readAt < FLUENT_TOKEN_PRICE_TTL_MS;
}

/** Forgets every price read so far. For tests, which must not share a cache. */
export function clearFluentTokenUsdPriceCache() {
  priceCache.clear();
  priceInFlight.clear();
}

/**
 * Returns the prices `readFluentTokenUsdPricePoints` would answer without asking a feed,
 * keyed by `fluentTokenIdentity`: the Default tokens whose answer is younger than
 * the TTL, and the fixed ones. Lets a page start from them rather than from a
 * loading state.
 */
export function peekFluentTokenUsdPricePoints(
  tokens: readonly FluentPriceableToken[],
  now = Date.now(),
): Record<string, FluentTokenUsdPricePoint> {
  const prices: Record<string, FluentTokenUsdPricePoint> = {};
  for (const token of getFluentPriceableTokens(tokens)) {
    const identity = fluentTokenIdentity(token);
    const fixed = getFixedUsdPrice(token.symbol);
    if (fixed !== null) {
      prices[identity] = { current: fixed, price24hAgo: fixed };
      continue;
    }
    const entry = priceCache.get(identity);
    if (isFreshPriceEntry(entry, now) && entry?.point) prices[identity] = entry.point;
  }
  return prices;
}

/**
 * Returns when the oldest answer among `tokens` reaches the TTL, by `Date.now()`, or `null` when
 * none of them was ever asked of a feed: the moment to read again.
 */
export function getFluentTokenUsdPriceExpiry(
  tokens: readonly FluentPriceableToken[],
): number | null {
  let expiry: number | null = null;
  for (const token of getFluentPriceableTokens(tokens)) {
    const entry = priceCache.get(fluentTokenIdentity(token));
    if (!entry) continue;
    const at = entry.readAt + FLUENT_TOKEN_PRICE_TTL_MS;
    if (expiry === null || at < expiry) expiry = at;
  }
  return expiry;
}

/**
 * Reads the price pairs for the Default tokens among `tokens`, keyed by
 * `fluentTokenIdentity`, from the cache where it is fresh and from the feeds
 * where it is not. The tokens that have to be asked about go to the feeds in one
 * `fetchFluentTokenUsdPricePoints` call. A token the feeds have no answer for
 * is left out, and not asked about again before the TTL.
 */
export async function readFluentTokenUsdPricePoints(
  tokens: readonly FluentPriceableToken[],
  now = Date.now(),
): Promise<Record<string, FluentTokenUsdPricePoint>> {
  const points: Record<string, FluentTokenUsdPricePoint> = {};
  const awaited: [identity: string, pending: Promise<FluentTokenUsdPricePoint | null>][] = [];
  const toAsk = new Map<string, FluentPriceableToken>();

  for (const token of getFluentPriceableTokens(tokens)) {
    const identity = fluentTokenIdentity(token);
    const fixed = getFixedUsdPrice(token.symbol);
    if (fixed !== null) {
      points[identity] = { current: fixed, price24hAgo: fixed };
      continue;
    }

    const cached = priceCache.get(identity);
    if (isFreshPriceEntry(cached, now)) {
      if (cached?.point) points[identity] = cached.point;
      continue;
    }

    const inFlight = priceInFlight.get(identity);
    if (inFlight) {
      awaited.push([identity, inFlight]);
      continue;
    }
    toAsk.set(identity, token);
  }

  if (toAsk.size > 0) {
    const batch = fetchFluentTokenUsdPricePoints([...toAsk.values()]);
    for (const identity of toAsk.keys()) {
      const pending = batch.then((fetched) => {
        const point = fetched[identity] ?? null;
        priceCache.set(identity, { point, readAt: Date.now() });
        return point;
      });
      priceInFlight.set(identity, pending);
      void pending.finally(() => {
        if (priceInFlight.get(identity) === pending) priceInFlight.delete(identity);
      });
      awaited.push([identity, pending]);
    }
  }

  for (const [identity, pending] of awaited) {
    const point = await pending;
    if (point) points[identity] = point;
  }
  return points;
}

/** Splits price points into a map of current prices and one of prices 24 hours ago. */
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
