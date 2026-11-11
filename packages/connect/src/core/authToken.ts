import type { WalletClient } from "viem";

import { HttpError, postJson } from "../utils/postJson";

/**
 * The reason `getAuthToken()`, `linkX()`, `widget.signMessage()` or `widget.signTypedData()`
 * was refused; the two signing calls throw only `not_connected` and `root_signer_required`.
 * The codes are the SDK's own, named for the product rather than for a vendor or a mechanism:
 * the SDK maps a service's code to one of them before it reaches the App, and a service code
 * the SDK does not name reaches `getAuthToken()` as `service_refused` and `linkX()` as
 * `link_failed`. Keep a `default` branch in a `switch` over them: a later release may add one.
 */
export type FluentAuthErrorCode =
  // the service's codes, as the SDK names them
  | "unknown_app"
  | "app_not_auth_enabled"
  | "origin_not_allowed"
  | "origin_missing"
  | "bad_request"
  | "challenge_unknown"
  | "challenge_used"
  | "challenge_expired"
  | "app_mismatch"
  | "invalid_signature"
  | "signature_prefix_rejected"
  | "address_already_linked"
  | "invalid_login_credential"
  | "no_signer"
  | "invalid_refresh_token"
  | "refresh_token_reused"
  | "rate_limited"
  | "internal"
  // client-side
  | "not_connected"
  | "root_signer_required"
  | "login_credential_missing"
  | "origin_mismatch"
  | "request_failed"
  // the service refused with a code this SDK does not name; the message carries that code
  | "service_refused"
  // client-side, linking an X account (`linkX()`)
  | "not_authenticated"
  | "user_rejected"
  | "linked_to_another_user"
  | "link_failed";

/**
 * A refused Auth token request, X link or signature. `code` is a `FluentAuthErrorCode`;
 * `status` is the service's HTTP status when the service refused it.
 */
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

/**
 * Every code the service answers an Auth token request with (`internal/auth/errors.go`), and
 * the name the SDK gives it. Most keep theirs; five that name a vendor or a mechanism there
 * take a glossary term here: Direct login's credential, the Signer, the Sign-in challenge. A
 * `Map`, not an object literal, so a code such as `constructor` finds no `Object.prototype`
 * member.
 */
const SERVICE_CODES: ReadonlyMap<string, FluentAuthErrorCode> = new Map([
  ["unknown_app", "unknown_app"],
  ["app_not_auth_enabled", "app_not_auth_enabled"],
  ["origin_not_allowed", "origin_not_allowed"],
  ["origin_missing", "origin_missing"],
  ["bad_request", "bad_request"],
  ["nonce_unknown", "challenge_unknown"],
  ["nonce_used", "challenge_used"],
  ["nonce_expired", "challenge_expired"],
  ["app_mismatch", "app_mismatch"],
  ["invalid_signature", "invalid_signature"],
  ["signature_prefix_rejected", "signature_prefix_rejected"],
  ["address_already_linked", "address_already_linked"],
  ["invalid_privy_token", "invalid_login_credential"],
  ["no_embedded_wallet", "no_signer"],
  ["invalid_refresh_token", "invalid_refresh_token"],
  ["refresh_token_reused", "refresh_token_reused"],
  ["rate_limited", "rate_limited"],
  ["internal", "internal"],
]);

/**
 * The refusals retried once with a fresh challenge: the service burns a challenge before it
 * checks the signature, so a second attempt needs a new one.
 */
const RETRY_ONCE = new Set<FluentAuthErrorCode>([
  "signature_prefix_rejected",
  "challenge_expired",
  "challenge_used",
]);

function toAuthError(err: unknown): FluentAuthError {
  if (err instanceof FluentAuthError) return err;
  if (err instanceof HttpError) {
    const serviceCode: unknown = err.body?.code;
    // No code at all stays `request_failed`: with its status, it is how a deployment that lacks
    // a route is told apart from a service that refused (`useAuthToken`'s refresh fallback).
    if (serviceCode === undefined || serviceCode === null) {
      return new FluentAuthError("request_failed", err.message, err.status);
    }
    const code = typeof serviceCode === "string" ? SERVICE_CODES.get(serviceCode) : undefined;
    if (code) return new FluentAuthError(code, err.message, err.status);
    // An unnamed code goes into the message, not into `code`, so a host's `switch` sees only the
    // union. Only a string is quoted: converting another JSON value can throw
    // (`{"toString":null}`), and the refusal must still reach the host as this error.
    const quoted = typeof serviceCode === "string" ? serviceCode : "not a string";
    return new FluentAuthError(
      "service_refused",
      `${err.message} (service code: ${quoted})`,
      err.status,
    );
  }
  return new FluentAuthError("request_failed", err instanceof Error ? err.message : String(err));
}

/**
 * The refresh credential of a Service session: an opaque secret, and the moment that Service
 * session ends.
 *
 * `refreshExpiresAt` is Unix seconds, the clock of the Auth token's `exp`. The service fixes it
 * at the exchange that opens the Service session and keeps it through every rotation, so the
 * SDK stores what the service answered and does not extend it.
 */
export type FluentRefreshCredential = {
  refreshToken: string;
  refreshExpiresAt: number;
};

/**
 * What an exchange and a renewal both answer: the Auth token, and the refresh credential that
 * renews it without asking the user again.
 *
 * `refresh` is `null` when the answer carries no usable refresh credential: a deployment that
 * issues none, or fields not in the contract's shape. The Auth token is still returned; with
 * nothing to renew with, the next token costs another exchange.
 */
export type FluentAuthTokenPair = {
  token: string;
  refresh: FluentRefreshCredential | null;
};

/**
 * Reads the refresh credential out of a service answer or a stored record, which carry the same
 * two fields and are trusted with neither. Returns `null` unless `refreshToken` is a non-empty
 * string and `refreshExpiresAt` a finite number.
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
 * Spends one refresh token for a new pair, with no user interaction: no Privy round trip, no
 * wallet prompt.
 *
 * The presented token is consumed: presenting it twice is `401 refresh_token_reused` and ends
 * the Service session, so only one renewal per Service session may be in flight. The service's
 * `403 origin_not_allowed`, `429 rate_limited` and `500` leave the credential unspent. A
 * transport failure is ambiguous, since the rotation may have committed before the answer was
 * lost: a caller keeps the stored credential and passes the error on, with no retry.
 *
 * `Origin` is not passed: a browser sets that header itself.
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
 * Ends the Service session the given refresh token belongs to, so nothing renews it again.
 *
 * Idempotent by contract (RFC 7009 §2.2): an unknown, spent or revoked credential answers `200`
 * like a live one, so the route reveals nothing about which credentials exist. Auth tokens
 * already minted are not revoked: they keep verifying until their `exp`, within five minutes.
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

/**
 * Returns the token's `exp` in milliseconds, or `undefined` when the token does not parse. The
 * signature is not verified: the SDK only schedules renewals by it.
 */
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
