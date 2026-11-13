import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useEffect, useMemo, useState } from "react";

import {
  getFluentPriceableTokens,
  getFluentTokenUsdPriceExpiry,
  peekFluentTokenUsdPricePoints,
  readFluentTokenUsdPricePoints,
  splitFluentTokenUsdPricePoints,
  type FluentTokenUsdPricePoint,
} from "../core/tokenPrices";

/**
 * Returns USD prices for `tokens`, keyed by `fluentTokenIdentity`.
 *
 * Only the Default tokens among `tokens` are priced, and the result is keyed by Token identity
 * from the fetch onward, which is what stops a User token that calls itself USDnr from
 * inheriting the real one's price.
 *
 * The feeds are read through the cache in `core/tokenPrices`, so mounting this again within its
 * TTL asks them nothing, and a mounted hook reads again only when the TTL runs out.
 */
export function useFluentTokenUsdPrices(tokens: readonly FluentTokenDefinition[]) {
  const subjectKey = useMemo(
    () => getFluentPriceableTokens(tokens).map(fluentTokenIdentity).sort().join(","),
    [tokens],
  );
  const [points, setPoints] = useState<Record<string, FluentTokenUsdPricePoint>>({});
  const [busy, setBusy] = useState(() => Boolean(subjectKey));

  // Keyed on the identities, not on `tokens`: callers build the array per render, and a new
  // array naming the same Default tokens is no reason to ask the feeds again. Any later array
  // with the same key names the same subjects as the `tokens` read here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subjectKey stands for tokens, whose new arrays with the same subjects must not ask the feeds again
  useEffect(() => {
    if (!subjectKey) {
      setPoints({});
      setBusy(false);
      return;
    }

    const subjects = getFluentPriceableTokens(tokens);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (next: Record<string, FluentTokenUsdPricePoint>) => {
      setPoints(next);
      setBusy(false);
    };

    const load = async () => {
      const next = await readFluentTokenUsdPricePoints(subjects);
      if (!active) return;
      apply(next);
      // Read again as the oldest answer ages out, and not before: the feeds are
      // asked once per TTL whatever this hook does. No expiry means no token
      // here ever needs a feed (fixed prices only), so there is nothing to renew.
      const expiry = getFluentTokenUsdPriceExpiry(subjects);
      if (expiry !== null) timer = setTimeout(load, Math.max(0, expiry - Date.now()));
    };

    // What the cache still answers for is shown at once; a loading state is
    // for tokens that have to be asked of a feed.
    const cached = peekFluentTokenUsdPricePoints(subjects);
    const everyCached = subjects.every((token) => fluentTokenIdentity(token) in cached);
    if (everyCached) apply(cached);
    else setBusy(true);
    void load();

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [subjectKey]);

  const { prices, prices24hAgo: pricesYesterday } = useMemo(
    () => splitFluentTokenUsdPricePoints(points),
    [points],
  );

  return { prices, pricesYesterday, busy };
}
