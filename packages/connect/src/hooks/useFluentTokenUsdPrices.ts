import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useEffect, useMemo, useState } from "react";

import {
  fetchFluentTokenUsdPricePoints,
  getFluentPriceableSymbols,
  mapFluentPricesToTokenIdentities,
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

    let active = true;
    setBusy(true);

    fetchFluentTokenUsdPricePoints(symbolKey.split(",")).then((points) => {
      if (!active) return;
      const next = splitFluentTokenUsdPricePoints(points);
      setPricesBySymbol(next.prices);
      setPricesBySymbolYesterday(next.prices24hAgo);
      setBusy(false);
    });

    return () => {
      active = false;
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
