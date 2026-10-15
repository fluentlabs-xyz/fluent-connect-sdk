import type { StorageLike } from "@fluent.xyz/connect-sdk";

/**
 * Web Storage, best effort, for the few values the widget keeps in the browser.
 *
 * Every function here answers rather than throws. A browser may refuse storage outright — the
 * user blocked site data, an extension replaced the property, the quota is full, a non-browser
 * build has no storage at all — and none of those refusals is an error in the operation the
 * caller was performing. What persistence buys is a session that survives a reload; losing it
 * costs the next page load one re-authentication, and must never cost the caller the result it
 * already holds or abort a teardown half way through.
 */

/**
 * `localStorage`, unless a caller named something else. `null` disables persistence entirely,
 * and so does a browser that refuses storage — reading the property itself throws when the user
 * has blocked site data.
 */
export function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * `sessionStorage`, unless a caller named something else — the tab-scoped half, for the markers
 * that only have to survive a redirect away from the page and back. Same refusals, same answer:
 * `null` means this SDK has no storage here and the value simply is not kept.
 */
export function resolveSessionStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The raw string under `key`, or `null` when there is none this SDK can read. A throwing
 * `getItem` is the same answer as an absent key: nothing stored here.
 */
export function readStoredValue(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Keep `value` under `key`. Returns whether the bytes actually landed, and no caller may treat
 * `false` as a failure of its own operation.
 */
export function writeStoredValue(storage: StorageLike | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove `key`. Returns whether the removal was accepted — and nothing more than that: a `false`
 * says the bytes may well still be on disk. A caller erasing a secret therefore also stops using
 * it in this page and, when the value is a credential, asks the service to invalidate it.
 * Erasure is not something a browser lets this SDK guarantee.
 */
export function removeStoredValue(storage: StorageLike | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
