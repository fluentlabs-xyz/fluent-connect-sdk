import { useEffect, useMemo, useState } from "react";
import {
  fetchFluentTokenUsdPricePoints,
  splitFluentTokenUsdPricePoints,
} from "../core/tokenPrices";

export function useFluentTokenUsdPrices(symbols: readonly string[]) {
  const symbolKey = useMemo(() => [...new Set(symbols)].sort().join(","), [symbols]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesYesterday, setPricesYesterday] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(() => Boolean(symbolKey));

  useEffect(() => {
    if (!symbolKey) {
      setPrices({});
      setPricesYesterday({});
      setBusy(false);
      return;
    }

    let active = true;
    setBusy(true);

    fetchFluentTokenUsdPricePoints(symbolKey.split(",")).then((points) => {
      if (!active) return;
      const next = splitFluentTokenUsdPricePoints(points);
      setPrices(next.prices);
      setPricesYesterday(next.prices24hAgo);
      setBusy(false);
    });

    return () => {
      active = false;
    };
  }, [symbolKey]);

  return { prices, pricesYesterday, busy };
}
