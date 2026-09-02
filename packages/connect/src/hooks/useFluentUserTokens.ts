import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useCallback, useMemo, useState } from "react";

import {
  createFluentUserTokenStore,
  type FluentUserTokenAddResult,
  type UserTokenStore,
} from "../core/userTokens";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";

export function useFluentUserTokens(options?: { store?: UserTokenStore }) {
  const { chain } = useFluentWidgetNetwork();
  const injectedStore = options?.store;
  const store = useMemo(
    () => injectedStore ?? createFluentUserTokenStore(),
    [injectedStore],
  );

  const [revision, setRevision] = useState(0);
  const tokens = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` is the invalidation signal
    () => store.list(chain.id),
    [store, chain.id, revision],
  );

  const add = useCallback(
    (token: FluentTokenDefinition): FluentUserTokenAddResult => {
      const result = store.add(token);
      if (result.status === "added") setRevision((value) => value + 1);
      return result;
    },
    [store],
  );

  const remove = useCallback(
    (token: Pick<FluentTokenDefinition, "chainId" | "address">) => {
      store.remove(token);
      setRevision((value) => value + 1);
    },
    [store],
  );

  return { tokens, add, remove };
}
