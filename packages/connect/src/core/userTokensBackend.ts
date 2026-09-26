import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { debugWarn } from "./debugLogger";
import { FluentSettingsError, type FluentSettingsClient } from "./settingsClient";
import {
  FLUENT_USER_TOKEN_LIMIT,
  validateUserToken,
  type FluentUserTokenAddResult,
  type UserTokenStore,
} from "./userTokens";

export type BackendUserTokenStore = UserTokenStore & {
  /**
   * Adopt the list from a `GET /me/settings` the caller already made, so the
   * settings read and the token list share one round trip at sign-in.
   */
  prime(tokens: readonly FluentTokenDefinition[]): void;
  /** Forget the list; the next `list()` loads again. */
  reset(): void;
};

function messageOf(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach Fluent Connect.";
}

/**
 * `UserTokenStore` over the service's `/me/tokens` routes, used wherever
 * `getAuthToken()` can resolve. The list is cached in memory and kept in step
 * with every write, so browsing the token list costs no request after sign-in.
 *
 * `add` and `remove` never throw: the token list is a corner of a wallet menu,
 * and a failed write there must not reach the host App as a rejection. `list`
 * may reject — its caller (`createUserTokenListLoader`) keeps the last settled
 * list on screen instead.
 */
export function createFluentBackendUserTokenStore(params: {
  client: FluentSettingsClient;
  /**
   * The shared settings read. Called only when the store has no list yet, so a
   * controller that primes it after its own `GET` causes no second request.
   */
  load: () => Promise<readonly FluentTokenDefinition[]>;
  /** Shown next to the token list when a `DELETE` fails. */
  onRemoveError?: (message: string) => void;
}): BackendUserTokenStore {
  let cached: FluentTokenDefinition[] | null = null;
  let loading: Promise<FluentTokenDefinition[]> | null = null;

  const ensure = async (): Promise<FluentTokenDefinition[]> => {
    if (cached) return cached;
    if (!loading) {
      loading = (async () => {
        try {
          const tokens = [...(await params.load())];
          cached = tokens;
          return tokens;
        } finally {
          loading = null;
        }
      })();
    }
    return loading;
  };

  return {
    prime(tokens) {
      cached = [...tokens];
    },

    reset() {
      cached = null;
      loading = null;
    },

    async list(chainId) {
      const all = await ensure();
      return all.filter((token) => token.chainId === chainId);
    },

    async add(token): Promise<FluentUserTokenAddResult> {
      const valid = validateUserToken(token);
      if (!valid) return { status: "invalid" };

      let all: FluentTokenDefinition[];
      try {
        all = await ensure();
      } catch (err) {
        return { status: "failed", message: messageOf(err) };
      }

      const identity = fluentTokenIdentity(valid);
      if (all.some((existing) => fluentTokenIdentity(existing) === identity)) {
        return { status: "already-present" };
      }

      try {
        await params.client.putToken(valid);
      } catch (err) {
        if (err instanceof FluentSettingsError) {
          // The service owns the per-chain ceiling; the constant is what the
          // widget tells the user, and the two agree by construction.
          if (err.code === "at_capacity") {
            return { status: "at-capacity", limit: FLUENT_USER_TOKEN_LIMIT };
          }
          if (err.code === "invalid_request") return { status: "invalid" };
        }
        return { status: "failed", message: messageOf(err) };
      }

      cached = [...all, valid];
      return { status: "added" };
    },

    async remove(token) {
      const identity = fluentTokenIdentity(token);
      // Optimistic, and it stays that way on failure: there is no retry queue,
      // and the next sign-in re-reads the service's own answer.
      if (cached) cached = cached.filter((existing) => fluentTokenIdentity(existing) !== identity);
      try {
        await params.client.deleteToken(token);
      } catch (err) {
        debugWarn("[fluent widget] could not remove the token on the service", err);
        params.onRemoveError?.(messageOf(err));
      }
    },
  };
}
