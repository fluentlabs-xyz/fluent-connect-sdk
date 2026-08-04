const COINBASE_EXCHANGE_API = "https://api.exchange.coinbase.com";

/** Stablecoins — always $1, never fetched from Coinbase. */
const FIXED_USD_PRICES: Record<string, number> = {
  USDnr: 1,
  USDC: 1,
  USDT: 1,
};

/** Fluent token symbol → Coinbase product base. */
const COINBASE_BASE_BY_SYMBOL: Record<string, string> = {
  ETH: "ETH",
  BLEND: "BLEND",
};

type CoinbaseSpotPriceResponse = {
  data?: {
    amount?: string;
    base?: string;
    currency?: string;
  };
};

type CoinbaseCandle = [
  time: number,
  low: number,
  high: number,
  open: number,
  close: number,
  volume: number,
];

export type FluentTokenUsdPricePoint = {
  current: number;
  price24hAgo: number;
};

export function getCoinbaseSpotPriceUrl(symbol: string): string {
  return `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
}

export function getCoinbaseProductId(symbol: string): string {
  return `${symbol}-USD`;
}

export function resolveCoinbaseBaseSymbol(symbol: string): string | null {
  return COINBASE_BASE_BY_SYMBOL[symbol] ?? null;
}

export function getFixedUsdPrice(symbol: string): number | null {
  return FIXED_USD_PRICES[symbol] ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Coinbase request failed: ${response.status} ${body}`);
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

/**
 * Price ~24h ago from nearest 5m candle close
 * (30-minute window around the target for thin markets).
 */
export async function fetchCoinbasePrice24hAgo(productId: string): Promise<number> {
  const intervalSeconds = 300;
  const intervalMs = intervalSeconds * 1000;

  const now = Date.now();
  const targetTime = now - 24 * 60 * 60 * 1000;
  const bucketStartMs = Math.floor(targetTime / intervalMs) * intervalMs;
  const candlesStartMs = bucketStartMs - 15 * 60 * 1000;
  const candlesEndMs = bucketStartMs + 15 * 60 * 1000;

  const candlesUrl = new URL(
    `${COINBASE_EXCHANGE_API}/products/${encodeURIComponent(productId)}/candles`,
  );
  candlesUrl.searchParams.set("start", new Date(candlesStartMs).toISOString());
  candlesUrl.searchParams.set("end", new Date(candlesEndMs).toISOString());
  candlesUrl.searchParams.set("granularity", String(intervalSeconds));

  const candles = await fetchJson<CoinbaseCandle[]>(candlesUrl.toString());
  if (candles.length === 0) {
    throw new Error(`No candle data found for ${productId} near the 24-hour target`);
  }

  const targetSeconds = Math.floor(targetTime / 1000);
  const nearestCandle = candles.reduce((nearest, candle) => {
    const nearestDistance = Math.abs(nearest[0] - targetSeconds);
    const candleDistance = Math.abs(candle[0] - targetSeconds);
    return candleDistance < nearestDistance ? candle : nearest;
  });

  const price24hAgo = Number(nearestCandle[4]);
  if (!Number.isFinite(price24hAgo)) {
    throw new Error("Coinbase returned an invalid 24h candle price");
  }

  return price24hAgo;
}

export async function fetchFluentTokenUsdPricePoints(
  symbols: readonly string[],
): Promise<Record<string, FluentTokenUsdPricePoint>> {
  const unique = [...new Set(symbols)];
  const entries = await Promise.all(
    unique.map(async (symbol) => {
      const fixed = getFixedUsdPrice(symbol);
      if (fixed !== null) {
        return [symbol, { current: fixed, price24hAgo: fixed }] as const;
      }

      const coinbaseSymbol = resolveCoinbaseBaseSymbol(symbol);
      if (!coinbaseSymbol) return null;

      try {
        const [current, price24hAgo] = await Promise.all([
          fetchCoinbaseSpotUsdPrice(coinbaseSymbol),
          fetchCoinbasePrice24hAgo(getCoinbaseProductId(coinbaseSymbol)),
        ]);
        if (current === null) return null;

        return [symbol, { current, price24hAgo }] as const;
      } catch (e) {
        return null;
      }
    }),
  );

  const prices: Record<string, FluentTokenUsdPricePoint> = {};
  for (const entry of entries) {
    if (!entry) continue;
    prices[entry[0]] = entry[1];
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
