import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useEffect, useMemo, useState } from "react";

import {
  getFluentPriceableSymbols,
  getFluentTokenUsdPriceExpiry,
  mapFluentPricesToTokenIdentities,
  peekFluentTokenUsdPricePoints,
  readFluentTokenUsdPricePoints,
  splitFluentTokenUsdPricePoints,
} from "../core/tokenPrices";

/**
 * USD prices for `tokens`, keyed by `fluentTokenIdentity`.
 *
 * The price feeds are addressed by ticker, so fetching happens by symbol — but
 * only for tokens Fluent ships, and the results are re-keyed onto token
 * identities before leaving this hook. Callers never see the symbol-keyed form,
 * which is what stops a hand-added token that calls itself USDnr from
 * inheriting the real one's price.
 *
 * The feeds are read through the cache in `core/tokenPrices`, so mounting this
 * again within its TTL asks them nothing, and a mounted hook reads again only
 * when the TTL runs out.
 */
export function useFluentTokenUsdPrices(tokens: readonly FluentTokenDefinition[]) {
  const symbolKey = useMemo(
    () => getFluentPriceableSymbols(tokens).sort().join(","),
    [tokens],
  );
  const [pricesBySymbol, setPricesBySymbol] = useState<Record<string, number>>({});
  const [pricesBySymbolYesterday, setPricesBySymbolYesterday] = useState<
    Record<string, number>
  >({});
  const [busy, setBusy] = useState(() => Boolean(symbolKey));

  useEffect(() => {
    if (!symbolKey) {
      setPricesBySymbol({});
      setPricesBySymbolYesterday({});
      setBusy(false);
      return;
    }

    const symbols = symbolKey.split(",");
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (points: ReturnType<typeof peekFluentTokenUsdPricePoints>) => {
      const next = splitFluentTokenUsdPricePoints(points);
      setPricesBySymbol(next.prices);
      setPricesBySymbolYesterday(next.prices24hAgo);
      setBusy(false);
    };

    const load = async () => {
      const points = await readFluentTokenUsdPricePoints(symbols);
      if (!active) return;
      apply(points);
      // Read again as the oldest answer ages out, and not before: the feeds are
      // asked once per TTL whatever this hook does. No expiry means no symbol
      // here ever needs a feed (fixed prices only), so there is nothing to renew.
      const expiry = getFluentTokenUsdPriceExpiry(symbols);
      if (expiry !== null) timer = setTimeout(load, Math.max(0, expiry - Date.now()));
    };

    // What the cache still answers for is shown at once; a loading state is
    // for symbols that have to be asked of a feed.
    const cached = peekFluentTokenUsdPricePoints(symbols);
    const everyCached = symbols.every((symbol) => symbol in cached);
    if (everyCached) apply(cached);
    else setBusy(true);
    void load();

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [symbolKey]);

  const prices = useMemo(
    () => mapFluentPricesToTokenIdentities(tokens, pricesBySymbol),
    [tokens, pricesBySymbol],
  );
  const pricesYesterday = useMemo(
    () => mapFluentPricesToTokenIdentities(tokens, pricesBySymbolYesterday),
    [tokens, pricesBySymbolYesterday],
  );

  return { prices, pricesYesterday, busy };
}
