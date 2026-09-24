import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { debugWarn } from "./debugLogger";
import type { FluentUserTokenAddResult, UserTokenStore } from "./userTokens";

export type UserTokenListLoader = {
  /** Re-read the list for this chain. Never rejects. */
  load(): Promise<void>;
  add(token: FluentTokenDefinition): Promise<FluentUserTokenAddResult>;
  remove(token: Pick<FluentTokenDefinition, "chainId" | "address">): Promise<void>;
  /** Ignore everything still in flight; the caller is gone. */
  dispose(): void;
  /**
   * Take the loader back into service, dropping whatever `dispose` left in
   * flight. React's StrictMode runs an effect as setup, cleanup, setup on the
   * same memoized loader, and a development-only replay must not leave the
   * mounted hook with a list it can never refresh.
   */
  resume(): void;
};

/**
 * The asynchronous half of `useFluentUserTokens`, with no React in it.
 *
 * A store's `list()` may reject — the backend one reaches the network. When it
 * does, the last settled list stays on screen: a wallet menu that empties
 * itself because a request failed reads as "your tokens are gone". Stale
 * answers are dropped the way `useFluentTokenBalances` drops them, by
 * generation, so a slow read for the previous store or chain cannot overwrite
 * the current one.
 */
export function createUserTokenListLoader(params: {
  store: UserTokenStore;
  chainId: number;
  onTokens: (tokens: FluentTokenDefinition[]) => void;
  /** Optional: a caller with nothing to render while a call is in flight may omit it. */
  onBusy?: (busy: boolean) => void;
}): UserTokenListLoader {
  const { store, chainId, onTokens } = params;
  const onBusy = params.onBusy ?? (() => {});
  let generation = 0;
  let disposed = false;

  const load = async () => {
    if (disposed) return;
    generation += 1;
    const mine = generation;
    onBusy(true);
    try {
      const tokens = await store.list(chainId);
      if (disposed || mine !== generation) return;
      onTokens(tokens);
    } catch (err) {
      // Keep the last settled list: an empty menu would misreport the failure.
      debugWarn("[fluent widget] could not load the user's token list", err);
    } finally {
      if (!disposed && mine === generation) onBusy(false);
    }
  };

  return {
    load,

    async add(token) {
      if (disposed) return { status: "failed", message: "The widget is no longer mounted." };
      onBusy(true);
      let result: FluentUserTokenAddResult;
      try {
        result = await store.add(token);
      } catch (err) {
        // A store is not supposed to throw out of `add`; an injected one might.
        result = {
          status: "failed",
          message: err instanceof Error ? err.message : "Could not add the token.",
        };
      } finally {
        if (!disposed) onBusy(false);
      }
      // Every resolved call refreshes: `already-present` can mean the store's
      // list holds a token this loader has never seen, and an `invalid` or
      // `failed` answer from a backend store is a good moment to find out what
      // the service really has.
      await load();
      return result;
    },

    async remove(token) {
      if (disposed) return;
      try {
        await store.remove(token);
      } catch (err) {
        debugWarn("[fluent widget] could not remove the token", err);
      }
      await load();
    },

    dispose() {
      disposed = true;
      generation += 1;
    },

    resume() {
      disposed = false;
      generation += 1;
    },
  };
}
