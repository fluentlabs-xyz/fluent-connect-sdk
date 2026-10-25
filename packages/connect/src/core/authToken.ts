import type { WalletClient } from "viem";

import { HttpError, postJson } from "../utils/postJson";

/**
 * Why `getAuthToken()`, `linkX()`, or `widget.signMessage()` / `widget.signTypedData()` was
 * refused (the signatures throw `not_connected` and `root_signer_required`). The codes are the
 * SDK's own, named for the product rather than for a vendor or a mechanism: where the service
 * answers with a code of its own, the SDK maps it here before it reaches the App, and a service
 * code the SDK does not name reaches it as `service_refused`. Keep a `default` branch in a
 * `switch` over them: a later release may add a code.
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
 * A refused Auth token or X link. `code` is a `FluentAuthErrorCode`; `status` is the service's
 * HTTP status when the service refused it.
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
 * Retried once with a fresh challenge: the service burns the challenge before checking the
 * signature.
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
    // A code the SDK does not name never reaches a host's `switch` as a value outside the
    // union; the message keeps it, for the person reading the log. Only a string is quoted:
    // converting any other JSON value can throw (`{"toString":null}`), and a refusal must
    // still reach the host as this error.
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
