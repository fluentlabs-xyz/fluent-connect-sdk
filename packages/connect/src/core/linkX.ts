import type { StorageLike } from "@fluent.xyz/connect-sdk";

import { FluentAuthError, type FluentAuthErrorCode } from "./authToken";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./browserStorage";
import type { FluentWidgetAuthMode } from "./config";
import { HttpError, requestJson } from "../utils/postJson";
import type { FluentAccountType } from "../widget/batchOperation";

/** One X account as the Fluent auth service reports it. */
export type FluentXAccount = {
  id: string;
  handle: string;
  avatarUrl: string;
};

/**
 * The wire body of `GET /api/v1/me/profile` and of `POST /api/v1/me/identity/privy`.
 *
 * `x` is required and nullable: the route always says something about the X account, and `null`
 * is that answer — this user has none linked. A body without the key at all is not this route's.
 */
export type FluentProfile = {
  subject: string;
  appId: string;
  x: FluentXAccount | null;
};

export type FluentLinkXResult =
  | { status: "linked"; x: FluentXAccount }
  /** The page is leaving for X. Call linkX() again after the return; useLinkX() does it on mount. */
  | { status: "redirecting" };

/**
 * What the widget leaves behind before the page goes to X, so the call that follows the return
 * knows a link is in progress and whose it is.
 *
 * `subject` is the Privy `user.id` that started the hop — the same id the direct Fluent session
 * carries (`createLocalFluentSession`). Two people sharing a browser must not resume each
 * other's link, and a marker left by a session that is gone must not resume at all.
 */
export type FluentLinkXMarker = {
  /** `Date.now()` at the hop, kept for diagnostics; nothing branches on its age. */
  started: number;
  subject: string;
};

/** UI intent only: never store a token, credential, or authorization here. */
export const FLUENT_LINK_X_MARKER_KEY = "fluent:widget:link-x:v1";

/** The `type` of a Privy linked account that is an X account, in both the user and the token. */
const X_LINKED_ACCOUNT_TYPE = "twitter_oauth";

/**
 * The `PrivyErrorCode` values `linkX()` maps to something other than `link_failed`, as values
 * and never as messages or classes (`@privy-io/react-auth`, `types-B_DvyjIb.d.ts:222-240`).
 *
 * Literals rather than the enum itself so this file stays free of the Privy import — it is the
 * core, and runs in tests that mount no React. `FluentWidgetContent` pins them back to
 * `PrivyErrorCode` at compile time, which is what keeps them honest if Privy renames a value.
 */
export type FluentLinkXPrivyErrorCode =
  | "oauth_user_denied"
  | "exited_link_flow"
  | "linked_to_another_user";

/** The service's own refusal for an X identity that already belongs to somebody else. */
const SERVICE_IDENTITY_ALREADY_LINKED = "privy_identity_already_linked";

/**
 * An X account from a wire body, or `null` when what arrived is not one.
 *
 * All three fields or nothing: a half-filled account would be rendered as a linked X with an
 * empty handle, which is worse for the integrator than being told the link did not complete.
 */
export function readFluentXAccount(raw: unknown): FluentXAccount | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, handle, avatarUrl } = raw as {
    id?: unknown;
    handle?: unknown;
    avatarUrl?: unknown;
  };
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  if (typeof avatarUrl !== "string" || avatarUrl.length === 0) return null;
  return { id, handle, avatarUrl };
}

/**
 * A profile from a wire body, or `null` when the body is not one — a malformed `x`, a missing
 * `x`, or a subject and App the route always sends. Tolerant about what it does not model: the
 * service may add fields, and reading them is not this reader's business.
 */
export function readFluentProfile(raw: unknown): FluentProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { subject, appId, x } = raw as { subject?: unknown; appId?: unknown; x?: unknown };
  if (typeof subject !== "string" || subject.length === 0) return null;
  if (typeof appId !== "string" || appId.length === 0) return null;
  if (x === null) return { subject, appId, x: null };
  const account = readFluentXAccount(x);
  return account ? { subject, appId, x: account } : null;
}

/**
 * Whether a Privy identity token already says this user has an X account.
 *
 * The claim is a JSON **string** holding the array, which is the shape the service models
 * (`PrivyIdentityClaims.LinkedAccounts string`) and the shape a captured real token carries. An
 * array-valued claim is a shape this SDK has never been handed, so it reads as "not linked"
 * rather than being guessed at — like a malformed JWT, malformed JSON, an absent claim or a
 * differently cased type. Fail-closed throughout: the cost of a false negative is one Privy
 * round trip the user would have taken anyway, the cost of a false positive is a POST that
 * cannot succeed.
 *
 * A UI probe, not signature verification: nothing here proves the token is Privy's.
 */
export function identityTokenHasLinkedX(token: string | null | undefined): boolean {
  if (typeof token !== "string") return false;
  try {
    const [, body = ""] = token.split(".");
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as {
      linked_accounts?: unknown;
    };
    if (typeof claims.linked_accounts !== "string") return false;
    const accounts: unknown = JSON.parse(claims.linked_accounts);
    if (!Array.isArray(accounts)) return false;
    return accounts.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === X_LINKED_ACCOUNT_TYPE,
    );
  } catch {
    return false;
  }
}

/**
 * Whether a Privy user already has an X account linked, read from `user.linkedAccounts`.
 *
 * This is the completion signal of a redirected link, and the only one there is: in 2.25.0 the
 * link intent `useLinkAccount` keeps is a `useRef`, so the reload the OAuth hop performs takes
 * it with it and `onSuccess` never fires for the link the user just finished.
 */
export function privyUserHasLinkedX(
  linkedAccounts: ReadonlyArray<{ type: string }> | undefined,
): boolean {
  return Boolean(linkedAccounts?.some((account) => account.type === X_LINKED_ACCOUNT_TYPE));
}

/**
 * What the tab holds under the marker key. Three answers, not two, because the caller has to
 * tell "no link is in progress" from "something is there and it is not a link": the first is
 * a fresh ask, the second is intent that has to be dropped — and `linkX()` must do no work on
 * dropped intent (criterion 16), which it cannot know to refuse if both read as `null`.
 */
export type LinkXMarkerRead =
  | { kind: "none" }
  | { kind: "marker"; marker: FluentLinkXMarker }
  /** A stored value that is not a marker. Removed on the way out. */
  | { kind: "invalid" };

/**
 * The marker this tab holds, if any. A raw value that is not a marker is removed on the way
 * out: it can only be a leftover of an older shape or of a storage somebody else wrote, and
 * leaving it would make every later read do this again.
 */
export function readLinkXMarker(storage: StorageLike | null): LinkXMarkerRead {
  const raw = readStoredValue(storage, FLUENT_LINK_X_MARKER_KEY);
  if (raw === null) return { kind: "none" };
  const marker = parseLinkXMarker(raw);
  if (!marker) {
    removeStoredValue(storage, FLUENT_LINK_X_MARKER_KEY);
    return { kind: "invalid" };
  }
  return { kind: "marker", marker };
}

function parseLinkXMarker(raw: string): FluentLinkXMarker | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { started, subject } = parsed as { started?: unknown; subject?: unknown };
  if (typeof started !== "number" || !Number.isFinite(started)) return null;
  if (typeof subject !== "string" || subject.length === 0) return null;
  return { started, subject };
}

export function writeLinkXMarker(storage: StorageLike | null, marker: FluentLinkXMarker): void {
  writeStoredValue(storage, FLUENT_LINK_X_MARKER_KEY, JSON.stringify(marker));
}

export function clearLinkXMarker(storage: StorageLike | null): void {
  removeStoredValue(storage, FLUENT_LINK_X_MARKER_KEY);
}

/**
 * Whether `subject` is the one that started the hop this marker records. Only that subject may
 * resume it: the marker outlives the session that wrote it, and the next person to sign in on
 * this browser must not walk into somebody else's half-finished link.
 */
export function ownsLinkXMarker(
  marker: FluentLinkXMarker | null,
  subject: string | undefined,
): boolean {
  return Boolean(marker && subject && marker.subject === subject);
}

/**
 * A Privy link failure as a `FluentAuthError`. Mapped by the exact `PrivyErrorCode` value;
 * everything this list does not name — `cannot_link_more_of_type` included — is `link_failed`,
 * because an integrator can act on "the user said no" and on "that X is somebody else's", and
 * on nothing else.
 */
export function toLinkXPrivyError(code: FluentLinkXPrivyErrorCode | string): FluentAuthError {
  switch (code) {
    case "oauth_user_denied":
    case "exited_link_flow":
      return new FluentAuthError("user_rejected", "The user did not finish linking X.");
    case "linked_to_another_user":
      return new FluentAuthError(
        "linked_to_another_user",
        "That X account is already linked to another Fluent user.",
      );
    default:
      return new FluentAuthError("link_failed", `Privy could not link X (${String(code)}).`);
  }
}

/**
 * The codes `linkX()` rejects with, and no others. An integrator writes one `switch` over these;
 * a code from another call's vocabulary — `getAuthToken()` refusing with `app_not_auth_enabled`,
 * say — would reach that `switch` unannounced, so everything outside this set is `link_failed`.
 */
export type FluentLinkXErrorCode = Extract<
  FluentAuthErrorCode,
  | "user_rejected"
  | "linked_to_another_user"
  | "not_authenticated"
  | "hosted_not_supported"
  | "bad_request"
  | "link_failed"
>;

const LINK_X_ERROR_CODES: ReadonlySet<FluentAuthErrorCode> = new Set<FluentLinkXErrorCode>([
  "user_rejected",
  "linked_to_another_user",
  "not_authenticated",
  "hosted_not_supported",
  "bad_request",
  "link_failed",
]);

/**
 * The refusal for intent this call found in the tab and did not resume: a marker another
 * subject left behind, or a stored value that is not a marker at all. Both are cleared and
 * nothing is linked — no refresh, no request, no redirect — so the honest answer is neither
 * `linked` nor `redirecting`. The caller starts afresh with another call.
 *
 * Its own class, under `link_failed`, so that the one caller that did not ask — `useLinkX()`
 * resuming a return on mount — can tell a discard from a link that genuinely failed. For an
 * integrator it is a `FluentAuthError` with code `link_failed` like any other; the class is
 * not exported from the package root.
 */
export class LinkXIntentDiscardedError extends FluentAuthError {
  constructor() {
    super(
      "link_failed",
      "A link that another user started in this tab, or a stale record of one, was discarded; nothing was linked. Call linkX() again.",
    );
    this.name = "FluentAuthError";
  }
}

export function linkXIntentDiscardedError(): FluentAuthError {
  return new LinkXIntentDiscardedError();
}

/** Whether a rejection is a discard — intent dropped, no work done — rather than a failure. */
export function isLinkXIntentDiscarded(err: unknown): boolean {
  return err instanceof LinkXIntentDiscardedError;
}

/**
 * Anything that went wrong under `linkX()`, as one of its own codes. A `FluentAuthError` keeps
 * its code only when that code is in `linkX()`'s vocabulary; a refusal from another call —
 * `getAuthToken()` under the POST, most likely — keeps its message and status under
 * `link_failed`.
 */
function toLinkXError(err: unknown): FluentAuthError {
  if (err instanceof FluentAuthError) {
    if (LINK_X_ERROR_CODES.has(err.code)) return err;
    return new FluentAuthError("link_failed", err.message, err.status);
  }
  if (err instanceof HttpError) {
    // The service's own `400 bad_request`, surfaced under its own name: the body it refused is
    // the one this SDK built, so an integrator seeing it is looking at a bug here, not at a
    // user who has to do something.
    if (err.status === 400) return new FluentAuthError("bad_request", err.message, err.status);
    // Matched on the code rather than the status: the code is what the service's contract
    // names, and `403 privy_wallet_mismatch` is deliberately not one of these — nothing the
    // integrator can do about it differs from any other failure.
    if (err.body?.code === SERVICE_IDENTITY_ALREADY_LINKED) {
      return new FluentAuthError(
        "linked_to_another_user",
        "That X account is already linked to another Fluent user.",
        err.status,
      );
    }
    return new FluentAuthError("link_failed", err.message, err.status);
  }
  return new FluentAuthError("link_failed", err instanceof Error ? err.message : String(err));
}

/** Everything `requestLinkX` needs, and nothing React or Privy hands out only to a hook. */
export type RequestLinkXParams = {
  /** The resolved auth mode. `"hosted"` is refused before anything else happens. */
  authMode: FluentWidgetAuthMode;
  /** The connected account kind, as the widget derived it. */
  accountKind: FluentAccountType | undefined;
  /** The connected Privy user's id: the marker's owner, and the proof there is a user at all. */
  subject: string | undefined;
  publicApiUrl: string;
  /** The identity token the widget holds now. Probed first, before anything is refreshed. */
  identityToken: string | null;
  /** The Fluent token the POST authenticates with. */
  getAuthToken: () => Promise<string>;
  /** The Privy access token the POST carries. */
  getAccessToken: () => Promise<string | null>;
  /** A *fresh* identity token: the post-link one, through Privy's `refreshUser()`. */
  getIdentityToken: () => Promise<string | null>;
  /** Privy's `linkTwitter()`. It starts the navigation to X; the page is about to unload. */
  linkTwitter: () => void;
  /** Where the marker is kept. `sessionStorage` in the widget; `null` disables it. */
  storage: StorageLike | null;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Link an X account to the connected Fluent ID — one idempotent, re-enterable call.
 *
 * Linking X needs an OAuth round trip that leaves the page: Privy 2.25.0 offers no other
 * primitive for it. So this does not return one long-lived promise. A user who already has X
 * resolves `linked` without a dialog and without leaving; a user who has none gets a marker,
 * Privy's redirect and `redirecting`, and the *same* call after the browser comes back — made
 * by `useLinkX()` on mount or by the integrator — takes the first path and resolves `linked`.
 *
 * The probe of the identity token is not an optimisation. `linkTwitter()` for a user who
 * already has an X account fails with `cannot_link_more_of_type` instead of linking, so
 * something has to know the answer before the hop; and the refresh in the middle of it is what
 * makes the re-entry work at all — the OAuth link does not mint a new identity token by itself,
 * and the service refreshes its X snapshot from the token this POST carries. A stale token
 * refreshes nothing and answers `x: null`.
 *
 * `GET /me/profile` is never called and nothing is polled.
 */
export async function requestLinkX(params: RequestLinkXParams): Promise<FluentLinkXResult> {
  // First, before any Privy, wallet or network call: hosted mode has no Privy session in this
  // page, so there is nothing here to link an X account to.
  if (params.authMode === "hosted") {
    throw new FluentAuthError(
      "hosted_not_supported",
      'linkX() needs authMode: "direct" — in hosted mode the user\'s Privy session lives on the authorize page, not in this page.',
    );
  }
  if (params.accountKind === "eoa") {
    throw new FluentAuthError(
      "link_failed",
      "linkX() supports a Fluent ID. An external wallet first needs a Privy session of its own through SIWE, which is FLU-1555.",
    );
  }
  if (params.accountKind !== "smart" || !params.subject) {
    throw new FluentAuthError("not_authenticated", "Connect a Fluent ID first.");
  }

  // One boundary around everything that can fail from here on — the refresh, the redirect, the
  // POST and the token under it — so the call rejects with its own six codes and nothing else.
  try {
    return await linkOrRedirect(params, params.subject);
  } catch (err) {
    throw toLinkXError(err);
  }
}

async function linkOrRedirect(
  params: RequestLinkXParams,
  subject: string,
): Promise<FluentLinkXResult> {
  // The token the widget already holds, then exactly one refresh. Two probes rather than one
  // because the common re-entry — back from X, user.linkedAccounts already says linked — holds
  // a token minted before the link, and the common already-linked call holds one minted after.
  let identityToken = params.identityToken;
  if (!identityTokenHasLinkedX(identityToken)) {
    identityToken = await params.getIdentityToken();
  }

  if (!identityTokenHasLinkedX(identityToken)) {
    // The hop. The marker goes first: `linkTwitter()` navigates, and anything written after it
    // may never run.
    writeLinkXMarker(params.storage, { started: Date.now(), subject });
    try {
      params.linkTwitter();
    } catch (err) {
      // No navigation started, so no return is coming: a marker left here would make the next
      // call wait for one.
      clearLinkXMarker(params.storage);
      throw err;
    }
    return { status: "redirecting" };
  }

  const accessToken = await params.getAccessToken();
  if (!accessToken) {
    throw new FluentAuthError("link_failed", "Privy session is not ready; sign in again.");
  }
  const authToken = await params.getAuthToken();
  const body = await requestJson<unknown>(`${params.publicApiUrl}/me/identity/privy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    // Exactly these two fields. The App and the subject come from the bearer, and a browser
    // sets `Origin` itself — this route takes neither from the caller.
    body: { accessToken, identityToken },
    fetch: params.fetch,
  });
  const x = readFluentProfile(body)?.x;
  if (!x) {
    // A `200` whose `x` is null, missing or malformed. The route answers that for a token
    // whose `linked_accounts` carried no X, which here means the refresh above did not get
    // the post-link token — nothing was linked, and saying `linked` would be a lie.
    throw new FluentAuthError("link_failed", "The service accepted the link but reported no X account.");
  }
  return { status: "linked", x };
}
