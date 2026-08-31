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
 * `getAuthToken()` for the render context. Branches on the account the widget already
 * derived: a ready Fluent smart account exchanges the two Privy tokens; a connected external
 * wallet signs a challenge. Cached per subject until `exp - renewalOffset`; one in-flight request at
 * a time so parallel callers share a single wallet prompt.
 */
export function useAuthToken(params: {
  publicApiUrl: string;
  clientId: string;
  authMode: FluentWidgetAuthMode;
  renewalOffsetSeconds: number;
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  getAccessToken: () => Promise<string | null>;
  identityToken: string | null;
  walletAddress?: string;
  walletClient?: WalletClient;
}) {
  const {
    publicApiUrl,
    clientId,
    authMode,
    renewalOffsetSeconds,
    accountType,
    privyUserId,
    getAccessToken,
    identityToken,
    walletAddress,
    walletClient,
  } = params;
  // Keyed by subject: disconnect or a different login changes the key, which is the whole
  // invalidation story — no listener on the disconnect path.
  const cache = useRef<{ subject: string; token: string; expiresAt: number } | null>(null);
  const inFlight = useRef<{ subject: string; promise: Promise<string> } | null>(null);

  return useCallback(async (): Promise<string> => {
    if (authMode === "hosted") {
      throw new FluentAuthError(
        "hosted_not_supported",
        'getAuthToken() needs authMode: "direct" — the hosted bridge does not hand over the Privy access token.',
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

    const cached = cache.current;
    if (cached?.subject === subject && cached.expiresAt - renewalOffsetSeconds * 1000 > Date.now()) {
      return cached.token;
    }
    if (inFlight.current?.subject === subject) return inFlight.current.promise;

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
        token = await exchangePrivyAuthToken({ publicApiUrl, clientId, accessToken, identityToken });
      } else {
        if (!walletClient) {
          throw new FluentAuthError("not_connected", "External wallet has no signer.");
        }
        token = await exchangeWalletAuthToken({
          publicApiUrl,
          clientId,
          walletClient,
          address: walletAddress as `0x${string}`,
          origin: window.location.origin,
        });
      }
      const expiresAt = readAuthTokenExpiry(token);
      if (expiresAt) cache.current = { subject, token, expiresAt };
      return token;
    })();

    inFlight.current = { subject, promise };
    try {
      return await promise;
    } finally {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    }
  }, [
    accountType,
    authMode,
    renewalOffsetSeconds,
    clientId,
    getAccessToken,
    identityToken,
    privyUserId,
    publicApiUrl,
    walletAddress,
    walletClient,
  ]);
}
