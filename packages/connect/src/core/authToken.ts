import type { WalletClient } from "viem";

import { HttpError, postJson } from "../utils/postJson";

export type FluentAuthErrorCode =
  // fluent-connect-service codes (fluentauth/errors.go)
  | "unknown_app"
  | "app_not_auth_enabled"
  | "origin_not_allowed"
  | "origin_missing"
  | "bad_request"
  | "nonce_unknown"
  | "nonce_used"
  | "nonce_expired"
  | "app_mismatch"
  | "invalid_signature"
  | "signature_prefix_rejected"
  | "address_already_linked"
  | "invalid_privy_token"
  | "no_embedded_wallet"
  | "invalid_refresh_token"
  | "refresh_token_reused"
  | "rate_limited"
  | "internal"
  // client-side
  | "hosted_not_supported"
  | "not_connected"
  | "root_signer_required"
  | "privy_token_missing"
  | "origin_mismatch"
  | "request_failed";

export class FluentAuthError extends Error {
  constructor(
    readonly code: FluentAuthErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FluentAuthError";
  }
}

/** Retried once with a fresh challenge: the service burns the nonce before checking the signature. */
const RETRY_ONCE = new Set<FluentAuthErrorCode>([
  "signature_prefix_rejected",
  "nonce_expired",
  "nonce_used",
]);

function toAuthError(err: unknown): FluentAuthError {
  if (err instanceof FluentAuthError) return err;
  if (err instanceof HttpError) {
    const code = (err.body?.code ?? "request_failed") as FluentAuthErrorCode;
    return new FluentAuthError(code, err.message, err.status);
  }
  return new FluentAuthError("request_failed", err instanceof Error ? err.message : String(err));
}

/**
 * The long-lived half of a session: an opaque secret with no structure, and the moment the
 * **Refresh family** it belongs to dies.
 *
 * `refreshExpiresAt` is Unix **seconds**, the clock the Fluent token's `exp` already speaks,
 * and it is fixed at the exchange that opened the family — thirty days by default. A rotation
 * hands out a new secret under the same deadline and never moves it, so the SDK stores exactly
 * what the service answered and never extends it locally.
 */
export type FluentRefreshCredential = {
  refreshToken: string;
  refreshExpiresAt: number;
};

/**
 * What an exchange and a renewal both answer: the short-lived Fluent token, and the credential
 * that renews it without asking the user again.
 *
 * `refresh` is `null` when the service answered without a usable refresh half — an older
 * deployment, or a body whose fields are not the shape the contract gives. The Fluent token is
 * still returned and still usable; the session simply has nothing to renew with, and the next
 * token costs another exchange.
 */
export type FluentAuthTokenPair = {
  token: string;
  refresh: FluentRefreshCredential | null;
};

/**
 * The refresh half of a service answer, or of a record read back out of storage — the two carry
 * the same two fields, and neither is trusted to have them. Anything but a non-empty string and
 * a finite number is no credential at all.
 */
export function readRefreshCredential(raw: unknown): FluentRefreshCredential | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { refreshToken, refreshExpiresAt } = raw as {
    refreshToken?: unknown;
    refreshExpiresAt?: unknown;
  };
  if (typeof refreshToken !== "string" || refreshToken.length === 0) return null;
  if (typeof refreshExpiresAt !== "number" || !Number.isFinite(refreshExpiresAt)) return null;
  return { refreshToken, refreshExpiresAt };
}

function readTokenPair(raw: unknown): FluentAuthTokenPair {
  const token = (raw as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new FluentAuthError("request_failed", "The auth response carried no Fluent token.");
  }
  return { token, refresh: readRefreshCredential(raw) };
}

export async function exchangePrivyAuthToken(params: {
  publicApiUrl: string;
  appId: string;
  accessToken: string;
  identityToken: string;
}): Promise<FluentAuthTokenPair> {
  try {
    return readTokenPair(
      await postJson<unknown>(`${params.publicApiUrl}/auth/exchange/privy`, {
        appId: params.appId,
        accessToken: params.accessToken,
        identityToken: params.identityToken,
      }),
    );
  } catch (err) {
    throw toAuthError(err);
  }
}

type Challenge = {
  nonce: string;
  typedData: {
    domain: { name: string; version: string; chainId: number };
    primaryType: "FluentLogin";
    types: Record<string, Array<{ name: string; type: string }>>;
    message: Record<string, string | number> & { origin: string };
  };
};

export async function exchangeWalletAuthToken(params: {
  publicApiUrl: string;
  appId: string;
  address: `0x${string}`;
  walletClient: WalletClient;
  /** `window.location.origin`; the challenge must have been minted for this page. */
  origin: string;
}): Promise<FluentAuthTokenPair> {
  const attempt = async (): Promise<FluentAuthTokenPair> => {
    const challenge = await postJson<Challenge>(`${params.publicApiUrl}/auth/challenge`, {
      appId: params.appId,
      address: params.address,
    });
    // Checked before the wallet opens: a mismatch is a proxied or spoofed challenge, and the
    // user must not be asked to sign it.
    if (challenge.typedData.message.origin !== params.origin) {
      throw new FluentAuthError(
        "origin_mismatch",
        `Challenge origin ${challenge.typedData.message.origin} does not match ${params.origin}`,
      );
    }
    // Signed verbatim — the service hashes what it stored, so any client-side edit fails.
    const signature = await params.walletClient.signTypedData({
      account: params.address,
      ...challenge.typedData,
    });
    return readTokenPair(
      await postJson<unknown>(`${params.publicApiUrl}/auth/exchange/wallet`, {
        appId: params.appId,
        nonce: challenge.nonce,
        signature,
      }),
    );
  };

  try {
    return await attempt();
  } catch (first) {
    const err = toAuthError(first);
    if (!RETRY_ONCE.has(err.code)) throw err;
    try {
      return await attempt();
    } catch (second) {
      throw toAuthError(second);
    }
  }
}

/**
 * Spend one refresh token for a new pair, with no user interaction at all — no Privy round
 * trip, no wallet prompt.
 *
 * The presented token is consumed: presenting it twice is `401 refresh_token_reused` and ends
 * the whole family, which is why exactly one renewal per family may ever be in flight.
 * Explicit service refusals `403 origin_not_allowed`, `429 rate_limited`, and a service `500`
 * leave the credential unspent. A transport failure is ambiguous: rotation may already have
 * committed before the response was lost. Keep the stored credential, but propagate the
 * error without automatic retry or exchange; its continued usability is not guaranteed.
 *
 * `Origin` is not passed: a browser sets that header itself, and the SDK never forges it.
 */
export async function refreshAuthToken(params: {
  publicApiUrl: string;
  refreshToken: string;
}): Promise<FluentAuthTokenPair> {
  try {
    return readTokenPair(
      await postJson<unknown>(`${params.publicApiUrl}/auth/refresh`, {
        refreshToken: params.refreshToken,
      }),
    );
  } catch (err) {
    throw toAuthError(err);
  }
}

/**
 * End the refresh family the given token belongs to, so nothing of that session renews again.
 *
 * Idempotent by contract (RFC 7009 §2.2): an unknown, spent or already revoked credential
 * answers `200` just like a live one, so the route is no oracle for which credentials exist and
 * a caller never has to ask whether it is too late. Fluent tokens already minted are *not*
 * revoked — they keep verifying until `exp`, within five minutes.
 */
export async function revokeAuthToken(params: {
  publicApiUrl: string;
  refreshToken: string;
}): Promise<void> {
  try {
    await postJson<unknown>(`${params.publicApiUrl}/auth/revoke`, {
      refreshToken: params.refreshToken,
    });
  } catch (err) {
    throw toAuthError(err);
  }
}

/** `exp` in ms, or `undefined` when the token does not parse. Unverified: the SDK only schedules by it. */
export function readAuthTokenExpiry(token: string): number | undefined {
  try {
    const [, body = ""] = token.split(".");
    const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
