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
 * The version of the record written under the key. A record carrying another version reads as
 * no credential, so a release that changes the shape finds old records unreadable rather than
 * half-read.
 */
const RECORD_VERSION = 1;

/** Returns the storage key of one session's refresh credential, from its `authTokenCacheKey`. */
export function refreshCredentialStorageKey(cacheKey: string): string {
  return `${FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX}|${cacheKey}`;
}

/**
 * Returns the storage the refresh credential is kept in: `storage` when given, else
 * `localStorage`. `null` means the credential is not kept: `storage` was `null`, the user has
 * blocked site data (reading `localStorage` throws), or there is no `localStorage` at all.
 */
export function resolveRefreshCredentialStorage(
  storage?: StorageLike | null,
): StorageLike | null {
  return resolveLocalStorage(storage);
}

/**
 * Reads the stored refresh credential at `key`, or `null` when there is none the SDK can use.
 *
 * Anything but a record of this version with a non-empty token and a finite expiry reads as
 * `null`: no storage, a throwing `getItem`, a value another script overwrote, JSON that does not
 * parse, another version. A credential the SDK cannot fully read is not presented to the
 * service: a wrong one can end the Service session, while `null` costs one exchange.
 *
 * Expiry is not checked here; the renewal path checks it with `isRefreshCredentialUsable`.
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
 * Stores the refresh credential for the next page load, and returns whether the write landed. A
 * full or refusing storage costs the next page load an exchange, not this sign-in, so `false`
 * is not an error.
 */
export function saveRefreshCredential(
  storage: StorageLike | null,
  key: string,
  credential: FluentRefreshCredential,
): boolean {
  return writeStoredValue(storage, key, JSON.stringify({ v: RECORD_VERSION, ...credential }));
}

/**
 * Removes the stored refresh credential, and returns whether the storage accepted the removal.
 * A `false` means the bytes may still be on disk, so a caller erasing a credential that is
 * still live at the service also revokes it.
 */
export function forgetRefreshCredential(storage: StorageLike | null, key: string): boolean {
  return removeStoredValue(storage, key);
}

/**
 * Reports whether the credential's Service session has not yet expired. `refreshExpiresAt` is
 * Unix seconds; `now` is ms.
 */
export function isRefreshCredentialUsable(
  credential: FluentRefreshCredential,
  now: number = Date.now(),
): boolean {
  return credential.refreshExpiresAt * 1000 > now;
}
