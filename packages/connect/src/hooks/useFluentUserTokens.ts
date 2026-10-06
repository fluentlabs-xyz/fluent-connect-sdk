import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createUserTokenListLoader } from "../core/userTokensLoader";
import {
  createFluentUserTokenStore,
  type FluentUserTokenAddResult,
  type UserTokenStore,
} from "../core/userTokens";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";

/**
 * The tokens this person added by hand, on the current chain, plus the two
 * writes. Every call is asynchronous now: the store may be the service's
 * (`createFluentBackendUserTokenStore`) rather than this browser's.
 *
 * A failed load is not an empty list — the last one settled stays on screen and
 * the failure goes to `debugWarn`. A failed `add` comes back as a result the
 * form can show; nothing rejects out of here.
 */
export function useFluentUserTokens(options?: { store?: UserTokenStore }) {
  const { chain } = useFluentWidgetNetwork();
  const injectedStore = options?.store;
  const store = useMemo(
    () => injectedStore ?? createFluentUserTokenStore(),
    [injectedStore],
  );

  const [tokens, setTokens] = useState<FluentTokenDefinition[]>([]);

  const loader = useMemo(
    () =>
      createUserTokenListLoader({
        store,
        chainId: chain.id,
        onTokens: setTokens,
      }),
    [chain.id, store],
  );

  // `resume` before every load, because the loader outlives one effect run: in
  // StrictMode React replays setup, cleanup, setup on the same memoized value,
  // and a loader left disposed would never publish a list or accept a write
  // again for a hook that is still mounted.
  useEffect(() => {
    loader.resume();
    void loader.load();
    return () => loader.dispose();
  }, [loader]);

  const add = useCallback(
    (token: FluentTokenDefinition): Promise<FluentUserTokenAddResult> => loader.add(token),
    [loader],
  );

  const remove = useCallback(
    (token: Pick<FluentTokenDefinition, "chainId" | "address">): Promise<void> =>
      loader.remove(token),
    [loader],
  );

  return { tokens, add, remove };
}
