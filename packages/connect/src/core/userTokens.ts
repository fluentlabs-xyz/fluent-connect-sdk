import {
  fluentTokenKey,
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
  | { status: "invalid" };

/**
 * Persistence for tokens the end user added by hand.
 */
export type UserTokenStore = {
  list(chainId: number): FluentTokenDefinition[];
  add(token: FluentTokenDefinition): FluentUserTokenAddResult;
  remove(token: Pick<FluentTokenDefinition, "chainId" | "address">): void;
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
function parsePayload(raw: string | null): FluentTokenDefinition[] {
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
    const token = validateStoredToken(entry);
    if (!token) continue;
    const key = fluentTokenKey(token);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(token);
  }
  return valid;
}

function validateStoredToken(entry: unknown): FluentTokenDefinition | null {
  if (typeof entry !== "object" || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  const { chainId, address, symbol, name, decimals } = candidate;

  if (typeof chainId !== "number" || !Number.isInteger(chainId)) return null;
  if (typeof address !== "string" || !isAddress(address)) return null;
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) return null;
  if (decimals < 0 || decimals > 36) return null;

  // A stored token is an ERC-20 by construction: `native` would let a stored
  // entry impersonate the chain's own currency and read the account's balance.
  return {
    chainId,
    address: getAddress(address) as Address,
    symbol,
    name,
    decimals,
  };
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage access throws outright when blocked by browser settings.
    return null;
  }
}

/**
 * The browser-backed store. Falls back to an in-memory list when storage is
 * unavailable, so the UI keeps working for the current view instead of throwing.
 */
export function createFluentUserTokenStore(options?: {
  storage?: StorageLike;
  key?: string;
}): UserTokenStore {
  const key = options?.key ?? FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY;
  const storage = resolveStorage(options?.storage);
  let memory: FluentTokenDefinition[] = [];

  const readAll = (): FluentTokenDefinition[] => {
    if (!storage) return memory;
    try {
      return parsePayload(storage.getItem(key));
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
    list(chainId) {
      return readAll().filter((token) => token.chainId === chainId);
    },

    add(token) {
      const all = readAll();
      const tokenKey = fluentTokenKey(token);
      if (all.some((existing) => fluentTokenKey(existing) === tokenKey)) {
        return { status: "already-present" };
      }
      // Capacity is per chain so a crowded testnet can't lock out mainnet.
      const onChain = all.filter((existing) => existing.chainId === token.chainId);
      if (onChain.length >= FLUENT_USER_TOKEN_LIMIT) {
        return { status: "at-capacity", limit: FLUENT_USER_TOKEN_LIMIT };
      }
      const stored = validateStoredToken(token);
      if (!stored) return { status: "invalid" };
      writeAll([...all, stored]);
      return { status: "added" };
    },

    remove(token) {
      const tokenKey = fluentTokenKey(token);
      writeAll(readAll().filter((existing) => fluentTokenKey(existing) !== tokenKey));
    },
  };
}
