const COINGECKO_API = "https://api.coingecko.com/api/v3";

/** Stablecoins — always $1, never fetched from price APIs. */
const FIXED_USD_PRICES: Record<string, number> = {
  USDnr: 1,
  USDC: 1,
  USDT: 1,
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

        return [symbol, { current, price24hAgo }] as const;
      } catch {
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
