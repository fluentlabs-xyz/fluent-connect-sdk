import {
  fluentTokenIdentity,
  isFluentDefaultToken,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";

const COINGECKO_API = "https://api.coingecko.com/api/v3";

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

export function resolveCoinbaseBaseSymbol(symbol: string): string | null {
  return COINBASE_BASE_BY_SYMBOL[symbol] ?? null;
}

export function resolveCoinGeckoCoinId(symbol: string): string | null {
  return COINGECKO_COIN_ID_BY_SYMBOL[symbol] ?? null;
}

export function getFixedUsdPrice(symbol: string): number | null {
  return FIXED_USD_PRICES[symbol] ?? null;
}

async function fetchJson<T>(url: string, provider: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} request failed: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchCoinbaseSpotUsdPrice(coinbaseSymbol: string): Promise<number | null> {
  try {
    const response = await fetch(getCoinbaseSpotPriceUrl(coinbaseSymbol));
    if (!response.ok) return null;
    const payload = (await response.json()) as CoinbaseSpotPriceResponse;
    const amount = Number(payload.data?.amount);
    return Number.isFinite(amount) ? amount : null;
  } catch {
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

/** One symbol's price pair from the feeds, or null where they had no answer. */
async function fetchFluentTokenUsdPricePoint(
  symbol: string,
): Promise<FluentTokenUsdPricePoint | null> {
  const coinbaseSymbol = resolveCoinbaseBaseSymbol(symbol);
  const coinGeckoCoinId = resolveCoinGeckoCoinId(symbol);
  if (!coinbaseSymbol || !coinGeckoCoinId) return null;

  try {
    const current = await fetchCoinbaseSpotUsdPrice(coinbaseSymbol);
    if (current === null) return null;

    let price24hAgo = current;
    try {
      price24hAgo = await fetchCoinGeckoPrice24hAgo(coinGeckoCoinId);
    } catch {
      // Keep spot as fallback so portfolio math still works when chart data is missing.
    }

    return { current, price24hAgo };
  } catch {
    return null;
  }
}

/**
 * How long a price answer serves before the feeds are asked again. Coinbase and
 * CoinGecko are other people's public APIs, so a price is read at most this
 * often per symbol, however many times the wallet menu or the Bridge page mounts
 * in between. A feed that had no answer is asked again after the same wait.
 */
export const FLUENT_TOKEN_PRICE_TTL_MS = 5 * 60_000;

type FluentTokenUsdPriceCacheEntry = {
  point: FluentTokenUsdPricePoint | null;
  /** When the answer arrived, by `Date.now()`. */
  readAt: number;
};

const priceCache = new Map<string, FluentTokenUsdPriceCacheEntry>();
// One request per symbol at a time: two pages mounting together share it.
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
 * The prices `readFluentTokenUsdPricePoints` would answer without asking a feed:
 * the symbols whose answer is younger than the TTL, and the fixed ones. Lets a
 * page start from them rather than from a loading state.
 */
export function peekFluentTokenUsdPricePoints(
  symbols: readonly string[],
  now = Date.now(),
): Record<string, FluentTokenUsdPricePoint> {
  const prices: Record<string, FluentTokenUsdPricePoint> = {};
  for (const symbol of new Set(symbols)) {
    const fixed = getFixedUsdPrice(symbol);
    if (fixed !== null) {
      prices[symbol] = { current: fixed, price24hAgo: fixed };
      continue;
    }
    const entry = priceCache.get(symbol);
    if (isFreshPriceEntry(entry, now) && entry?.point) prices[symbol] = entry.point;
  }
  return prices;
}

/**
 * When the oldest answer among `symbols` reaches the TTL, by `Date.now()`, or
 * null when none of them was ever asked of a feed. The moment to read again.
 */
export function getFluentTokenUsdPriceExpiry(
  symbols: readonly string[],
): number | null {
  let expiry: number | null = null;
  for (const symbol of new Set(symbols)) {
    const entry = priceCache.get(symbol);
    if (!entry) continue;
    const at = entry.readAt + FLUENT_TOKEN_PRICE_TTL_MS;
    if (expiry === null || at < expiry) expiry = at;
  }
  return expiry;
}

/**
 * The price pairs for `symbols`, keyed by symbol, from the cache where it is
 * fresh and from the feeds where it is not. A symbol the feeds have no answer
 * for is left out, and not asked again before the TTL.
 */
export async function readFluentTokenUsdPricePoints(
  symbols: readonly string[],
  now = Date.now(),
): Promise<Record<string, FluentTokenUsdPricePoint>> {
  const unique = [...new Set(symbols)];
  const entries = await Promise.all(
    unique.map(async (symbol) => {
      const fixed = getFixedUsdPrice(symbol);
      if (fixed !== null) {
        return [symbol, { current: fixed, price24hAgo: fixed }] as const;
      }

      const cached = priceCache.get(symbol);
      if (isFreshPriceEntry(cached, now)) return [symbol, cached!.point] as const;

      let pending = priceInFlight.get(symbol);
      if (!pending) {
        pending = fetchFluentTokenUsdPricePoint(symbol).then((point) => {
          priceCache.set(symbol, { point, readAt: Date.now() });
          return point;
        });
        priceInFlight.set(symbol, pending);
        void pending.finally(() => {
          if (priceInFlight.get(symbol) === pending) priceInFlight.delete(symbol);
        });
      }
      return [symbol, await pending] as const;
    }),
  );

  const prices: Record<string, FluentTokenUsdPricePoint> = {};
  for (const [symbol, point] of entries) {
    if (point) prices[symbol] = point;
  }
  return prices;
}

/** Split price points into current / 24h-ago maps for portfolio math. */
export function splitFluentTokenUsdPricePoints(
  points: Readonly<Record<string, FluentTokenUsdPricePoint>>,
) {
  const prices: Record<string, number> = {};
  const prices24hAgo: Record<string, number> = {};

  for (const [symbol, point] of Object.entries(points)) {
    prices[symbol] = point.current;
    prices24hAgo[symbol] = point.price24hAgo;
  }

  return { prices, prices24hAgo };
}

/**
 * The symbols worth asking a price API about. Restricted to tokens Fluent
 * ships: the price feeds are keyed by ticker, and a ticker is not proof of
 * anything.
 */
export function getFluentPriceableSymbols(tokens: readonly FluentTokenDefinition[]) {
  return tokens.filter(isFluentDefaultToken).map((token) => token.symbol);
}

export function mapFluentPricesToTokenIdentities(
  tokens: readonly FluentTokenDefinition[],
  pricesBySymbol: Readonly<Record<string, number>>,
): Record<string, number> {
  const byIdentity: Record<string, number> = {};
  for (const token of tokens) {
    if (!isFluentDefaultToken(token)) continue;
    const price = pricesBySymbol[token.symbol];
    if (price === undefined) continue;
    byIdentity[fluentTokenIdentity(token)] = price;
  }
  return byIdentity;
}
