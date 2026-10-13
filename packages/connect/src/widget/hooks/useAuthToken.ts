import { type MutableRefObject, useCallback, useRef } from "react";
import type { StorageLike } from "@fluent.xyz/connect-sdk";
import type { WalletClient } from "viem";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  type FluentAuthTokenPair,
  type FluentRefreshCredential,
  readAuthTokenExpiry,
  refreshAuthToken,
  revokeAuthToken,
} from "../../core/authToken";
import type { FluentWidgetAuthMode } from "../../core/config";
import { debugWarn } from "../../core/debugLogger";
import {
  forgetRefreshCredential,
  isRefreshCredentialUsable,
  loadRefreshCredential,
  refreshCredentialStorageKey,
  resolveRefreshCredentialStorage,
  saveRefreshCredential,
} from "../../core/refreshCredentialStore";
import { resolveSettingsSubject, settingsAudienceKey } from "../../core/userSettings";
import type { FluentAccountType } from "../batchOperation";

/**
 * What a cached token is valid for: one user, at one App, issued by one service. The
 * subject alone is not enough — a host that re-renders the widget with a different
 * `appId` keeps the same hook instance (the `PrivyProvider` key carries no App), so a
 * subject-only cache would hand back a token whose `aud` is the previous App.
 *
 * The App and the service are `settingsAudienceKey`, which this key is built from: the
 * settings controller keys a generation on that prefix, and the two must not drift.
 */
export function authTokenCacheKey(params: {
  publicApiUrl: string;
  appId: string;
  subject: string;
}): string {
  return `${settingsAudienceKey(params)}|${params.subject}`;
}

/**
 * One persisted session, as this page sees it: `(publicApiUrl, appId, subject)`.
 *
 * It is module state rather than per-widget state because the refresh credential is *shared*.
 * Two widget instances on one page, or the widget and a settings read that survived a
 * `PrivyProvider` remount, hold one credential between them, and the service ends a family the
 * moment one refresh token is presented twice — so two callers renewing "their own" copy would
 * sign the person out. Everything here exists to make that impossible: one renewal in flight,
 * one token every caller may serve, one generation that a disconnect ends.
 *
 * Cross-tab coordination is deliberately *not* here: another tab is another page, and this
 * Issue does not take it on.
 */
type AuthSession = {
  /**
   * Bumped by `endAuthSession`. Work that started under an older number writes nothing back —
   * no token, no credential, no storage — so a response that lands after a disconnect cannot
   * restore the session it belongs to.
   */
  generation: number;
  /** The access token every caller at this key may serve, with its raw `exp` in ms. */
  token: { value: string; expiresAt: number } | null;
  /** The refresh credential this page holds. */
  refresh: FluentRefreshCredential | null;
  /** Whether `refresh` has been read out of storage yet; `null` is an answer, not a gap. */
  loaded: boolean;
  /** The one renewal or exchange every caller at this key joins. */
  inFlight: Promise<string> | null;
  /**
   * Every `requestAuthToken` call still out at this key, as a promise that never rejects and
   * settles only once the call has finished with the service — the one exchange a refusal falls
   * back to, the revoke of a family opened after a disconnect, and the revoke of a family a
   * missing refresh route made this page abandon, all included.
   *
   * A disconnect waits on a snapshot of this set, to the end, so a host's `disconnect()` never
   * resolves while a call of the session it ended could still be holding a live family open. It
   * is not cleared by a disconnect: the entries remove themselves, and clearing it would drop
   * exactly the work the disconnect has to wait on.
   */
  pending: Set<Promise<void>>;
};

const sessions = new Map<string, AuthSession>();

function sessionAt(key: string): AuthSession {
  const existing = sessions.get(key);
  if (existing) return existing;
  const created: AuthSession = {
    generation: 0,
    token: null,
    refresh: null,
    loaded: false,
    inFlight: null,
    pending: new Set(),
  };
  sessions.set(key, created);
  return created;
}

/** Drops every page-shared session. For tests: nothing in the widget's own life needs it. */
export function resetAuthTokenSessions(): void {
  sessions.clear();
}

/**
 * A token the widget already holds, and the one request it is waiting on.
 *
 * Both carry the `generation` of the session they came from, not only its key. A disconnect
 * bumps that generation, and there is more than one of these states on a page — two widget
 * instances, or one that kept its state above a remounted `PrivyProvider`. Without the
 * generation, disconnecting through one of them would leave the others serving the ended
 * session's token out of their own cache, which no amount of shared invalidation could reach.
 */
export type AuthTokenState = {
  cache: { key: string; generation: number; token: string; expiresAt: number } | null;
  inFlight: { key: string; generation: number; promise: Promise<string> } | null;
};

export type AuthTokenRequest = {
  publicApiUrl: string;
  appId: string;
  authMode: FluentWidgetAuthMode;
  renewalOffsetSeconds: number;
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  getAccessToken: () => Promise<string | null>;
  identityToken: string | null;
  walletAddress?: string;
  walletClient?: WalletClient;
  /** The page origin the wallet challenge is bound to. */
  origin: string;
  /** Where the refresh credential is kept. Defaults to `localStorage`; `null` disables it. */
  storage?: StorageLike | null;
};

/** Per-call options, as opposed to the request's standing description. */
export type AuthTokenRequestOptions = {
  /**
   * Discard the cached token for this subject and App before looking, so a new one is minted.
   * Used when a holder of the token was told it is no longer accepted — a paymaster `401` —
   * and serving the same bytes back would spend another rejected round trip on them. They go
   * from this caller's own state and from the page-shared cache both, so nothing is *handed*
   * bytes the service has already refused; an instance that had already taken a copy keeps it
   * until it expires, which is the same five minutes it always was.
   *
   * It forces a new *access* token, not a new session: an available refresh credential still
   * renews it, silently. An in-flight request for the same key is still shared — it was started
   * after the rejection, so its token is as fresh as a new one, and joining it costs an external
   * wallet no second signature prompt.
   */
  fresh?: boolean;
};

/**
 * Ask the service to end a refresh family, and never fail for it.
 *
 * One revoke covers the whole family — every token rotated out of the one presented — and the
 * service answers `200` even for a token it has never seen, so calling it twice costs a round
 * trip and nothing else. A service that cannot be reached must not stop the caller: a disconnect
 * still has to tear down, and a token already obtained still has to be returned.
 */
async function revokeRefreshFamily(publicApiUrl: string, refreshToken: string): Promise<void> {
  try {
    await revokeAuthToken({ publicApiUrl, refreshToken });
  } catch (err) {
    debugWarn("[fluent widget] revoking the refresh family failed", err);
  }
}

/**
 * The deployment this widget points at has no `/auth/refresh` route: a `404` with no service
 * code behind it, which is what a route that was never deployed answers (production stays on
 * the `main` branch until a feature ships). `isUnsupportedByService` in `core/userSettings`
 * reads a settings `404` the same way and on purpose — the two recognise the same kind of
 * service, each for its own routes, and neither imports the other.
 *
 * The status is what keeps a transport failure out: it is `request_failed` too, and carries no
 * status at all (see `toAuthError` in `core/authToken`). A `404` the service did put a code on,
 * `unknown_app`, is the opposite case — the route is there and the App is not.
 */
function isRefreshRouteMissing(err: FluentAuthError): boolean {
  return err.code === "request_failed" && err.status === 404;
}

/**
 * One `getAuthToken()` call, in the order the cheapest answer comes first: a token already held,
 * a token another caller on this page just obtained, a renewal that is already out, a silent
 * renewal with the stored refresh credential, and only then a full exchange — the two Privy
 * tokens for a Fluent ID, a signed challenge for an external wallet.
 *
 * A full exchange is what this Issue exists to avoid: for an external wallet it is a signature
 * prompt, every five minutes, for as long as the App keeps asking. It is reached in exactly
 * four cases — no stored credential, a credential whose family has expired, a refresh the
 * service answered `401` to, and a refresh the deployment has no route for at all. Every other
 * refusal is passed to the caller with the credential left alone: `403`, a coded `404`, `429`
 * and `500` consume nothing at the service, and a session that is still good must not be thrown
 * away because the service was busy or misconfigured.
 */
export async function requestAuthToken(
  params: AuthTokenRequest,
  state: AuthTokenState,
  options: AuthTokenRequestOptions = {},
): Promise<string> {
  const {
    publicApiUrl,
    appId,
    authMode,
    renewalOffsetSeconds,
    accountType,
    privyUserId,
    getAccessToken,
    identityToken,
    walletAddress,
    walletClient,
    origin,
  } = params;
  // First, ahead of the subject and the cache: a hosted Fluent ID must never fall through to
  // `not_connected` for want of an in-page Privy user, nor get a token cached in direct mode.
  if (authMode === "hosted" && accountType === "smart") {
    throw new FluentAuthError(
      "hosted_not_supported",
      'getAuthToken() for a Fluent ID needs authMode: "direct" — in hosted mode its Privy session lives on the authorize page, not in this page.',
    );
  }
  const subject =
    accountType === "smart" && privyUserId
      ? `privy:${privyUserId}`
      : accountType === "eoa" && walletAddress
        ? `wallet:${walletAddress.toLowerCase()}`
        : null;
  if (!subject) {
    throw new FluentAuthError("not_connected", "Connect a Fluent ID or an external wallet first.");
  }

  const key = authTokenCacheKey({ publicApiUrl, appId, subject });
  const session = sessionAt(key);
  const storage = resolveRefreshCredentialStorage(params.storage);
  const storageKey = refreshCredentialStorageKey(key);
  // Read once, here: everything below compares against the session this call belongs to, and a
  // disconnect that lands meanwhile makes every one of those comparisons fail.
  const generation = session.generation;

  const usable = (expiresAt: number) => expiresAt - renewalOffsetSeconds * 1000 > Date.now();
  /** Take whatever the session holds now into this caller's own state. */
  const adopt = (): void => {
    const held = session.token;
    if (session.generation !== generation || !held) return;
    state.cache = { key, generation, token: held.value, expiresAt: held.expiresAt };
  };

  if (options.fresh) {
    if (state.cache?.key === key) state.cache = null;
    session.token = null;
  }

  const cached = state.cache;
  // The generation, not only the key: a disconnect through another widget instance has ended
  // this session, and this state's own copy of its token must not outlive it.
  if (cached?.key === key && cached.generation === generation && usable(cached.expiresAt)) {
    return cached.token;
  }
  // Somebody else on this page has a token for this very session. Taking it costs nothing, and
  // is what keeps a second widget instance from paying for a token that already exists.
  const shared = session.token;
  if (shared && usable(shared.expiresAt)) {
    state.cache = { key, generation, token: shared.value, expiresAt: shared.expiresAt };
    return shared.value;
  }
  if (state.inFlight?.key === key && state.inFlight.generation === generation) {
    const token = await state.inFlight.promise;
    adopt();
    return token;
  }
  if (session.inFlight) {
    const token = await session.inFlight;
    adopt();
    return token;
  }

  /** Publish a new pair, unless the session it belongs to ended while it was out. */
  const commit = (pair: FluentAuthTokenPair): string => {
    const expiresAt = readAuthTokenExpiry(pair.token);
    if (session.generation !== generation) return pair.token;
    if (expiresAt) {
      session.token = { value: pair.token, expiresAt };
      state.cache = { key, generation, token: pair.token, expiresAt };
    }
    session.refresh = pair.refresh;
    session.loaded = true;
    // Best effort by design: a browser that will not keep the credential costs the next page
    // load one exchange. It must never cost this caller the token it just obtained.
    if (pair.refresh) saveRefreshCredential(storage, storageKey, pair.refresh);
    else forgetRefreshCredential(storage, storageKey);
    return pair.token;
  };

  /** This credential is over. Stop presenting it here, and stop keeping it for next time. */
  const forget = (): void => {
    if (session.generation !== generation) return;
    session.refresh = null;
    session.loaded = true;
    forgetRefreshCredential(storage, storageKey);
  };

  /**
   * End a family this page is giving up on, and do not make the caller wait for the round trip.
   *
   * Detached on purpose: a deployment that has no `/auth/refresh` route is as likely to have no
   * `/auth/revoke` route either, and a token that is already obtainable must not wait on a
   * request to a route that is not there. It is registered in `session.pending` all the same, so
   * a disconnect that lands meanwhile still waits for it — the family can be alive at the
   * service until this call returns, and a host told its session is over must not find one
   * behind it. That both halves are safe is `revokeRefreshFamily`'s doing: it never rejects.
   */
  const revokeAbandonedFamily = (refreshToken: string): void => {
    // A disconnect that got here first has already revoked what this page held, unconditionally
    // and with a wait of its own, so there is nothing left for this to do.
    if (session.generation !== generation) return;
    const revoking = revokeRefreshFamily(publicApiUrl, refreshToken);
    session.pending.add(revoking);
    void revoking.then(() => session.pending.delete(revoking));
  };

  /**
   * A full exchange, which is the one thing here that opens a *new* refresh family — a rotation
   * stays inside the family it was handed, and revoking that token ends the successor too.
   *
   * Ending a family this call opened after a disconnect belongs here, not to the disconnect: this
   * is the only place that ever learns the new refresh token. The disconnect's part is to wait —
   * it holds a snapshot of the calls still out and does not report back until each of them has
   * reached this line, so the revoke below happens *before* a host's `disconnect()` resolves,
   * however long the exchange takes.
   */
  const exchange = async (): Promise<string> => {
    let pair: FluentAuthTokenPair;
    if (subject.startsWith("privy:")) {
      const accessToken = await getAccessToken();
      if (!accessToken || !identityToken) {
        throw new FluentAuthError(
          "privy_token_missing",
          "Privy session is not ready; sign in again.",
        );
      }
      pair = await exchangePrivyAuthToken({ publicApiUrl, appId, accessToken, identityToken });
    } else {
      if (!walletClient) {
        throw new FluentAuthError("not_connected", "External wallet has no signer.");
      }
      pair = await exchangeWalletAuthToken({
        publicApiUrl,
        appId,
        walletClient,
        address: walletAddress as `0x${string}`,
        origin,
      });
    }
    if (pair.refresh && session.generation !== generation) {
      // The session ended while this exchange was out. Its family is alive at the service and no
      // reload will ever present it again, so it has to be revoked rather than left to run out
      // its thirty days. The token is still returned to the caller that asked: nothing can recall
      // bytes already issued, and the five minutes it verifies for are the ones it always had.
      await revokeRefreshFamily(publicApiUrl, pair.refresh.refreshToken);
    }
    return commit(pair);
  };

  const renew = async (): Promise<string> => {
    if (!session.loaded) {
      session.refresh = loadRefreshCredential(storage, storageKey);
      session.loaded = true;
    }
    const held = session.refresh;
    if (!held) return exchange();
    if (!isRefreshCredentialUsable(held)) {
      // The family's fixed expiry has passed — thirty days by default, and a rotation never
      // moved it. The service would only answer `invalid_refresh_token`, so it costs no
      // request at all to know that this session needs a new exchange.
      forget();
      return exchange();
    }
    try {
      return commit(await refreshAuthToken({ publicApiUrl, refreshToken: held.refreshToken }));
    } catch (err) {
      // Two answers, and only these two, say this credential will never renew again. Either is
      // followed by one full exchange, and exactly one — nothing here retries a refresh, because
      // the service counts renewals per App and subject and a loop would spend the person's
      // whole window.
      //
      // A `401` says the credential itself is over: unknown, expired or revoked
      // (`invalid_refresh_token`), or a replay that has just ended the family
      // (`refresh_token_reused`). Its family is already dead at the service, so there is nothing
      // left to revoke.
      //
      // A bare `404` says the deployment has no `/auth/refresh` route at all. The credential is
      // not refused, it is unrenewable: every call would answer the same `404` for as long as
      // that service is deployed, and with no fallback `getAuthToken()` would reject until a
      // `disconnect()` or the family's own thirty-day expiry, taking sponsorship and settings
      // with it. The family may well still be alive at the service and this page will never
      // present it again, so it is revoked, best-effort and without delaying the exchange.
      //
      // A `403` is not one of the two, for all that it will not come right on its own either: a
      // service answering `origin_not_allowed` or `app_not_auth_enabled` refuses the exchange
      // too, so falling back would spend an external wallet's signature prompt to learn what the
      // refusal already said, and throw away a session that is still good at every service that
      // is configured for this App. Nor is a coded `404` such as `unknown_app` — that route is
      // there — nor another `4xx`, a `429`, a `5xx`, or a transport failure, which is
      // `request_failed` with no status at all.
      if (!(err instanceof FluentAuthError)) throw err;
      const routeMissing = isRefreshRouteMissing(err);
      if (err.status !== 401 && !routeMissing) throw err;
      forget();
      if (routeMissing) revokeAbandonedFamily(held.refreshToken);
      return exchange();
    }
  };

  const promise = renew();
  // What a disconnect from here on has to wait for, registered before the first request leaves:
  // this whole chain, including the one exchange a refusal falls back to and the revoke of any
  // family that exchange opens. Registering the chain rather than each exchange is what covers
  // the fallback — a disconnect that lands mid-refresh cannot know an exchange is still coming.
  const pending = promise.then(
    () => {},
    () => {},
  );
  session.pending.add(pending);
  state.inFlight = { key, generation, promise };
  session.inFlight = promise;
  try {
    return await promise;
  } finally {
    session.pending.delete(pending);
    if (state.inFlight?.promise === promise) state.inFlight = null;
    if (session.inFlight === promise) session.inFlight = null;
  }
}

/**
 * End this subject's session: forget the credential here, and ask the service to revoke its
 * family so nothing renews with it again.
 *
 * The local half is synchronous and happens before the first `await`, which is what makes a
 * disconnect safe against its own races: from that moment a renewal or an exchange still out
 * belongs to a session that is over, and `requestAuthToken` will neither hold its token nor
 * store its credential.
 *
 * One revoke ends a whole family, the successor of a rotation included, so the credential this
 * page held covers every token descended from it — a rotation in flight needs no revoke of its
 * own. What it does not cover is a family an exchange is about to open: a first sign-in, or the
 * one full exchange a `401` or a missing refresh route falls back to. Those revoke themselves,
 * in `requestAuthToken`, which is where their new token first becomes known; this function waits
 * for that work to the end, so that a caller told the session is over cannot then find a live
 * family behind it.
 *
 * That wait is as long as the work takes — a wallet dialog nobody answers included. It is not
 * what tears the widget down: the identity, session and wallet teardown runs ahead of this
 * promise (see `handleDisconnect`), and only the promise a host awaits from `disconnect()` covers
 * the revokes. What no client can end either way is a family whose response never arrives — a
 * lost reply, a page closed before it lands.
 *
 * It never rejects. A service that cannot be reached must not leave the person signed in, and
 * the identity, session and wallet teardown around this call has to run either way.
 */
export async function endAuthSession(params: {
  publicApiUrl: string;
  appId: string;
  authMode: FluentWidgetAuthMode;
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  walletAddress?: string;
  storage?: StorageLike | null;
}): Promise<void> {
  try {
    const { publicApiUrl, appId } = params;
    // The same rule `requestAuthToken` derives its subject by: no subject, no session to end.
    const subject = resolveSettingsSubject(params);
    if (!subject) return;
    const key = authTokenCacheKey({ publicApiUrl, appId, subject });
    // `sessionAt`, not a lookup: a page that reloaded and was disconnected before anything asked
    // for a token has no session object at all, and still has a stored credential and a live
    // family at the service.
    const session = sessionAt(key);
    const storage = resolveRefreshCredentialStorage(params.storage);
    const storageKey = refreshCredentialStorageKey(key);

    session.generation += 1;
    const held = session.loaded ? session.refresh : loadRefreshCredential(storage, storageKey);
    // Snapshotted, not cleared: each entry removes itself when it is done, and a call that starts
    // after this line belongs to a session this disconnect is not ending.
    const pending = [...session.pending];
    session.token = null;
    session.refresh = null;
    session.loaded = true;
    session.inFlight = null;
    // A removal the browser refuses leaves bytes on disk that this SDK cannot erase. That is
    // exactly why the revoke below is not optional: what cannot be deleted is made useless.
    forgetRefreshCredential(storage, storageKey);

    // The family this page held goes first and unconditionally. One revoke ends it and every
    // token rotated out of it, so a renewal still in flight needs no revoke of its own.
    const heldRevoked = held
      ? revokeRefreshFamily(publicApiUrl, held.refreshToken)
      : Promise.resolve();
    // Then the work still out, to the end of it. Each such call revokes any family it opened
    // itself (see `exchange`), and this wait is what puts that revoke before the disconnect
    // reports back: a response that lands late is observable — the caller that asked for the
    // token receives it — so a family opened after this point is a live session behind a
    // disconnect the host has already been told about. No deadline here, because a deadline
    // would report a completed disconnect while exactly that can still happen.
    await Promise.all([heldRevoked, ...pending]);
  } catch (err) {
    debugWarn("[fluent widget] ending the auth session failed", err);
  }
}

export type UseAuthTokenResult = {
  /**
   * The widget API's `getAuthToken()`. Its signature is public and does not change: an App
   * asks for a token, it does not decide when one is stale.
   */
  getAuthToken: () => Promise<string>;
  /**
   * The same request, internal to the widget, with the forced access token the sponsored
   * paymaster needs after a `401`. Not on `FluentWidgetRenderContext`.
   */
  requestSponsorshipToken: (options?: AuthTokenRequestOptions) => Promise<string>;
  /**
   * Teardown for the connected subject, to be called by the widget's disconnect before it
   * clears the identity this session is keyed on. Never rejects.
   */
  endAuthSession: () => Promise<void>;
};

/**
 * `getAuthToken()` for the render context: `requestAuthToken` over state kept
 * across renders. The App's `getAuthToken()` takes no arguments; the widget's own
 * `requestSponsorshipToken` carries the per-call options.
 *
 * `state` lets a caller keep that state somewhere this hook's own `useRef`
 * cannot reach — above the `PrivyProvider`, which toggling Quick sign remounts.
 * Without it the widget would drop a token it had just obtained, and pay for
 * another exchange (and, for an external wallet, another signature prompt) the
 * next time anything asked. The cache key still carries `(publicApiUrl, appId,
 * subject)`, so nothing survives that should not.
 *
 * The refresh credential lives a level above even that, in page-shared state keyed the same
 * way: it is one secret per session, and two holders of it would end the session between them.
 */
export function useAuthToken(
  params: Omit<AuthTokenRequest, "origin">,
  state?: MutableRefObject<AuthTokenState>,
): UseAuthTokenResult {
  const {
    publicApiUrl,
    appId,
    authMode,
    renewalOffsetSeconds,
    accountType,
    privyUserId,
    getAccessToken,
    identityToken,
    walletAddress,
    walletClient,
    storage,
  } = params;
  // Keyed by subject *and* audience: disconnect or a different login changes the key, which is
  // most of the invalidation story. What a key change cannot do is end the session at the
  // service, so disconnect calls `endAuthSession` below as well.
  const ownState = useRef<AuthTokenState>({ cache: null, inFlight: null });
  const tokenState = state ?? ownState;

  const requestSponsorshipToken = useCallback(
    (options?: AuthTokenRequestOptions) =>
      requestAuthToken(
        {
          publicApiUrl,
          appId,
          authMode,
          renewalOffsetSeconds,
          accountType,
          privyUserId,
          getAccessToken,
          identityToken,
          walletAddress,
          walletClient,
          origin: window.location.origin,
          storage,
        },
        tokenState.current,
        options,
      ),
    [
      accountType,
      authMode,
      renewalOffsetSeconds,
      appId,
      getAccessToken,
      identityToken,
      privyUserId,
      publicApiUrl,
      storage,
      tokenState,
      walletAddress,
      walletClient,
    ],
  );

  // Takes no arguments on purpose: the App's `getAuthToken()` must not grow a refresh knob.
  const getAuthToken = useCallback(
    () => requestSponsorshipToken(),
    [requestSponsorshipToken],
  );

  const endSession = useCallback(async () => {
    // This widget's own view of the session goes first and synchronously, for the same reason
    // the shared generation is bumped synchronously: nothing may serve a token of a session
    // the user has just ended.
    tokenState.current.cache = null;
    tokenState.current.inFlight = null;
    await endAuthSession({
      publicApiUrl,
      appId,
      authMode,
      accountType,
      privyUserId,
      walletAddress,
      storage,
    });
  }, [
    accountType,
    appId,
    authMode,
    privyUserId,
    publicApiUrl,
    storage,
    tokenState,
    walletAddress,
  ]);

  return { getAuthToken, requestSponsorshipToken, endAuthSession: endSession };
}
