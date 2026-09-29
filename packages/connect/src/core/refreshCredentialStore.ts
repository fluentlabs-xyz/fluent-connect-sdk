import type { StorageLike } from "@fluent.xyz/connect-sdk";

import { type FluentRefreshCredential, readRefreshCredential } from "./authToken";
import {
  readStoredValue,
  removeStoredValue,
  resolveLocalStorage,
  writeStoredValue,
} from "./browserStorage";
import { FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX } from "./storageKeys";

/**
 * The record shape written under the key. The version is checked on the way in and a record
 * that does not carry this one is no credential: a future release that changes the shape must
 * find the old rows unreadable rather than half-read.
 */
const RECORD_VERSION = 1;

/** Where this audience and subject's credential lives. `cacheKey` is `authTokenCacheKey`. */
export function refreshCredentialStorageKey(cacheKey: string): string {
  return `${FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX}|${cacheKey}`;
}

/**
 * `localStorage`, unless a caller named something else. `null` disables persistence entirely,
 * and so does a browser that refuses storage — reading the property throws outright when the
 * user has blocked it, and in a non-browser build there is nothing there at all.
 */
export function resolveRefreshCredentialStorage(
  storage?: StorageLike | null,
): StorageLike | null {
  return resolveLocalStorage(storage);
}

/**
 * This subject's stored credential, or `null` when there is none the SDK can use.
 *
 * Everything that is not a record of this version carrying a non-empty token and a finite
 * expiry reads as `null`: no storage, a throwing `getItem`, a value another script overwrote,
 * JSON that does not parse, a version from a release that is not this one. A credential the SDK
 * cannot fully understand is not presented to the service — the cost of being wrong is a
 * `401 refresh_token_reused` that ends the person's session, and the cost of returning `null`
 * is one exchange.
 *
 * Expiry is *not* checked here. Whether the family is still alive is the renewal path's
 * decision, so that a dead credential can be seen to cost no refresh request at all.
 */
export function loadRefreshCredential(
  storage: StorageLike | null,
  key: string,
): FluentRefreshCredential | null {
  const raw = readStoredValue(storage, key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if ((parsed as { v?: unknown }).v !== RECORD_VERSION) return null;
  return readRefreshCredential(parsed);
}

/**
 * Keep this subject's credential for the next page load. Returns whether the bytes actually
 * landed: a full or refusing storage is a session that does not survive a reload, never a
 * failed sign-in, so no caller may treat `false` as an error.
 */
export function saveRefreshCredential(
  storage: StorageLike | null,
  key: string,
  credential: FluentRefreshCredential,
): boolean {
  return writeStoredValue(storage, key, JSON.stringify({ v: RECORD_VERSION, ...credential }));
}

/**
 * Remove this subject's credential. Returns whether the removal was accepted — and nothing more
 * than that: a `false` says the bytes may well still be on disk, which is why every caller that
 * erases a credential also stops using it in this page and asks the service to revoke its
 * family. Erasure is not something a browser lets this SDK guarantee.
 */
export function forgetRefreshCredential(storage: StorageLike | null, key: string): boolean {
  return removeStoredValue(storage, key);
}

/** Whether the family is still alive. `refreshExpiresAt` is Unix seconds; `now` is ms. */
export function isRefreshCredentialUsable(
  credential: FluentRefreshCredential,
  now: number = Date.now(),
): boolean {
  return credential.refreshExpiresAt * 1000 > now;
}
