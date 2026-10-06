import {
  fluentTokenIdentity,
  isFluentTokenDecimals,
  type FluentTokenDefinition,
  type StorageLike,
} from "@fluent.xyz/connect-sdk";
import { isAddress, getAddress, type Address } from "viem";

import { FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY } from "./storageKeys";

/** Per chain. A ceiling, not a product limit — it stops storage being abused. */
export const FLUENT_USER_TOKEN_LIMIT = 50;

export type FluentUserTokenAddResult =
  | { status: "added" }
  | { status: "already-present" }
  | { status: "at-capacity"; limit: number }
  | { status: "invalid" }
  /**
   * The store could not reach the truth: no network, no Fluent token, or the
   * service answered something other than a refusal it can name. Distinct from
   * `invalid`, which says the token itself is wrong and retrying cannot help.
   */
  | { status: "failed"; message: string };

/**
 * Persistence for tokens the end user added by hand.
 *
 * Asynchronous because the truth may live on the service: while the widget
 * holds a Fluent token the backing store is `createFluentBackendUserTokenStore`
 * and the list follows the person between Apps and browsers; where no Fluent
 * token can exist (hosted mode with a Fluent ID, and the not-connected state)
 * it is `createFluentUserTokenStore` over this browser's localStorage. See
 * `docs/adr/0004-user-settings-live-on-the-service.md`.
 */
export type UserTokenStore = {
  list(chainId: number): Promise<FluentTokenDefinition[]>;
  add(token: FluentTokenDefinition): Promise<FluentUserTokenAddResult>;
  remove(token: Pick<FluentTokenDefinition, "chainId" | "address">): Promise<void>;
};

type StoredPayload = {
  version: 1;
  tokens: FluentTokenDefinition[];
};

/**
 * Anything could be sitting under our key: another tab's newer schema, a
 * half-written value, or something a page script put there. Every entry is
 * re-validated on read and bad ones are dropped rather than trusted.
 */
export function parseStoredUserTokens(raw: string | null): FluentTokenDefinition[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const tokens = (parsed as Partial<StoredPayload>).tokens;
  if (!Array.isArray(tokens)) return [];

  const valid: FluentTokenDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of tokens) {
    const token = validateUserToken(entry);
    if (!token) continue;
    const key = fluentTokenIdentity(token);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(token);
  }
  return valid;
}

/**
 * The one validator for a user token, wherever it came from: this browser's
 * storage, the service's answer, or a contract read. The service is not a
 * trusted renderer of arbitrary metadata either — its rows started life as
 * somebody's `PUT`.
 */
export function validateUserToken(entry: unknown): FluentTokenDefinition | null {
  if (typeof entry !== "object" || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  const { chainId, address, symbol, name, decimals } = candidate;

  if (typeof chainId !== "number" || !Number.isInteger(chainId)) return null;
  if (typeof address !== "string" || !isAddress(address)) return null;
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  // Same bound the on-chain reader applies, so a stored entry and a fresh
  // contract read can never disagree on what counts as a token.
  if (!isFluentTokenDecimals(decimals)) return null;

  // A user token is an ERC-20 by construction: `native` would let an entry
  // impersonate the chain's own currency and read the account's balance.
  return {
    chainId,
    address: getAddress(address) as Address,
    symbol,
    name,
    decimals,
  };
}

export function resolveUserTokenStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage access throws outright when blocked by browser settings.
    return null;
  }
}

/** Every valid entry under `key`, or `[]` when storage is missing or throws. */
export function readStoredUserTokens(storage: StorageLike | null, key: string) {
  if (!storage) return [];
  try {
    return parseStoredUserTokens(storage.getItem(key));
  } catch {
    return [];
  }
}

/** Replace `key` with `tokens`, or remove it when the list is empty. */
export function writeStoredUserTokens(
  storage: StorageLike | null,
  key: string,
  tokens: readonly FluentTokenDefinition[],
) {
  if (!storage) return;
  try {
    if (tokens.length === 0) {
      storage.removeItem(key);
      return;
    }
    const payload: StoredPayload = { version: 1, tokens: [...tokens] };
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota or private-mode failure: the caller's in-memory copy still serves
    // this view.
  }
}

/**
 * The browser-backed store, used where no Fluent token can exist. Falls back to
 * an in-memory list when storage is unavailable, so the UI keeps working for
 * the current view instead of throwing. Its promises are already settled: the
 * async signatures exist for the backend store, not for this one.
 */
export function createFluentUserTokenStore(options?: {
  storage?: StorageLike;
  key?: string;
}): UserTokenStore {
  const key = options?.key ?? FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY;
  const storage = resolveUserTokenStorage(options?.storage);
  let memory: FluentTokenDefinition[] = [];

  const readAll = (): FluentTokenDefinition[] => {
    if (!storage) return memory;
    try {
      return parseStoredUserTokens(storage.getItem(key));
    } catch {
      return memory;
    }
  };

  const writeAll = (tokens: FluentTokenDefinition[]) => {
    memory = tokens;
    if (!storage) return;
    const payload: StoredPayload = { version: 1, tokens };
    try {
      storage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota or private-mode failure: the in-memory copy still serves this view.
    }
  };

  return {
    async list(chainId) {
      return readAll().filter((token) => token.chainId === chainId);
    },

    async add(token) {
      const all = readAll();
      const tokenKey = fluentTokenIdentity(token);
      if (all.some((existing) => fluentTokenIdentity(existing) === tokenKey)) {
        return { status: "already-present" };
      }
      // Capacity is per chain so a crowded testnet can't lock out mainnet.
      const onChain = all.filter((existing) => existing.chainId === token.chainId);
      if (onChain.length >= FLUENT_USER_TOKEN_LIMIT) {
        return { status: "at-capacity", limit: FLUENT_USER_TOKEN_LIMIT };
      }
      const stored = validateUserToken(token);
      if (!stored) return { status: "invalid" };
      writeAll([...all, stored]);
      return { status: "added" };
    },

    async remove(token) {
      const tokenKey = fluentTokenIdentity(token);
      writeAll(readAll().filter((existing) => fluentTokenIdentity(existing) !== tokenKey));
    },
  };
}
