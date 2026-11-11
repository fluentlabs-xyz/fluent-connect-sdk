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
 * Returns the key a cached Auth token is valid for: one subject, at one App, issued by one
 * service. The subject alone is not enough: a host that re-renders the widget with another
 * `appId` keeps the same hook instance (the `PrivyProvider` is keyed only on the network), so a
 * subject-only cache would hand back a token whose `aud` is the previous App.
 *
 * The App and service prefix is `settingsAudienceKey`: the settings controller keys a
 * generation on that prefix, and the two must not drift.
 */
export function authTokenCacheKey(params: {
  publicApiUrl: string;
  appId: string;
  subject: string;
}): string {
  return `${settingsAudienceKey(params)}|${params.subject}`;
}

/**
 * One Service session as this page sees it, keyed by `(publicApiUrl, appId, subject)`.
 *
 * Module state rather than per-widget state, because two widget instances on one page share one
 * refresh credential, and the service ends the Service session the moment one refresh token is
 * presented twice. So a key has one renewal in flight, one token every caller may serve, and
 * one generation a disconnect ends. Another tab is another page, and is not coordinated with.
 */
type AuthSession = {
  /**
   * Bumped by `endAuthSession`. Work that started under an older number writes nothing back —
   * no token, no credential, no storage — so a response that lands after a disconnect cannot
   * restore the session it belongs to.
   */
  generation: number;
  /** The Auth token every caller at this key may serve, with its raw `exp` in ms. */
  token: { value: string; expiresAt: number } | null;
  /** The refresh credential this page holds. */
  refresh: FluentRefreshCredential | null;
  /** Whether `refresh` has been read out of storage yet; `null` is an answer, not a gap. */
  loaded: boolean;
  /** The one renewal or exchange every caller at this key joins. */
  inFlight: Promise<string> | null;
  /**
   * Every `requestAuthToken` call still out at this key, and every revoke one has started, each
   * as a promise that never rejects and settles once its work with the service is done.
   *
   * A disconnect waits on a snapshot of this set, so a host's `disconnect()` does not resolve
   * while a call of the ended session could still open a Service session. A disconnect does not
   * clear it: each entry removes itself.
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

/** Drops every page-shared session; only tests call it. */
export function resetAuthTokenSessions(): void {
  sessions.clear();
}

/**
 * One widget instance's cached Auth token, and the request it is waiting on.
 *
 * Both carry the `generation` of the session they came from, not only its key: a disconnect
 * through one widget instance bumps it, and every other instance on the page then stops serving
 * the ended session's token out of its own cache.
 */
export type AuthTokenState = {
  cache: { key: string; generation: number; token: string; expiresAt: number } | null;
  inFlight: { key: string; generation: number; promise: Promise<string> } | null;
};

export type AuthTokenRequest = {
  publicApiUrl: string;
  appId: string;
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
   * Discards the cached token for this subject and App before looking, so a new one is minted.
   * For a holder whose token was refused (a paymaster `401`): it goes from this caller's state
   * and from the page-shared cache, and an instance that already took a copy keeps it until it
   * expires.
   *
   * It forces a new Auth token, not a new Service session: a usable refresh credential still
   * renews it. A request already in flight for the same key is still joined, which spares an
   * External wallet a second signature prompt.
   */
  fresh?: boolean;
};

/**
 * Asks the service to end the Service session of `refreshToken`, and never rejects.
 *
 * One revoke ends every token rotated out of the one presented, and the service answers `200`
 * even for a token it has never seen, so a second call costs only a round trip. A failure is
 * logged, not thrown: a disconnect still has to tear down, and an obtained token returned.
 */
async function revokeRefreshFamily(publicApiUrl: string, refreshToken: string): Promise<void> {
  try {
    await revokeAuthToken({ publicApiUrl, refreshToken });
  } catch (err) {
    debugWarn("[fluent widget] revoking the refresh family failed", err);
  }
}

/**
 * Reports whether a refresh failed because the deployment has no `/auth/refresh` route: a `404`
 * with no service code, which is what a route that is not deployed answers.
 * `isUnsupportedByService` in `core/userSettings` reads a settings `404` the same way, for its
 * own routes.
 *
 * The status keeps a transport failure out: it is `request_failed` too, with no status (see
 * `toAuthError` in `core/authToken`). A coded `404` such as `unknown_app` means the route is
 * there and the App is not.
 */
function isRefreshRouteMissing(err: FluentAuthError): boolean {
  return err.code === "request_failed" && err.status === 404;
}

/**
 * Returns an Auth token for the connected subject from the cheapest source: a token this state
 * holds, a token another caller on this page obtained, a request already out, a renewal with the
 * stored refresh credential, and only then a full exchange (the two Privy tokens for a Fluent
 * ID, a signed challenge for an External wallet).
 *
 * A full exchange costs an External wallet a signature prompt, so it runs only when no
 * credential is stored, its Service session has expired, the refresh is answered `401`, or the
 * deployment has no refresh route. Any other failure reaches the caller with the credential
 * kept: `403`, a coded `404`, `429` and `500` consume nothing at the service.
 */
export async function requestAuthToken(
  params: AuthTokenRequest,
  state: AuthTokenState,
  options: AuthTokenRequestOptions = {},
): Promise<string> {
  const {
    publicApiUrl,
    appId,
    renewalOffsetSeconds,
    accountType,
    privyUserId,
    getAccessToken,
    identityToken,
    walletAddress,
    walletClient,
    origin,
  } = params;
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
  /** Copies the session's token into this caller's state, unless the session has ended. */
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

  /** Publishes a new pair and returns its token; an ended session's pair is not published. */
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

  /** Drops the refresh credential from this session and from storage. */
  const forget = (): void => {
    if (session.generation !== generation) return;
    session.refresh = null;
    session.loaded = true;
    forgetRefreshCredential(storage, storageKey);
  };

  /**
   * Revokes a Service session this page is giving up on, without making the caller wait.
   *
   * Detached because a deployment with no `/auth/refresh` route may have no `/auth/revoke` route
   * either, and an obtainable token must not wait on it. It is registered in `session.pending`,
   * so a disconnect that lands meanwhile still waits for it; `revokeRefreshFamily` never rejects.
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
   * Runs a full exchange, the one path here that opens a new Service session; a rotation stays
   * inside the Service session it was handed.
   *
   * A Service session this exchange opens after a disconnect is revoked here, the only place that
   * learns its refresh token. The disconnect waits for this call, so the revoke happens before a
   * host's `disconnect()` resolves, however long the exchange takes.
   */
  const exchange = async (): Promise<string> => {
    let pair: FluentAuthTokenPair;
    if (subject.startsWith("privy:")) {
      const accessToken = await getAccessToken();
      if (!accessToken || !identityToken) {
        throw new FluentAuthError(
          "login_credential_missing",
          "The Direct-login credential is not in this page yet; sign in again.",
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
      // The session ended while this exchange was out, and nothing will present this credential,
      // so its Service session is revoked rather than left to run out. The token is still
      // returned: an issued token cannot be recalled.
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
      // The Service session's fixed expiry has passed: the service would only answer
      // `invalid_refresh_token`, so no refresh is sent.
      forget();
      return exchange();
    }
    try {
      return commit(await refreshAuthToken({ publicApiUrl, refreshToken: held.refreshToken }));
    } catch (err) {
      // Only a `401` (the credential is unknown, expired, revoked or replayed) and a bare `404`
      // (no refresh route) mean it never renews; each falls back to one exchange. Anything else
      // keeps it: a `403` refuses the exchange too, and a `429`, `5xx` or lost answer may pass.
      if (!(err instanceof FluentAuthError)) throw err;
      const routeMissing = isRefreshRouteMissing(err);
      if (err.status !== 401 && !routeMissing) throw err;
      forget();
      // A `401` has already ended the Service session; behind a bare `404` it may still be live.
      if (routeMissing) revokeAbandonedFamily(held.refreshToken);
      return exchange();
    }
  };

  const promise = renew();
  // The whole chain is registered before the first request leaves: a disconnect that lands
  // mid-refresh cannot know a fallback exchange is still coming, and must wait for it and for
  // any revoke it starts.
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
 * Ends this subject's Service session: forgets the refresh credential here and asks the service
 * to revoke it. Never rejects, so the teardown around it runs whatever the service answers.
 *
 * The local half runs before the first `await`: from then on a renewal or exchange still out
 * belongs to an ended session, and `requestAuthToken` neither holds its token nor stores its
 * credential. A Service session such an exchange opens revokes itself in `requestAuthToken`,
 * and this function waits for that work, however long it takes (an unanswered wallet dialog
 * included). The widget's teardown does not wait on it (see `handleDisconnect`); the promise a
 * host awaits from `disconnect()` does.
 */
export async function endAuthSession(params: {
  publicApiUrl: string;
  appId: string;
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
    // `sessionAt`, not a lookup: a page disconnected before anything asked for a token has no
    // session object, yet may have a stored credential and a live Service session.
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

    // The credential this page held is revoked first and unconditionally. That ends every token
    // rotated out of it, so a renewal still in flight needs no revoke of its own.
    const heldRevoked = held
      ? revokeRefreshFamily(publicApiUrl, held.refreshToken)
      : Promise.resolve();
    // Each call still out revokes any Service session it opens (see `exchange`); waiting puts
    // that revoke before `disconnect()` resolves. No deadline: one would report a completed
    // disconnect while a late exchange can still open a Service session.
    await Promise.all([heldRevoked, ...pending]);
  } catch (err) {
    debugWarn("[fluent widget] ending the auth session failed", err);
  }
}

export type UseAuthTokenResult = {
  /**
   * The Widget API's `getAuthToken()`. It takes no options: an App asks for a token, it does not
   * decide when one is stale.
   */
  getAuthToken: () => Promise<string>;
  /**
   * The same request with per-call options, for the widget's own sponsored paymaster, which
   * needs a fresh Auth token after a `401`. Not on `FluentWidgetRenderContext`.
   */
  requestSponsorshipToken: (options?: AuthTokenRequestOptions) => Promise<string>;
  /**
   * Ends the connected subject's Service session; the widget's disconnect calls it before it
   * clears the identity this session is keyed on. Never rejects.
   */
  endAuthSession: () => Promise<void>;
};

/**
 * Returns `getAuthToken()` for the render context, the widget's own `requestSponsorshipToken`,
 * and `endAuthSession`, all over `requestAuthToken` with state kept across renders.
 *
 * `state` lets the caller keep that state above the `PrivyProvider`, which a network change
 * rebuilds; the cache key carries `(publicApiUrl, appId, subject)`, so a token is served only
 * for its own session. The refresh credential is page-shared state keyed the same way.
 */
export function useAuthToken(
  params: Omit<AuthTokenRequest, "origin">,
  state?: MutableRefObject<AuthTokenState>,
): UseAuthTokenResult {
  const {
    publicApiUrl,
    appId,
    renewalOffsetSeconds,
    accountType,
    privyUserId,
    getAccessToken,
    identityToken,
    walletAddress,
    walletClient,
    storage,
  } = params;
  const ownState = useRef<AuthTokenState>({ cache: null, inFlight: null });
  const tokenState = state ?? ownState;

  const requestSponsorshipToken = useCallback(
    (options?: AuthTokenRequestOptions) =>
      requestAuthToken(
        {
          publicApiUrl,
          appId,
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
      accountType,
      privyUserId,
      walletAddress,
      storage,
    });
  }, [
    accountType,
    appId,
    privyUserId,
    publicApiUrl,
    storage,
    tokenState,
    walletAddress,
  ]);

  return { getAuthToken, requestSponsorshipToken, endAuthSession: endSession };
}
