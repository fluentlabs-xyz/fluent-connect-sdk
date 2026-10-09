import type { StorageLike } from "@fluent.xyz/connect-sdk";
import { getAddress } from "viem";

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
 * `subject` is the Privy `user.id` that started the hop — for a Fluent ID the same id the direct
 * Fluent session carries (`createLocalFluentSession`), for an external wallet the id of the
 * Privy user SIWE signed the wallet in as. Two people sharing a browser must not resume each
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

/** The `type` and `chainType` of a Privy linked account that is an Ethereum wallet. */
const WALLET_LINKED_ACCOUNT_TYPE = "wallet";
const ETHEREUM_CHAIN_TYPE = "ethereum";
/**
 * How Privy marks a wallet entry as one of its embedded wallets, per the 2.25.0 declaration of
 * `Wallet` (`dist/dts/types-B_DvyjIb.d.ts`): `walletClientType` is `privy` — or `privy-v2` —
 * "then this is a privy embedded wallet", and `connectorType` is `embedded`. An external wallet
 * carries its own client (`metamask`, `coinbase_wallet`, …) and connector (`injected`,
 * `wallet_connect`, …), or none at all when it was verified headlessly, as SIWE does here.
 */
const EMBEDDED_WALLET_CLIENT_TYPES: ReadonlySet<string> = new Set(["privy", "privy-v2"]);
const EMBEDDED_CONNECTOR_TYPE = "embedded";

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
 * A Privy user as the core reads one: the id, and the linked accounts an Ethereum wallet may be
 * among. Privy's own `User` satisfies it; the core names only what it reads, so that it stays
 * free of the Privy import (see `FluentLinkXPrivyErrorCode`).
 */
export type FluentLinkXPrivyUser = {
  id: string;
  linkedAccounts: ReadonlyArray<FluentLinkXLinkedAccount>;
};

/**
 * One linked account as the core reads it. `walletClientType` and `connectorType` are what
 * Privy records about a wallet at its last verification, and are how an embedded wallet is told
 * from an external one (`privyUserHasExternalWallet`).
 */
export type FluentLinkXLinkedAccount = {
  type: string;
  chainType?: string;
  address?: string;
  walletClientType?: string;
  connectorType?: string;
};

/** Whether a linked account is an Ethereum wallet entry at all, embedded or external. */
function isEthereumWalletEntry(account: FluentLinkXLinkedAccount): boolean {
  return account.type === WALLET_LINKED_ACCOUNT_TYPE && account.chainType === ETHEREUM_CHAIN_TYPE;
}

/** Whether an Ethereum wallet entry is one of Privy's own embedded wallets. */
function isEmbeddedWalletEntry(account: FluentLinkXLinkedAccount): boolean {
  return (
    (typeof account.walletClientType === "string" &&
      EMBEDDED_WALLET_CLIENT_TYPES.has(account.walletClientType)) ||
    account.connectorType === EMBEDDED_CONNECTOR_TYPE
  );
}

/**
 * Whether a Privy user owns `address`: whether `user.linkedAccounts` holds an Ethereum wallet
 * entry at that address, compared case-insensitively.
 *
 * This is what makes a live Privy session the connected wallet's own, and the only thing that
 * does. A Privy user signed in some other way — a Fluent ID through X, say, or the SIWE session
 * of a wallet the user has since switched away from — is a *mismatched* session for this
 * wallet, not an absent one; an embedded wallet on the user is an Ethereum wallet too, at an
 * address that is not the connected one, and so counts for nothing here.
 */
export function privyUserOwnsWallet(
  user: FluentLinkXPrivyUser | null | undefined,
  address: string | undefined,
): boolean {
  if (!user || !address) return false;
  // Fail-closed, like `privyUserHasLinkedX`: a user Privy restored always carries the array, and
  // one that does not — a shape this SDK has never been handed — owns nothing.
  if (!Array.isArray(user.linkedAccounts)) return false;
  const wanted = address.toLowerCase();
  return user.linkedAccounts.some(
    (account) =>
      isEthereumWalletEntry(account) &&
      typeof account.address === "string" &&
      account.address.toLowerCase() === wanted,
  );
}

/**
 * Whether a Privy user holds an **external** Ethereum wallet among its linked accounts: a wallet
 * entry that is not one of Privy's embedded wallets (`isEmbeddedWalletEntry`).
 *
 * This is how the widget tells a wallet user's Privy session from a Fluent ID's without needing
 * the wallet to be connected, or to be the one connected. This SDK signs an external wallet in
 * to Privy in one way only — the SIWE login `linkX()` runs — and gives a Fluent ID no way to
 * link one: its Privy modal offers X, Google and email (`loginMethodsAndOrder` in
 * `core/config.ts`), and nothing here calls `linkWallet`. So a Privy user with an external
 * wallet is, as far as this SDK is concerned, a wallet SIWE signed in — whether that wallet is
 * still connected, has been swapped for another in the connector, or has an embedded wallet
 * Privy attached beside it. The one exception is the widget's own stored Fluent session naming
 * the user, which the widget reads separately.
 *
 * Fail-safe towards the wallet: an Ethereum wallet entry that Privy has not marked embedded is
 * external. A session misread this way stays a wallet's — no Fluent session is made from it —
 * which is the cheaper mistake; the other direction would turn a wallet user into a Fluent ID.
 * Like `privyUserOwnsWallet`, a user without the array holds nothing.
 */
export function privyUserHasExternalWallet(user: FluentLinkXPrivyUser | null | undefined): boolean {
  if (!user) return false;
  if (!Array.isArray(user.linkedAccounts)) return false;
  return user.linkedAccounts.some(
    (account) => isEthereumWalletEntry(account) && !isEmbeddedWalletEntry(account),
  );
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

/**
 * The connected external wallet, as the SIWE sign-in needs it. `null` while there is none, or
 * while its client — the thing that can sign — has not been handed over yet.
 */
export type LinkXWalletInput = {
  /** The address as the connector reports it, in whatever case. Never changed by the core. */
  address: string;
  /** The chain the SIWE session is bound to: the widget's network, not the wallet's. */
  chainId: number;
  /**
   * EIP-191 `personal_sign` of exactly `message` by the connected account. A signature prompt
   * and never a transaction; the wallet's refusal is what `user_rejected` reads.
   */
  signMessage: (message: string) => Promise<string>;
};

/**
 * The Privy session and the SIWE login, injected: the core calls these and holds no hook.
 *
 * `logout`, `generateSiweMessage` and `loginWithSiwe` are thunks that reach Privy's functions
 * *of the latest render* when they are called, never ones captured when `linkX()` started. In
 * 2.25.0 `loginWithSiwe` throws `User already authenticated` from the `user` of the render that
 * created it, so the one created before a logout keeps throwing after it; `generateSiweMessage`
 * likewise reads that render's `authenticated` to tell a login from a link.
 */
export type LinkXSiweInput = {
  /** The live Privy session as of the latest render, or `null` when nobody is signed in. */
  session: FluentLinkXPrivyUser | null;
  /** The Privy user the Fluent session names, if this page holds a Fluent session at all. */
  fluentSessionUserId: string | undefined;
  /**
   * Privy's `logout()`, resolved only once the commit on which `authenticated` is false and
   * `user` is null has happened — that is the render whose `loginWithSiwe` may be called. Rejects
   * `link_failed` when that commit does not come within the widget's bound. Called for a live
   * session that is another wallet's, and for the session SIWE just made when the user it signed
   * in does not own the connected wallet.
   */
  logout: () => Promise<void>;
  /** Privy's `generateSiweMessage`: an EIP-4361 message for an EIP-55 address and a chain. */
  generateSiweMessage: (input: { address: string; chainId: `eip155:${number}` }) => Promise<string>;
  /** Privy's `loginWithSiwe`. Resolves the user it signed in, which is checked, not trusted. */
  loginWithSiwe: (input: { message: string; signature: string }) => Promise<FluentLinkXPrivyUser>;
};

/** Everything `requestLinkX` needs, and nothing React or Privy hands out only to a hook. */
export type RequestLinkXParams = {
  /** The resolved auth mode. `"hosted"` is refused before anything else happens. */
  authMode: FluentWidgetAuthMode;
  /** The connected account kind, as the widget derived it. */
  accountKind: FluentAccountType | undefined;
  /** The connected Privy user's id: for a Fluent ID the marker's owner, and the proof there is a user at all. */
  subject: string | undefined;
  /** The connected external wallet, for `accountKind: "eoa"`. Ignored for a Fluent ID. */
  wallet: LinkXWalletInput | null;
  /** The Privy session and the SIWE sign-in, for `accountKind: "eoa"`. Ignored for a Fluent ID. */
  siwe: LinkXSiweInput;
  publicApiUrl: string;
  /** The identity token the widget holds now. Probed first, before anything is refreshed. */
  identityToken: string | null;
  /**
   * The Fluent token the POST authenticates with. For an external wallet it is also minted
   * before the hop, so the wallet signs its challenge before the page leaves (`linkWalletUser`).
   */
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
 * Link an X account to the connected account — one idempotent, re-enterable call.
 *
 * Linking X needs an OAuth round trip that leaves the page: Privy 2.25.0 offers no other
 * primitive for it. So this does not return one long-lived promise. A user who already has X
 * resolves `linked` without a dialog and without leaving; a user who has none gets a marker,
 * Privy's redirect and `redirecting`, and the *same* call after the browser comes back — made
 * by `useLinkX()` on mount or by the integrator — takes the first path and resolves `linked`.
 *
 * A Fluent ID has the Privy session the link needs. An external wallet gets one first: the
 * wallet is signed in to Privy with SIWE — a signature, never a transaction — and the rest is the
 * same path with that session's user as the marker's subject (`linkWalletUser`). Nothing about
 * the Fluent user changes over it: the connected account, its kind and the wallet-auth session
 * the Fluent token comes from are the wallet's before, during and after.
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
    if (!params.wallet) {
      // The connector names an address but has not handed over the client that signs for it,
      // which both the SIWE message and the Fluent token need. The same refusal as no wallet at
      // all: it is the caller's cue to wait for the connection to finish and ask again.
      throw new FluentAuthError(
        "not_authenticated",
        "The connected wallet has no signer yet; wait for the connection to finish and call linkX() again.",
      );
    }
    try {
      return await linkWalletUser(params, params.wallet);
    } catch (err) {
      throw toLinkXError(err);
    }
  }
  if (params.accountKind !== "smart" || !params.subject) {
    throw new FluentAuthError("not_authenticated", "Connect a Fluent ID or an external wallet first.");
  }

  // One boundary around everything that can fail from here on — the refresh, the redirect, the
  // POST and the token under it — so the call rejects with its own six codes and nothing else.
  try {
    return await linkOrRedirect(params, params.subject);
  } catch (err) {
    throw toLinkXError(err);
  }
}

/**
 * The external wallet's way in: a Privy session that is the wallet's own, then the same link as
 * a Fluent ID's with that session's user as the subject.
 *
 * Which session that is, in order:
 *
 * - A live session that owns the connected wallet (`privyUserOwnsWallet`) is used as it is. This
 *   is the repeat call, and the return from X: no logout, no signature, no second SIWE.
 * - A live session that does not own it is somebody else's. When the Fluent session on this page
 *   names that Privy user it is a Fluent ID — one whose smart account may merely still be
 *   arriving, which is when the account reads as `eoa` with an external wallet beside it — and
 *   signing it out from under the person is not this call's to do: `link_failed`, with nothing
 *   touched. Otherwise it is a leftover — the Privy session of a wallet the user switched away
 *   from in MetaMask, kept across reloads while the connector followed the switch — and it is
 *   replaced: Privy's `logout()`, awaited to the signed-out commit, then SIWE. The wallet stays
 *   connected and its Fluent session is not ended; a Privy session carries nothing of a wallet
 *   user's Fluent session, whose subject, token and cache key derive from the address alone.
 * - No live session: SIWE.
 *
 * After SIWE the identity token the widget held is not probed: it was the replaced session's,
 * or none, and the signed-in user's own comes from the refresh.
 *
 * With the session settled, the wallet's Fluent token is minted before anything else happens
 * (`mintWalletFluentToken`): the wallet signs everything it is going to sign before the page
 * leaves for X, and the page that comes back renews the token from the refresh credential the
 * mint persisted, with no wallet prompt at all.
 */
async function linkWalletUser(
  params: RequestLinkXParams,
  wallet: LinkXWalletInput,
): Promise<FluentLinkXResult> {
  const { siwe } = params;
  let session = siwe.session;
  if (session && !privyUserOwnsWallet(session, wallet.address)) {
    if (siwe.fluentSessionUserId !== undefined && siwe.fluentSessionUserId === session.id) {
      throw new FluentAuthError(
        "link_failed",
        "A Fluent ID is signed in on this page. Linking X for the connected external wallet would sign it out; disconnect the Fluent ID first, or link X as the Fluent ID.",
      );
    }
    await siwe.logout();
    session = null;
  }
  let subject: string;
  let identityToken = params.identityToken;
  if (session) {
    subject = session.id;
  } else {
    subject = (await signWalletInWithSiwe(wallet, siwe)).id;
    // The token the widget held was minted for whoever was signed in before — the session just
    // logged out, or nobody — and says nothing about the user SIWE signed in. Probing it would
    // read that other user's X as this wallet's and POST their token under this wallet's name.
    // Dropped, so the path refreshes and reads the signed-in user's own.
    identityToken = null;
  }
  await mintWalletFluentToken(params);
  return linkOrRedirect({ ...params, identityToken }, subject);
}

/**
 * Sign the connected wallet in to Privy: Privy's message for this address and chain, the
 * wallet's `personal_sign` of exactly that message, and Privy's verdict on the two.
 *
 * The address goes to Privy in its EIP-55 form, which is the form `generateSiweMessage` is
 * declared for; the connector's own spelling is kept everywhere else, and in particular is what
 * the ownership check and the Fluent subject still read. The message is signed verbatim: a SIWE
 * message carries the nonce Privy verifies, and a changed byte is a failed login.
 *
 * The `User` that `loginWithSiwe` resolves is the authoritative post-login user, and it is
 * checked rather than trusted: before anything reads it as the subject it must own this wallet
 * (`privyUserOwnsWallet`). A user that does not is a session this SDK cannot vouch for, and this
 * call fails closed with no marker written, nothing probed and nothing sent. That session is
 * not left behind either: it is logged out, awaited to the signed-out commit, before the
 * rejection settles. A Privy session that owns no connected wallet and that no Fluent session
 * names must not outlive the call — left signed in, the widget would read it as a Fluent ID
 * login the moment it holds an embedded wallet. The wallet is not disconnected, and a logout
 * that does not complete within the widget's bound still rejects `link_failed`.
 */
async function signWalletInWithSiwe(
  wallet: LinkXWalletInput,
  siwe: LinkXSiweInput,
): Promise<FluentLinkXPrivyUser> {
  const message = await siwe.generateSiweMessage({
    address: getAddress(wallet.address),
    chainId: `eip155:${wallet.chainId}`,
  });
  let signature: string;
  try {
    signature = await wallet.signMessage(message);
  } catch (err) {
    if (isSignatureRefusal(err)) {
      throw new FluentAuthError(
        "user_rejected",
        "The user did not sign the message that signs the wallet in to Privy.",
      );
    }
    throw err;
  }
  const user = await siwe.loginWithSiwe({ message, signature });
  if (!isPrivyUser(user) || !privyUserOwnsWallet(user, wallet.address)) {
    // Whatever Privy signed in is logged out before this call answers: the session is not the
    // connected wallet's, and nothing on this page may take it for a Fluent ID. The logout's own
    // failure changes nothing about the verdict — the call rejects `link_failed` either way —
    // and only the message says whether the session is known to be gone.
    let signedOut = true;
    try {
      await siwe.logout();
    } catch {
      signedOut = false;
    }
    throw new FluentAuthError(
      "link_failed",
      signedOut
        ? "Privy signed in a user that does not own the connected wallet; nothing was linked and that session was signed out."
        : "Privy signed in a user that does not own the connected wallet; nothing was linked, and Privy did not confirm signing that session out.",
    );
  }
  return user;
}

/**
 * The wallet's Fluent token, minted before the hop.
 *
 * The POST that completes the link needs it, and that POST runs on the page that comes back
 * from X. Minting it there would open the wallet for the challenge's typed-data signature on a
 * page the user did not expect a prompt from. Minting it here, with the session settled and
 * before the marker and the redirect, puts every signature before the hop: the wallet's own
 * exchange persists a refresh credential, and the return page renews the token from it without
 * asking the wallet anything. On a page that already holds a usable token this costs nothing —
 * `getAuthToken()` answers from its cache or its refresh family — which is the repeat call and
 * the return itself.
 *
 * A refused challenge signature is `user_rejected`, like a refused SIWE signature: the user said
 * no to a prompt, and nothing was written, probed or started. `getAuthToken()` reports the
 * refusal under its own code with the wallet's message, so the refusal is read off the error
 * the way `isSignatureRefusal` reads the wallet's. Anything else it fails with keeps its message
 * under `link_failed`, through `toLinkXError`.
 */
async function mintWalletFluentToken(params: RequestLinkXParams): Promise<void> {
  try {
    await params.getAuthToken();
  } catch (err) {
    if (isSignatureRefusal(err)) {
      throw new FluentAuthError(
        "user_rejected",
        "The user did not sign the challenge that mints the wallet's Fluent token.",
      );
    }
    throw err;
  }
}

/** Whether what `loginWithSiwe` resolved is a user at all: an id, and accounts to read. */
function isPrivyUser(raw: unknown): raw is FluentLinkXPrivyUser {
  if (typeof raw !== "object" || raw === null) return false;
  const { id, linkedAccounts } = raw as { id?: unknown; linkedAccounts?: unknown };
  return typeof id === "string" && id.length > 0 && Array.isArray(linkedAccounts);
}

/**
 * Whether a signature request failed because the user declined it. Wallets say so with the
 * EIP-1193 code `4001` — viem's `UserRejectedRequestError` carries it, on itself or on the
 * error it wraps — and the ones that predate the code say it in prose, which is read the way
 * `bridge/walletChain` reads it. Everything else is a failure, not a refusal.
 */
function isSignatureRefusal(err: unknown): boolean {
  for (let current: unknown = err; typeof current === "object" && current !== null; ) {
    if ((current as { code?: unknown }).code === 4001) return true;
    current = (current as { cause?: unknown }).cause;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /user rejected|denied/i.test(message);
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
