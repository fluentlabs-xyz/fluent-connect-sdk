import type { WalletClient } from "viem";

import { HttpError, postJson } from "../utils/postJson";

export type FluentAuthErrorCode =
  // fluent-connect-service codes (fluentauth/errors.go)
  | "unknown_partner"
  | "partner_not_auth_enabled"
  | "origin_not_allowed"
  | "origin_missing"
  | "bad_request"
  | "nonce_unknown"
  | "nonce_used"
  | "nonce_expired"
  | "partner_mismatch"
  | "invalid_signature"
  | "signature_prefix_rejected"
  | "address_already_linked"
  | "invalid_privy_token"
  | "no_embedded_wallet"
  | "rate_limited"
  | "internal"
  // client-side
  | "hosted_not_supported"
  | "not_connected"
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

type Exchange = { token: string };

export async function exchangePrivyAuthToken(params: {
  publicApiUrl: string;
  partnerId: string;
  accessToken: string;
  identityToken: string;
}): Promise<string> {
  try {
    const { token } = await postJson<Exchange>(`${params.publicApiUrl}/auth/exchange/privy`, {
      partnerId: params.partnerId,
      accessToken: params.accessToken,
      identityToken: params.identityToken,
    });
    return token;
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
  partnerId: string;
  address: `0x${string}`;
  walletClient: WalletClient;
  /** `window.location.origin`; the challenge must have been minted for this page. */
  origin: string;
}): Promise<string> {
  const attempt = async (): Promise<string> => {
    const challenge = await postJson<Challenge>(`${params.publicApiUrl}/auth/challenge`, {
      partnerId: params.partnerId,
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
    const { token } = await postJson<Exchange>(`${params.publicApiUrl}/auth/exchange/wallet`, {
      partnerId: params.partnerId,
      nonce: challenge.nonce,
      signature,
    });
    return token;
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
