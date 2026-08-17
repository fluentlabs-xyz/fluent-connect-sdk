import { describe, expect, it } from "vitest";

import { getCoinGeckoMarketChartRangeUrl } from "./tokenPrices";

describe("getCoinGeckoMarketChartRangeUrl", () => {
  it("builds a CoinGecko market chart range URL", () => {
    expect(getCoinGeckoMarketChartRangeUrl("fluent-network", 1_700_000_000, 1_700_086_400)).toBe(
      "https://api.coingecko.com/api/v3/coins/fluent-network/market_chart/range?vs_currency=usd&from=1700000000&to=1700086400",
    );
  });
});
