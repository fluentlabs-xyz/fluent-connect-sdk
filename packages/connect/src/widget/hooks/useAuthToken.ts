import { useCallback, useRef } from "react";
import type { WalletClient } from "viem";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  readAuthTokenExpiry,
} from "../../core/authToken";
import type { FluentWidgetAuthMode } from "../../core/config";
import type { FluentAccountType } from "../batchOperation";

/**
 * What a cached token is valid for: one user, at one App, issued by one service. The
 * subject alone is not enough — a host that re-renders the widget with a different
 * `appId` keeps the same hook instance (the `PrivyProvider` key carries no App), so a
 * subject-only cache would hand back a token whose `aud` is the previous App.
 */
export function authTokenCacheKey(params: {
  publicApiUrl: string;
  appId: string;
  subject: string;
}): string {
  return `${params.publicApiUrl}|${params.appId}|${params.subject}`;
}

/** A token the widget already holds, and the one request it is waiting on. */
export type AuthTokenState = {
  cache: { key: string; token: string; expiresAt: number } | null;
  inFlight: { key: string; promise: Promise<string> } | null;
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
};

/**
 * One `getAuthToken()` call. Branches on the account the widget already derived: a ready
 * Fluent smart account exchanges the two Privy tokens; a connected external wallet signs a
 * challenge, in either auth mode. Cached per subject until `exp - renewalOffset`; one in-flight
 * request at a time so parallel callers share a single wallet prompt.
 */
export async function requestAuthToken(
  params: AuthTokenRequest,
  state: AuthTokenState,
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
  const cached = state.cache;
  if (cached?.key === key && cached.expiresAt - renewalOffsetSeconds * 1000 > Date.now()) {
    return cached.token;
  }
  if (state.inFlight?.key === key) return state.inFlight.promise;

  const promise = (async () => {
    let token: string;
    if (subject.startsWith("privy:")) {
      const accessToken = await getAccessToken();
      if (!accessToken || !identityToken) {
        throw new FluentAuthError(
          "privy_token_missing",
          "Privy session is not ready; sign in again.",
        );
      }
      token = await exchangePrivyAuthToken({ publicApiUrl, appId, accessToken, identityToken });
    } else {
      if (!walletClient) {
        throw new FluentAuthError("not_connected", "External wallet has no signer.");
      }
      token = await exchangeWalletAuthToken({
        publicApiUrl,
        appId,
        walletClient,
        address: walletAddress as `0x${string}`,
        origin,
      });
    }
    const expiresAt = readAuthTokenExpiry(token);
    if (expiresAt) state.cache = { key, token, expiresAt };
    return token;
  })();

  state.inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (state.inFlight?.promise === promise) state.inFlight = null;
  }
}

/** `getAuthToken()` for the render context: `requestAuthToken` over state kept across renders. */
export function useAuthToken(params: Omit<AuthTokenRequest, "origin">) {
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
  } = params;
  // Keyed by subject *and* audience: disconnect or a different login changes the key, which is
  // the whole invalidation story — no listener on the disconnect path.
  const state = useRef<AuthTokenState>({ cache: null, inFlight: null });

  return useCallback(
    () =>
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
        },
        state.current,
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
      walletAddress,
      walletClient,
    ],
  );
}
