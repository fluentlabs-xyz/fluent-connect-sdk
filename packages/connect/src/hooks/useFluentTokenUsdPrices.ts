import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useEffect, useMemo, useState } from "react";

import {
  fetchFluentTokenUsdPricePoints,
  getFluentPriceableTokens,
  splitFluentTokenUsdPricePoints,
  type FluentTokenUsdPricePoint,
} from "../core/tokenPrices";

/**
 * USD prices for `tokens`, keyed by `fluentTokenIdentity`.
 *
 * Only the Default tokens among `tokens` are priced, and the result is keyed by
 * token identity from the fetch onward, which is what stops a hand-added token
 * that calls itself USDnr from inheriting the real one's price.
 */
export function useFluentTokenUsdPrices(tokens: readonly FluentTokenDefinition[]) {
  const subjectKey = useMemo(
    () => getFluentPriceableTokens(tokens).map(fluentTokenIdentity).sort().join(","),
    [tokens],
  );
  const [points, setPoints] = useState<Record<string, FluentTokenUsdPricePoint>>({});
  const [busy, setBusy] = useState(() => Boolean(subjectKey));

  // The effect keys on the identities, not on `tokens`: callers build the array
  // per render, and a new array naming the same Default tokens is not a reason
  // to ask the price feeds again. `tokens` is read from the render that produced
  // the key, and any later array with the same key names the same subjects.
  useEffect(() => {
    if (!subjectKey) {
      setPoints({});
      setBusy(false);
      return;
    }

    let active = true;
    setBusy(true);

    fetchFluentTokenUsdPricePoints(tokens).then((next) => {
      if (!active) return;
      setPoints(next);
      setBusy(false);
    });

    return () => {
      active = false;
    };
  }, [subjectKey]);

  const { prices, prices24hAgo: pricesYesterday } = useMemo(
    () => splitFluentTokenUsdPricePoints(points),
    [points],
  );

  return { prices, pricesYesterday, busy };
}
