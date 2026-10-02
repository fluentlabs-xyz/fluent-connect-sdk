import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  type FluentAuthErrorCode,
  readAuthTokenExpiry,
  readRefreshCredential,
  refreshAuthToken,
  revokeAuthToken,
} from "./authToken";

const API = "https://api.example/api/v1";
const APP_ID = "app_8908941315934a06b738c6804ce26132";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ORIGIN = "http://localhost:5173";
/** Unix seconds, as the service sends it: the family's fixed expiry, thirty days out. */
const FAMILY_EXPIRY = 1_790_000_000;
const PAIR_BODY = {
  token: "jwt",
  refreshToken: "opaque-refresh",
  refreshExpiresAt: FAMILY_EXPIRY,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function challenge(nonce: string, origin = ORIGIN) {
  return {
    nonce,
    typedData: {
      domain: { name: "Fluent Connect Login", version: "1", chainId: 20994 },
      primaryType: "FluentLogin",
      types: {
        FluentLogin: [
          { name: "account", type: "address" },
          { name: "appId", type: "string" },
        ],
      },
      message: {
        account: ADDRESS,
        appId: APP_ID,
        origin,
        nonce,
      },
    },
  };
}

function fakeWallet() {
  return { signTypedData: vi.fn(async () => "0xsig") } as unknown as WalletClient & {
    signTypedData: ReturnType<typeof vi.fn>;
  };
}

function requestBody(call: unknown[] | undefined) {
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangePrivyAuthToken", () => {
  it("posts both Privy tokens and returns the Fluent token", async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, PAIR_BODY)),
    );
    vi.stubGlobal("fetch", fetch);

    const pair = await exchangePrivyAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      accessToken: "access",
      identityToken: "identity",
    });

    expect(pair).toEqual({
      token: "jwt",
      refresh: { refreshToken: "opaque-refresh", refreshExpiresAt: FAMILY_EXPIRY },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/auth/exchange/privy`);
    expect(requestBody(fetch.mock.calls[0])).toEqual({
      appId: APP_ID,
      accessToken: "access",
      identityToken: "identity",
    });
  });

  it("maps a service error body to FluentAuthError.code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { code: "invalid_privy_token", message: "nope" })),
    );

    const err = await exchangePrivyAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      accessToken: "a",
      identityToken: "i",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(FluentAuthError);
    expect((err as FluentAuthError).code).toBe("invalid_privy_token");
    expect((err as FluentAuthError).status).toBe(401);
  });

  it.each<[FluentAuthErrorCode, number]>([
    ["unknown_app", 404],
    ["app_not_auth_enabled", 403],
    ["app_mismatch", 400],
  ])("surfaces the service's %s as FluentAuthError.code", async (code, status) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { code, message: "no" })));

    const err = await exchangePrivyAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      accessToken: "a",
      identityToken: "i",
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe(code);
    expect((err as FluentAuthError).status).toBe(status);
  });
});

describe("exchangeWalletAuthToken", () => {
  it("refuses a challenge minted for another origin before asking the wallet to sign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, challenge("0xn1", "https://evil.example"))),
    );
    const walletClient = fakeWallet();

    const err = await exchangeWalletAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      address: ADDRESS,
      walletClient,
      origin: ORIGIN,
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("origin_mismatch");
    expect(walletClient.signTypedData).not.toHaveBeenCalled();
  });

  it("signs the typed data verbatim and exchanges the nonce", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(jsonResponse(200, PAIR_BODY));
    vi.stubGlobal("fetch", fetch);
    const walletClient = fakeWallet();

    const pair = await exchangeWalletAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      address: ADDRESS,
      walletClient,
      origin: ORIGIN,
    });

    expect(pair.token).toBe("jwt");
    expect(pair.refresh).toEqual({
      refreshToken: "opaque-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    expect(walletClient.signTypedData).toHaveBeenCalledWith({
      account: ADDRESS,
      ...challenge("0xn1").typedData,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(`${API}/auth/exchange/wallet`);
    expect(requestBody(fetch.mock.calls[1])).toEqual({
      appId: APP_ID,
      nonce: "0xn1",
      signature: "0xsig",
    });
  });

  it("retries once with a fresh challenge on signature_prefix_rejected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(
        jsonResponse(401, { code: "signature_prefix_rejected", message: "retry" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn2")))
      .mockResolvedValueOnce(jsonResponse(200, { ...PAIR_BODY, token: "jwt2" }));
    vi.stubGlobal("fetch", fetch);

    const pair = await exchangeWalletAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      address: ADDRESS,
      walletClient: fakeWallet(),
      origin: ORIGIN,
    });

    expect(pair.token).toBe("jwt2");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requestBody(fetch.mock.calls[3]).nonce).toBe("0xn2");
  });

  it("does not retry a configuration error", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(403, { code: "origin_not_allowed", message: "no" }),
    );
    vi.stubGlobal("fetch", fetch);

    const err = await exchangeWalletAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      address: ADDRESS,
      walletClient: fakeWallet(),
      origin: ORIGIN,
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("origin_not_allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("readAuthTokenExpiry", () => {
  it("reads exp from the payload in milliseconds", () => {
    const payload = btoa(JSON.stringify({ exp: 1_700_000_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(readAuthTokenExpiry(`h.${payload}.s`)).toBe(1_700_000_000_000);
  });

  it("returns undefined for a token that does not parse", () => {
    expect(readAuthTokenExpiry("garbage")).toBeUndefined();
  });
});

describe("refreshAuthToken", () => {
  it("posts the refresh token alone and returns the new pair", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, {
        token: "renewed-jwt",
        refreshToken: "rotated-refresh",
        refreshExpiresAt: FAMILY_EXPIRY,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const pair = await refreshAuthToken({ publicApiUrl: API, refreshToken: "opaque-refresh" });

    expect(pair).toEqual({
      token: "renewed-jwt",
      refresh: { refreshToken: "rotated-refresh", refreshExpiresAt: FAMILY_EXPIRY },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/auth/refresh`);
    // The App id and the subject are inside the grant the service holds, and `Origin` is the
    // browser's to send. The body is the one field the contract names, and nothing else.
    expect(requestBody(fetch.mock.calls[0])).toEqual({ refreshToken: "opaque-refresh" });
  });

  it("keeps the family's expiry exactly as the service gave it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          token: "renewed-jwt",
          refreshToken: "rotated-refresh",
          refreshExpiresAt: FAMILY_EXPIRY,
        }),
      ),
    );

    const pair = await refreshAuthToken({ publicApiUrl: API, refreshToken: "opaque-refresh" });

    // Rotation renews the credential, never the session: nothing here may push the deadline out.
    expect(pair.refresh?.refreshExpiresAt).toBe(FAMILY_EXPIRY);
  });

  it.each<[FluentAuthErrorCode, number]>([
    ["invalid_refresh_token", 401],
    ["refresh_token_reused", 401],
    ["origin_not_allowed", 403],
    ["rate_limited", 429],
    ["bad_request", 400],
  ])("surfaces %s as a FluentAuthError carrying its status", async (code, status) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { code, message: "no" })));

    const err = await refreshAuthToken({
      publicApiUrl: API,
      refreshToken: "opaque-refresh",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(FluentAuthError);
    expect((err as FluentAuthError).code).toBe(code);
    expect((err as FluentAuthError).status).toBe(status);
  });

  it("maps a transport failure to request_failed, with no status to branch on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const err = await refreshAuthToken({
      publicApiUrl: API,
      refreshToken: "opaque-refresh",
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("request_failed");
    expect((err as FluentAuthError).status).toBeUndefined();
  });

  it("refuses an answer with no Fluent token in it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { refreshToken: "only-half" })));

    const err = await refreshAuthToken({
      publicApiUrl: API,
      refreshToken: "opaque-refresh",
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("request_failed");
  });
});

describe("revokeAuthToken", () => {
  it("posts the refresh token to /auth/revoke", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, {}),
    );
    vi.stubGlobal("fetch", fetch);

    await revokeAuthToken({ publicApiUrl: API, refreshToken: "opaque-refresh" });

    expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/auth/revoke`);
    expect(requestBody(fetch.mock.calls[0])).toEqual({ refreshToken: "opaque-refresh" });
  });

  it("treats the idempotent 200 for an unknown credential as success", async () => {
    // RFC 7009 §2.2: the route says nothing about which credentials exist, so a caller never
    // has to ask whether it was already too late.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {})));

    await expect(
      revokeAuthToken({ publicApiUrl: API, refreshToken: "already-revoked" }),
    ).resolves.toBeUndefined();
  });

  it("surfaces origin_not_allowed for a credential this origin may not end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { code: "origin_not_allowed", message: "no" })),
    );

    const err = await revokeAuthToken({
      publicApiUrl: API,
      refreshToken: "opaque-refresh",
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("origin_not_allowed");
    expect((err as FluentAuthError).status).toBe(403);
  });
});

describe("readRefreshCredential", () => {
  it("reads the two fields off an answer or a stored record alike", () => {
    expect(
      readRefreshCredential({ token: "jwt", refreshToken: "r", refreshExpiresAt: FAMILY_EXPIRY }),
    ).toEqual({ refreshToken: "r", refreshExpiresAt: FAMILY_EXPIRY });
  });

  it.each([
    ["nothing at all", null],
    ["a string", "refresh"],
    ["a missing token", { refreshExpiresAt: FAMILY_EXPIRY }],
    ["an empty token", { refreshToken: "", refreshExpiresAt: FAMILY_EXPIRY }],
    ["a token that is not a string", { refreshToken: 7, refreshExpiresAt: FAMILY_EXPIRY }],
    ["a missing expiry", { refreshToken: "r" }],
    ["an expiry that is not a number", { refreshToken: "r", refreshExpiresAt: "soon" }],
    ["an expiry that is not finite", { refreshToken: "r", refreshExpiresAt: Number.NaN }],
  ])("reads %s as no credential", (_name, raw) => {
    expect(readRefreshCredential(raw)).toBeNull();
  });
});
