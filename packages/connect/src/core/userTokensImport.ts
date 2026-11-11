import type { FluentTokenDefinition, StorageLike } from "@fluent.xyz/connect-sdk";

import {
  FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY,
  FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY,
} from "./storageKeys";
import {
  readStoredUserTokens,
  writeStoredUserTokens,
  type FluentUserTokenAddResult,
  type UserTokenStore,
} from "./userTokens";

export type FluentUserTokenImportResult =
  /**
   * Nothing was carried: no local list, a list already on the service, or a run abandoned for
   * a newer subject generation.
   */
  | { status: "skipped"; reason: "no-local-tokens" | "remote-not-empty" | "abandoned" }
  /** Every valid local entry is on the service; the local key is gone. */
  | { status: "imported"; added: number; dropped: number }
  /** Some entries are on the service; the rest stay local for the next attempt. */
  | {
      status: "incomplete";
      added: number;
      dropped: number;
      remaining: number;
      reason: FluentUserTokenAddResult["status"];
    };

/**
 * Carries this browser's User tokens onto the service, once per person.
 *
 * The local key is per browser origin and has no user attached, so this is the
 * only migration possible: the data is in users' browsers, not in a table. It
 * runs after each successful `GET /me/settings`, before the settings are ready.
 *
 * Two facts decide whether it runs. An empty `remoteTokens` means the person
 * has nothing on the service, so a local list is theirs to carry. A marker,
 * written before the first `add`, means a previous attempt already pushed part
 * of the list, which is why a non-empty `remoteTokens` alone does not stop a
 * resume. Entries answered `added`, `already-present` or `invalid` leave the
 * list; a run that stops on `at-capacity` or `failed` writes back exactly the
 * remainder, and the key and the marker go only when the remainder is empty.
 *
 * The marker names its `owner`, because the local key is per browser and the
 * next person to sign in here is not the one whose import stopped halfway. Only
 * that owner may resume past a non-empty `remoteTokens`: for anybody else the
 * marker carries no permission, and a list already on the service stops the
 * import as if no attempt had ever been made.
 */
export async function importLocalUserTokensOnce(params: {
  storage: StorageLike | null;
  /** Defaults to `fluent:widget:tokens:v1`. */
  key?: string;
  /** Defaults to `fluent:widget:tokens-import:v1`. */
  markerKey?: string;
  backend: Pick<UserTokenStore, "add">;
  /**
   * Whose import this is: the subject key. A stopped run may only be resumed
   * by the same owner.
   */
  owner: string;
  /** The `tokens` of the settings answer that just arrived. */
  remoteTokens: readonly FluentTokenDefinition[];
  /**
   * Checked before each write and after every await: a completion from an older
   * subject generation must import nothing, write no local list and remove no
   * local key. The generation that is current owns this browser's storage.
   */
  shouldContinue?: () => boolean;
}): Promise<FluentUserTokenImportResult> {
  const { storage, backend, owner, remoteTokens } = params;
  const key = params.key ?? FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY;
  const markerKey = params.markerKey ?? FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY;
  const alive = params.shouldContinue ?? (() => true);

  const local = readStoredUserTokens(storage, key);
  if (local.length === 0) {
    clearMarker(storage, markerKey);
    return { status: "skipped", reason: "no-local-tokens" };
  }

  const resumable = readMarker(storage, markerKey) === owner;
  if (remoteTokens.length > 0 && !resumable) {
    // A list that was already on the service is the person's own; this
    // browser's leftovers are not theirs to merge into it. Another person's
    // unfinished import is no reason to write into this one's list.
    return { status: "skipped", reason: "remote-not-empty" };
  }

  if (!alive()) return { status: "skipped", reason: "abandoned" };
  setMarker(storage, markerKey, owner);

  let added = 0;
  let dropped = 0;
  const remaining = [...local];

  while (remaining.length > 0) {
    if (!alive()) return { status: "skipped", reason: "abandoned" };

    const [token] = remaining;
    if (!token) break;
    const result = await backend.add(token);
    // The generation may have gone during this add: writing `remaining` would put back entries
    // the current generation has since changed. The key stays as found, and the marker lets this
    // owner's next read start the remainder over.
    if (!alive()) return { status: "skipped", reason: "abandoned" };
    if (result.status === "added") added += 1;
    if (result.status === "invalid") dropped += 1;

    if (result.status === "added" || result.status === "already-present") {
      remaining.shift();
      continue;
    }
    if (result.status === "invalid") {
      // The token itself is wrong: retrying cannot help, so it leaves the local list rather than
      // blocking every entry behind it.
      remaining.shift();
      continue;
    }

    // `at-capacity` or `failed`: stop, keep what is left for the next read.
    writeStoredUserTokens(storage, key, remaining);
    return {
      status: "incomplete",
      added,
      dropped,
      remaining: remaining.length,
      reason: result.status,
    };
  }

  if (!alive()) return { status: "skipped", reason: "abandoned" };
  writeStoredUserTokens(storage, key, []);
  clearMarker(storage, markerKey);
  return { status: "imported", added, dropped };
}

/** Returns the owner of the unfinished import, or `null` if there is none. */
function readMarker(storage: StorageLike | null, markerKey: string) {
  if (!storage) return null;
  try {
    const value = storage.getItem(markerKey);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function setMarker(storage: StorageLike | null, markerKey: string, owner: string) {
  if (!storage) return;
  try {
    storage.setItem(markerKey, owner);
  } catch {
    // Without the marker a resume across a reload degrades to "import nothing
    // while the service already holds a list", which is the safe direction.
  }
}

function clearMarker(storage: StorageLike | null, markerKey: string) {
  if (!storage) return;
  try {
    storage.removeItem(markerKey);
  } catch {
    // A marker left behind lets only its owner carry a later local list into a list already on
    // the service.
  }
}
