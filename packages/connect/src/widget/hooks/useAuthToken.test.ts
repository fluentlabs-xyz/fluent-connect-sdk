import type { WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  type FluentAuthTokenPair,
  readAuthTokenExpiry,
  refreshAuthToken,
  revokeAuthToken,
} from "../../core/authToken";
import {
  loadRefreshCredential,
  refreshCredentialStorageKey,
  saveRefreshCredential,
} from "../../core/refreshCredentialStore";
import {
  type AuthTokenRequest,
  type AuthTokenState,
  authTokenCacheKey,
  endAuthSession,
  requestAuthToken,
  resetAuthTokenSessions,
} from "./useAuthToken";

vi.mock("../../core/authToken", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/authToken")>()),
  exchangePrivyAuthToken: vi.fn(),
  exchangeWalletAuthToken: vi.fn(),
  readAuthTokenExpiry: vi.fn(),
  refreshAuthToken: vi.fn(),
  revokeAuthToken: vi.fn(),
}));

const API = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
const OTHER_API = "https://fluent-connect.api.fluent.xyz/api/v1";
const APP_A = "app_8908941315934a06b738c6804ce26132";
const APP_B = "app_331cfc2d6666e6a57e7e552fcd614a99";
const SUBJECT = "wallet:0x1111111111111111111111111111111111111111";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const PRIVY_USER = "did:privy:direct-user";
const ORIGIN = "http://localhost:5173";
/** Unix seconds: thirty days out, the service's default family lifetime. */
const FAMILY_EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const FIVE_MINUTES = 5 * 60_000;

function memoryStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

function pair(token: string, refreshToken: string, refreshExpiresAt = FAMILY_EXPIRY) {
  return { token, refresh: { refreshToken, refreshExpiresAt } } satisfies FluentAuthTokenPair;
}

/**
 * What a deployment that never had the `/auth/refresh` route answers: a `404` with no service
 * code behind it, so the code falls back to `request_failed`.
 */
function refreshRouteMissing() {
  return new FluentAuthError("request_failed", "Not Found", 404);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing in these tests leaves a rejection unobserved, but a promise handed to two awaiters
  // would warn before both attach; this keeps the intent explicit.
  return { promise, resolve, reject };
}

function emptyState(): AuthTokenState {
  return { cache: null, inFlight: null };
}

const walletClient = { account: { address: WALLET } } as unknown as WalletClient;
const getAccessToken = vi.fn(async () => "privy-access-token");

/** A connected external wallet in direct mode: the path that used to prompt every five minutes. */
function walletRequest(overrides: Partial<AuthTokenRequest> = {}): AuthTokenRequest {
  return {
    publicApiUrl: API,
    appId: APP_A,
    authMode: "direct",
    renewalOffsetSeconds: 30,
    accountType: "eoa",
    walletAddress: WALLET,
    walletClient,
    getAccessToken,
    identityToken: null,
    origin: ORIGIN,
    storage: null,
    ...overrides,
  };
}

/** A Fluent ID in direct mode: the other account type the Issue names. */
function privyRequest(overrides: Partial<AuthTokenRequest> = {}): AuthTokenRequest {
  return {
    publicApiUrl: API,
    appId: APP_A,
    authMode: "direct",
    renewalOffsetSeconds: 30,
    accountType: "smart",
    privyUserId: PRIVY_USER,
    getAccessToken,
    identityToken: "privy-id-token",
    origin: ORIGIN,
    storage: null,
    ...overrides,
  };
}

function storageKeyFor(params: { publicApiUrl?: string; appId?: string; subject?: string } = {}) {
  return refreshCredentialStorageKey(
    authTokenCacheKey({
      publicApiUrl: params.publicApiUrl ?? API,
      appId: params.appId ?? APP_A,
      subject: params.subject ?? SUBJECT,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthTokenSessions();
  vi.mocked(readAuthTokenExpiry).mockReturnValue(Date.now() + FIVE_MINUTES);
  vi.mocked(revokeAuthToken).mockResolvedValue(undefined);
});

describe("authTokenCacheKey", () => {
  it("is stable for the same user, App and service", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT })).toBe(
      authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT }),
    );
  });

  it("changes with the App — a token's aud must not outlive an App switch", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT })).not.toBe(
      authTokenCacheKey({ publicApiUrl: API, appId: APP_B, subject: SUBJECT }),
    );
  });

  it("changes with the service a token was issued by", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT })).not.toBe(
      authTokenCacheKey({ publicApiUrl: OTHER_API, appId: APP_A, subject: SUBJECT }),
    );
  });

  it("changes with the subject", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT })).not.toBe(
      authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: "privy:did:privy:abc" }),
    );
  });
});

describe("requestAuthToken in hosted mode", () => {
  const HOSTED_PRIVY_USER = "did:privy:hosted-user";

  function request(overrides: Partial<AuthTokenRequest>): AuthTokenRequest {
    return {
      publicApiUrl: API,
      appId: APP_A,
      authMode: "hosted",
      renewalOffsetSeconds: 30,
      accountType: undefined,
      getAccessToken,
      identityToken: null,
      origin: ORIGIN,
      storage: null,
      ...overrides,
    };
  }

  async function expectHostedNotSupported(promise: Promise<string>) {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FluentAuthError);
    expect((error as FluentAuthError).code).toBe("hosted_not_supported");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
    expect(refreshAuthToken).not.toHaveBeenCalled();
  }

  it("gets an external wallet a token through the wallet exchange", async () => {
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("wallet-token", "wallet-refresh"));

    const token = await requestAuthToken(
      request({ accountType: "eoa", walletAddress: WALLET, walletClient }),
      emptyState(),
    );

    expect(token).toBe("wallet-token");
    expect(exchangeWalletAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      appId: APP_A,
      walletClient,
      address: WALLET,
      origin: ORIGIN,
    });
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });

  it("refuses a Fluent ID with hosted_not_supported with no in-page Privy user", async () => {
    await expectHostedNotSupported(
      requestAuthToken(request({ accountType: "smart", privyUserId: undefined }), emptyState()),
    );
  });

  it("refuses a Fluent ID with hosted_not_supported even over a valid cached token", async () => {
    const key = authTokenCacheKey({
      publicApiUrl: API,
      appId: APP_A,
      subject: `privy:${HOSTED_PRIVY_USER}`,
    });
    const state: AuthTokenState = {
      cache: { key, generation: 0, token: "direct-mode-token", expiresAt: Date.now() + FIVE_MINUTES },
      inFlight: null,
    };

    await expectHostedNotSupported(
      requestAuthToken(
        request({
          accountType: "smart",
          privyUserId: HOSTED_PRIVY_USER,
          identityToken: "privy-id-token",
        }),
        state,
      ),
    );
  });

  it("refuses a Fluent ID with hosted_not_supported even over a request in flight", async () => {
    const key = authTokenCacheKey({
      publicApiUrl: API,
      appId: APP_A,
      subject: `privy:${HOSTED_PRIVY_USER}`,
    });
    const state: AuthTokenState = {
      cache: null,
      inFlight: { key, generation: 0, promise: Promise.resolve("direct-mode-token") },
    };

    await expectHostedNotSupported(
      requestAuthToken(
        request({
          accountType: "smart",
          privyUserId: HOSTED_PRIVY_USER,
          identityToken: "privy-id-token",
        }),
        state,
      ),
    );
  });

  it("answers not_connected, not hosted_not_supported, when nobody is connected", async () => {
    const error = await requestAuthToken(request({}), emptyState()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FluentAuthError);
    expect((error as FluentAuthError).code).toBe("not_connected");
  });
});

describe("silent renewal", () => {
  /** A state holding a token that has just gone stale for this subject. */
  function staleState(subject = SUBJECT): AuthTokenState {
    return {
      cache: {
        key: authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject }),
        generation: 0,
        token: "expired-fluent-token",
        expiresAt: Date.now() - 1_000,
      },
      inFlight: null,
    };
  }

  it("renews an external wallet's expired token with no exchange and no prompt", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    const token = await requestAuthToken(walletRequest({ storage }), staleState());

    expect(token).toBe("renewed-token");
    expect(refreshAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      refreshToken: "held-refresh",
    });
    // The whole point of the Issue: the wallet is not asked to sign again.
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
    expect(loadRefreshCredential(storage, storageKeyFor())).toEqual({
      refreshToken: "rotated-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
  });

  it("renews a Fluent ID's expired token with no exchange", async () => {
    const subject = `privy:${PRIVY_USER}`;
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor({ subject }), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    const token = await requestAuthToken(privyRequest({ storage }), staleState(subject));

    expect(token).toBe("renewed-token");
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("keeps the family's expiry exactly as the service gave it across a rotation", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(
      pair("renewed-token", "rotated-refresh", FAMILY_EXPIRY),
    );

    await requestAuthToken(walletRequest({ storage }), staleState());

    // Rotation renews the credential, never the session: the SDK stores what it was given and
    // never pushes the deadline out on its own.
    expect(loadRefreshCredential(storage, storageKeyFor())?.refreshExpiresAt).toBe(FAMILY_EXPIRY);
  });

  it("exchanges without a refresh request when the family has already expired", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "dead-refresh",
      refreshExpiresAt: Math.floor(Date.now() / 1000) - 60,
    });
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    const token = await requestAuthToken(walletRequest({ storage }), staleState());

    expect(token).toBe("fresh-token");
    // Nothing is presented: the service could only answer `invalid_refresh_token`.
    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
    expect(loadRefreshCredential(storage, storageKeyFor())).toEqual({
      refreshToken: "fresh-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
  });

  it("exchanges when this browser holds no credential at all", async () => {
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    await requestAuthToken(walletRequest({ storage: memoryStorage() }), emptyState());

    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
  });

  it("renews after a reload, from storage alone, with no exchange", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    // A reload is a page with no session state and no cached token — only the key.
    const token = await requestAuthToken(walletRequest({ storage }), emptyState());

    expect(token).toBe("renewed-token");
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  });

  it("serves the cached token, and asks for nothing, while it is still good", async () => {
    const state: AuthTokenState = {
      cache: {
        key: authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT }),
        generation: 0,
        token: "still-good",
        expiresAt: Date.now() + FIVE_MINUTES,
      },
      inFlight: null,
    };

    expect(await requestAuthToken(walletRequest(), state)).toBe("still-good");
    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  });
});

describe("a refresh the service refuses", () => {
  function seeded() {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    return storage;
  }

  it.each(["invalid_refresh_token", "refresh_token_reused"] as const)(
    "drops the credential and runs one full exchange on %s",
    async (code) => {
      const storage = seeded();
      vi.mocked(refreshAuthToken).mockRejectedValue(new FluentAuthError(code, "no", 401));
      vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

      const token = await requestAuthToken(walletRequest({ storage }), emptyState());

      expect(token).toBe("fresh-token");
      expect(refreshAuthToken).toHaveBeenCalledTimes(1);
      expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
      expect(loadRefreshCredential(storage, storageKeyFor())).toEqual({
        refreshToken: "fresh-refresh",
        refreshExpiresAt: FAMILY_EXPIRY,
      });
    },
  );

  it.each<[string, number]>([
    ["origin_not_allowed", 403],
    // Every `403`, whatever its code: a service that refuses the refresh refuses the exchange
    // too, so a fallback would spend a wallet prompt to be told the same thing.
    ["app_not_auth_enabled", 403],
    // A `404` the service put a code on: that route exists, and no exchange would help.
    ["unknown_app", 404],
    ["bad_request", 400],
    ["rate_limited", 429],
    ["internal", 500],
  ])("passes %s to the caller and keeps the credential", async (code, status) => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(
      new FluentAuthError(code as FluentAuthError["code"], "no", status),
    );

    const error = await requestAuthToken(walletRequest({ storage }), emptyState()).catch(
      (caught: unknown) => caught,
    );

    expect((error as FluentAuthError).code).toBe(code);
    // None of these consumes anything at the service, so the session is still good. Exchanging
    // behind the user's back would spend a wallet prompt on a service that is merely busy.
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
    expect(loadRefreshCredential(storage, storageKeyFor())).toEqual({
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    // Kept means kept: a family that still renews is not ended behind the user's back either.
    expect(revokeAuthToken).not.toHaveBeenCalled();
  });

  it("passes a transport failure to the caller, with no retry and no claim of recovery", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(
      new FluentAuthError("request_failed", "Failed to fetch"),
    );

    const error = await requestAuthToken(walletRequest({ storage }), emptyState()).catch(
      (caught: unknown) => caught,
    );

    expect((error as FluentAuthError).code).toBe("request_failed");
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    // The same code as a missing route, and no status at all: a network that was down for a
    // moment says nothing about the session, so the credential stays.
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
    expect(revokeAuthToken).not.toHaveBeenCalled();
    expect(loadRefreshCredential(storage, storageKeyFor())?.refreshToken).toBe("held-refresh");
  });

  it("does not exchange twice when the fallback exchange itself fails", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(
      new FluentAuthError("invalid_refresh_token", "no", 401),
    );
    vi.mocked(exchangeWalletAuthToken).mockRejectedValue(
      new FluentAuthError("origin_not_allowed", "no", 403),
    );

    await expect(
      requestAuthToken(walletRequest({ storage }), emptyState()),
    ).rejects.toBeInstanceOf(FluentAuthError);
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
  });

  it("abandons the credential and runs one full exchange when the route is missing", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    const token = await requestAuthToken(walletRequest({ storage }), emptyState());

    // Nothing this credential can do at a service without the route, so one exchange — the only
    // way left to a token — and the session it opens is the one kept for next time.
    expect(token).toBe("fresh-token");
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
    expect(loadRefreshCredential(storage, storageKeyFor())).toEqual({
      refreshToken: "fresh-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
  });

  it("does the same for a Fluent ID, through the Privy exchange", async () => {
    const subject = `privy:${PRIVY_USER}`;
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor({ subject }), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    vi.mocked(exchangePrivyAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    expect(await requestAuthToken(privyRequest({ storage }), emptyState())).toBe("fresh-token");

    expect(exchangePrivyAuthToken).toHaveBeenCalledTimes(1);
    expect(loadRefreshCredential(storage, storageKeyFor({ subject }))?.refreshToken).toBe(
      "fresh-refresh",
    );
  });

  it("revokes the family it abandons, and only that one", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    await requestAuthToken(walletRequest({ storage }), emptyState());

    // This page is the only thing that knew that token, and it will never present it again. The
    // family the exchange just opened is the live session now and is not touched.
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "held-refresh",
    ]);
  });

  it("gets the token even when revoking the abandoned family fails", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    vi.mocked(revokeAuthToken).mockRejectedValue(new FluentAuthError("internal", "down", 500));
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("fresh-token");
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
  });

  it("does not make the caller wait for that revoke to answer", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    const revoking = deferred<void>();
    vi.mocked(revokeAuthToken).mockReturnValue(revoking.promise);
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    // A deployment with no `/auth/refresh` route may well have no `/auth/revoke` route either,
    // and a token that is already obtainable must not wait on a request to one that is not there.
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("fresh-token");

    revoking.resolve();
  });

  it("keeps the credential gone when the route-missing fallback has no signer", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());

    const error = await requestAuthToken(
      walletRequest({ storage, walletClient: undefined }),
      emptyState(),
    ).catch((caught: unknown) => caught);

    expect((error as FluentAuthError).code).toBe("not_connected");
    // Gone either way: the credential cannot renew at this service, so keeping it would only
    // buy another `404` on the next call. One refresh, no exchange, and no second attempt.
    expect(storage.entries.has(storageKeyFor())).toBe(false);
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  });

  it("propagates privy_token_missing from the route-missing fallback", async () => {
    const subject = `privy:${PRIVY_USER}`;
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor({ subject }), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());

    const error = await requestAuthToken(
      privyRequest({ storage, identityToken: null }),
      emptyState(),
    ).catch((caught: unknown) => caught);

    expect((error as FluentAuthError).code).toBe("privy_token_missing");
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
    expect(storage.entries.has(storageKeyFor({ subject }))).toBe(false);
  });

  it("does not exchange twice when the route-missing fallback exchange fails", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    vi.mocked(exchangeWalletAuthToken).mockRejectedValue(
      new FluentAuthError("origin_not_allowed", "no", 403),
    );

    await expect(
      requestAuthToken(walletRequest({ storage }), emptyState()),
    ).rejects.toBeInstanceOf(FluentAuthError);

    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    // The old credential stays forgotten: a failed exchange does not make an unrenewable
    // credential renewable, and the next call must not spend a round trip finding that out.
    expect(storage.entries.has(storageKeyFor())).toBe(false);
  });
});

describe("one renewal for the whole page", () => {
  function seeded() {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    return storage;
  }

  it("shares one in-flight refresh between two concurrent callers", async () => {
    const storage = seeded();
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(refreshAuthToken).mockReturnValue(gate.promise);
    const state = emptyState();

    const both = Promise.all([
      requestAuthToken(walletRequest({ storage }), state),
      requestAuthToken(walletRequest({ storage }), state),
    ]);
    gate.resolve(pair("renewed-token", "rotated-refresh"));

    expect(await both).toEqual(["renewed-token", "renewed-token"]);
    // Two refreshes with one token look like a replay to the service, and end the session.
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
  });

  it("shares that refresh across two distinct widget states, and both retain the result", async () => {
    const storage = seeded();
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(refreshAuthToken).mockReturnValue(gate.promise);
    const first = emptyState();
    const second = emptyState();

    const both = Promise.all([
      requestAuthToken(walletRequest({ storage }), first),
      requestAuthToken(walletRequest({ storage }), second),
    ]);
    gate.resolve(pair("renewed-token", "rotated-refresh"));
    expect(await both).toEqual(["renewed-token", "renewed-token"]);
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);

    // Both instances hold it, and a later call from either asks for nothing.
    expect(first.cache?.token).toBe("renewed-token");
    expect(second.cache?.token).toBe("renewed-token");
    vi.mocked(refreshAuthToken).mockClear();
    expect(await requestAuthToken(walletRequest({ storage }), first)).toBe("renewed-token");
    expect(await requestAuthToken(walletRequest({ storage }), second)).toBe("renewed-token");
    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  });

  it("hands a fresh widget state the token another one just obtained", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    await requestAuthToken(walletRequest({ storage }), emptyState());
    vi.mocked(refreshAuthToken).mockClear();

    // A second widget instance mounting on the same page: same session, nothing to pay for.
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("renewed-token");
    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  });

  it("shares the 401 fallback exchange too, across two distinct states", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(
      new FluentAuthError("invalid_refresh_token", "no", 401),
    );
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);
    const first = emptyState();
    const second = emptyState();

    const both = Promise.all([
      requestAuthToken(walletRequest({ storage }), first),
      requestAuthToken(walletRequest({ storage }), second),
    ]);
    gate.resolve(pair("fresh-token", "fresh-refresh"));

    expect(await both).toEqual(["fresh-token", "fresh-token"]);
    // One wallet prompt, not two.
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
    expect(first.cache?.token).toBe("fresh-token");
    expect(second.cache?.token).toBe("fresh-token");
  });

  it("shares the route-missing fallback exchange too, across two distinct states", async () => {
    const storage = seeded();
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);
    const first = emptyState();
    const second = emptyState();

    const both = Promise.all([
      requestAuthToken(walletRequest({ storage }), first),
      requestAuthToken(walletRequest({ storage }), second),
    ]);
    gate.resolve(pair("fresh-token", "fresh-refresh"));

    expect(await both).toEqual(["fresh-token", "fresh-token"]);
    // One wallet prompt, not two, and one refresh that learned the route is gone, not two.
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(1);
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(first.cache?.token).toBe("fresh-token");
    expect(second.cache?.token).toBe("fresh-token");
  });

  it("keeps two subjects, two Apps and two services apart", async () => {
    const storage = memoryStorage();
    for (const [key, refreshToken] of [
      [storageKeyFor(), "mine"],
      [storageKeyFor({ subject: `wallet:${OTHER_WALLET}` }), "theirs"],
      [storageKeyFor({ appId: APP_B }), "other-app"],
      [storageKeyFor({ publicApiUrl: OTHER_API }), "other-service"],
    ] as const) {
      saveRefreshCredential(storage, key, { refreshToken, refreshExpiresAt: FAMILY_EXPIRY });
    }
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    await requestAuthToken(walletRequest({ storage }), emptyState());

    // Only this subject's own credential is ever presented; a token minted for one audience is
    // never renewed under another.
    expect(refreshAuthToken).toHaveBeenCalledWith({ publicApiUrl: API, refreshToken: "mine" });
    expect(loadRefreshCredential(storage, storageKeyFor({ subject: `wallet:${OTHER_WALLET}` }))
      ?.refreshToken).toBe("theirs");
    expect(loadRefreshCredential(storage, storageKeyFor({ appId: APP_B }))?.refreshToken).toBe(
      "other-app",
    );
    expect(
      loadRefreshCredential(storage, storageKeyFor({ publicApiUrl: OTHER_API }))?.refreshToken,
    ).toBe("other-service");
  });
});

describe("requestAuthToken with a forced access token", () => {
  function stateWithCachedToken(): AuthTokenState {
    return {
      cache: {
        key: authTokenCacheKey({
          publicApiUrl: API,
          appId: APP_A,
          subject: `privy:${PRIVY_USER}`,
        }),
        generation: 0,
        token: "rejected-fluent-token",
        expiresAt: Date.now() + FIVE_MINUTES,
      },
      inFlight: null,
    };
  }

  it("serves the cached token when nobody asked for a fresh one", async () => {
    const token = await requestAuthToken(privyRequest(), stateWithCachedToken());

    expect(token).toBe("rejected-fluent-token");
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });

  it("drops the cached token and exchanges again when asked for a fresh one", async () => {
    vi.mocked(exchangePrivyAuthToken).mockResolvedValue(pair("fresh-fluent-token", "fresh-refresh"));
    const state = stateWithCachedToken();

    const token = await requestAuthToken(privyRequest(), state, { fresh: true });

    expect(token).toBe("fresh-fluent-token");
    expect(exchangePrivyAuthToken).toHaveBeenCalledTimes(1);
    expect(state.cache?.token).toBe("fresh-fluent-token");
  });

  it("still renews silently: a forced token is not a forced signature", async () => {
    const subject = `privy:${PRIVY_USER}`;
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor({ subject }), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));

    const token = await requestAuthToken(privyRequest({ storage }), stateWithCachedToken(), {
      fresh: true,
    });

    expect(token).toBe("renewed-token");
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });

  it("drops the rejected token from the page-shared cache, so nobody is handed it next", async () => {
    const storage = memoryStorage();
    vi.mocked(exchangePrivyAuthToken).mockResolvedValue(pair("first-token", "first-refresh"));
    const first = emptyState();
    await requestAuthToken(privyRequest({ storage }), first);

    vi.mocked(refreshAuthToken).mockResolvedValue(pair("second-token", "second-refresh"));
    await requestAuthToken(privyRequest({ storage }), first, { fresh: true });

    // The paymaster refused those bytes. A widget instance mounting now must not be handed
    // them; one that took its own copy earlier keeps it for the five minutes it always had.
    expect(await requestAuthToken(privyRequest({ storage }), emptyState())).toBe("second-token");
  });

  it("leaves another App's cached token alone, even when this App's request fails", async () => {
    vi.mocked(exchangePrivyAuthToken).mockRejectedValue(
      new FluentAuthError("rate_limited", "slow down", 429),
    );
    const otherApp = {
      key: authTokenCacheKey({ publicApiUrl: API, appId: APP_B, subject: `privy:${PRIVY_USER}` }),
      generation: 0,
      token: "other-app-token",
      expiresAt: Date.now() + FIVE_MINUTES,
    };
    const state: AuthTokenState = { cache: { ...otherApp }, inFlight: null };

    // Only the rejected bearer's own entry is dropped: `fresh` is keyed, not a cache wipe.
    await expect(
      requestAuthToken(privyRequest(), state, { fresh: true }),
    ).rejects.toBeInstanceOf(FluentAuthError);
    expect(state.cache).toEqual(otherApp);
  });

  it("shares an exchange already in flight for the same key: it is fresh by construction", async () => {
    const key = authTokenCacheKey({
      publicApiUrl: API,
      appId: APP_A,
      subject: `privy:${PRIVY_USER}`,
    });
    const state: AuthTokenState = {
      cache: null,
      inFlight: { key, generation: 0, promise: Promise.resolve("in-flight-token") },
    };

    const token = await requestAuthToken(privyRequest(), state, { fresh: true });

    expect(token).toBe("in-flight-token");
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });
});

describe("persistence the browser will not cooperate with", () => {
  it("returns the token when the credential cannot be written", async () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
    };
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));
    const state = emptyState();

    // A session that will not survive a reload is not a failed sign-in.
    expect(await requestAuthToken(walletRequest({ storage }), state)).toBe("fresh-token");
    expect(state.cache?.token).toBe("fresh-token");
  });

  it("treats a throwing read as no credential and exchanges", async () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("fresh-token");
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("treats a malformed record as no credential and exchanges", async () => {
    const storage = memoryStorage({ [storageKeyFor()]: "{not json" });
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("fresh-token");
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("works with persistence turned off entirely", async () => {
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("fresh-token", "fresh-refresh"));

    expect(await requestAuthToken(walletRequest({ storage: null }), emptyState())).toBe(
      "fresh-token",
    );
  });
});

describe("endAuthSession", () => {
  function ending(overrides: Parameters<typeof endAuthSession>[0] | object = {}) {
    return endAuthSession({
      publicApiUrl: API,
      appId: APP_A,
      authMode: "direct",
      accountType: "eoa",
      walletAddress: WALLET,
      storage: null,
      ...overrides,
    });
  }

  it("revokes the held family and clears the stored credential", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));
    await requestAuthToken(walletRequest({ storage }), emptyState());

    await ending({ storage });

    expect(revokeAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      refreshToken: "rotated-refresh",
    });
    expect(storage.entries.has(storageKeyFor())).toBe(false);
  });

  it("revokes a credential this page never used, straight out of storage", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });

    // A reloaded page where the user disconnected before anything asked for a token: there is
    // no session here to read, and a live family at the service all the same.
    await ending({ storage });

    expect(revokeAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      refreshToken: "held-refresh",
    });
    expect(storage.entries.has(storageKeyFor())).toBe(false);
  });

  it("clears everything even when the revoke fails", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));
    await requestAuthToken(walletRequest({ storage }), emptyState());
    vi.mocked(revokeAuthToken).mockRejectedValue(new FluentAuthError("internal", "down", 500));

    // Never rejects: the identity, session and wallet teardown around it has to run.
    await expect(ending({ storage })).resolves.toBeUndefined();
    expect(storage.entries.has(storageKeyFor())).toBe(false);

    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after", "after-refresh"));
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("after");
  });

  it("does not let a removal the browser refused keep the credential in use", async () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({ v: 1, refreshToken: "held-refresh", refreshExpiresAt: FAMILY_EXPIRY }),
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
    };
    vi.mocked(refreshAuthToken).mockResolvedValue(pair("renewed-token", "rotated-refresh"));
    await requestAuthToken(walletRequest({ storage }), emptyState());

    await ending({ storage });

    // The bytes may still be on disk, which this SDK cannot help. What it can do is make them
    // useless — the family is revoked — and never present them again in this page.
    expect(revokeAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      refreshToken: "rotated-refresh",
    });
    vi.mocked(refreshAuthToken).mockClear();
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after", "after-refresh"));
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("after");
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("does nothing for a state that can hold no session", async () => {
    await expect(ending({ accountType: undefined, walletAddress: undefined })).resolves
      .toBeUndefined();
    await expect(ending({ authMode: "hosted", accountType: "smart", privyUserId: PRIVY_USER }))
      .resolves.toBeUndefined();
    expect(revokeAuthToken).not.toHaveBeenCalled();
  });

  it("revokes the family an exchange in flight opens, and lets it restore nothing", async () => {
    const storage = memoryStorage();
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);
    const state = emptyState();

    const pending = requestAuthToken(walletRequest({ storage }), state);
    // The user disconnects while the wallet dialog is still open.
    const ended = ending({ storage });
    gate.resolve(pair("late-token", "late-refresh"));
    await pending;
    await ended;

    expect(revokeAuthToken).toHaveBeenCalledWith({
      publicApiUrl: API,
      refreshToken: "late-refresh",
    });
    expect(storage.entries.size).toBe(0);
    // And the session it opened is not here for the next caller to pick up.
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after", "after-refresh"));
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("after");
  });

  it("revokes the family a 401 fallback exchange opens", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockRejectedValue(
      new FluentAuthError("invalid_refresh_token", "no", 401),
    );
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    // Let the refusal land and the fallback exchange start before disconnecting.
    await vi.waitFor(() => expect(exchangeWalletAuthToken).toHaveBeenCalled());
    const ended = ending({ storage });
    gate.resolve(pair("late-token", "late-refresh"));
    await pending;
    await ended;

    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "late-refresh",
    ]);
    expect(storage.entries.size).toBe(0);
  });

  it("revokes both families when a route-missing fallback is out at a disconnect", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    // Let the `404` land and the fallback exchange start before disconnecting.
    await vi.waitFor(() => expect(exchangeWalletAuthToken).toHaveBeenCalled());
    const ended = ending({ storage });
    gate.resolve(pair("late-token", "late-refresh"));
    await pending;
    await ended;

    // The abandoned family was ended by the fallback, before the disconnect could see it; the
    // one the late exchange opened, by that exchange. Neither is left live, and neither twice.
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "held-refresh",
      "late-refresh",
    ]);
    expect(storage.entries.size).toBe(0);
  });

  it("waits for the family a route-missing fallback opens when the 404 lands after the disconnect", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    const refusal = deferred<FluentAuthTokenPair>();
    const fallback = deferred<FluentAuthTokenPair>();
    vi.mocked(refreshAuthToken).mockReturnValue(refusal.promise);
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(fallback.promise);

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    await vi.waitFor(() => expect(refreshAuthToken).toHaveBeenCalled());
    let reportedBack = false;
    const ended = ending({ storage }).then(() => {
      reportedBack = true;
    });
    refusal.reject(refreshRouteMissing());
    await vi.waitFor(() => expect(exchangeWalletAuthToken).toHaveBeenCalled());

    expect(reportedBack).toBe(false);
    fallback.resolve(pair("fallback-token", "fallback-refresh"));
    await ended;

    // The disconnect had already revoked the held family itself, unconditionally; the fallback
    // does not revoke it a second time, and the family it opened is ended before the disconnect
    // reports back.
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "held-refresh",
      "fallback-refresh",
    ]);
    await expect(pending).resolves.toBe("fallback-token");
    expect(storage.entries.size).toBe(0);
  });

  it("does not report back while the revoke of an abandoned family is still out", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    vi.mocked(refreshAuthToken).mockRejectedValue(refreshRouteMissing());
    const revoking = deferred<void>();
    vi.mocked(revokeAuthToken).mockReturnValue(revoking.promise);
    // A service answering without a refresh half: the exchange opens no family of its own, so
    // the revoke still out is the abandoned one and nothing else.
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue({ token: "fresh-token", refresh: null });

    await expect(requestAuthToken(walletRequest({ storage }), emptyState())).resolves.toBe(
      "fresh-token",
    );

    // The token was served without waiting, and the disconnect waits all the same: the family
    // can be alive at the service until the revoke answers.
    let reportedBack = false;
    const ended = ending({ storage }).then(() => {
      reportedBack = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reportedBack).toBe(false);

    revoking.resolve();
    await ended;
    expect(reportedBack).toBe(true);
  });

  it("revokes once for a rotation in flight: one revoke ends the whole family", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(refreshAuthToken).mockReturnValue(gate.promise);

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    const ended = ending({ storage });
    gate.resolve(pair("rotated-token", "rotated-refresh"));
    await pending;
    await ended;

    // The service revokes by family, so the token handed in covers the successor rotation
    // produced. A second revoke for the rotated token would say nothing new.
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "held-refresh",
    ]);
    // And the rotated pair, which landed after the disconnect, was not kept anywhere.
    expect(storage.entries.size).toBe(0);
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after", "after-refresh"));
    expect(await requestAuthToken(walletRequest({ storage }), emptyState())).toBe("after");
  });

  it("stays pending past five seconds, and until the family a late exchange opens is revoked", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const gate = deferred<FluentAuthTokenPair>();
      vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);
      const revoking = deferred<void>();
      vi.mocked(revokeAuthToken).mockReturnValue(revoking.promise);

      const pending = requestAuthToken(walletRequest({ storage }), emptyState());
      // The user disconnects with the wallet dialog open and leaves it open for a long time.
      let reportedBack = false;
      const ended = ending({ storage }).then(() => {
        reportedBack = true;
      });
      await vi.advanceTimersByTimeAsync(5_001);

      // A host's `disconnect()` has not resolved, because the exchange it would have to revoke
      // has not happened yet: no elapsed time turns a pending exchange into an ended session.
      expect(reportedBack).toBe(false);

      // Then the person signs after all. That answer is observable — the caller that asked gets
      // its token — so the family it opens is a live session, and the revoke of it comes before
      // the disconnect reports back rather than after.
      gate.resolve(pair("late-token", "late-refresh"));
      await vi.advanceTimersByTimeAsync(1);
      expect(revokeAuthToken).toHaveBeenCalledWith({
        publicApiUrl: API,
        refreshToken: "late-refresh",
      });
      expect(reportedBack).toBe(false);

      revoking.resolve();
      await ended;
      expect(reportedBack).toBe(true);
      await expect(pending).resolves.toBe("late-token");
      expect(storage.entries.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports back when a revoke of a late family fails: a disconnect never rejects", async () => {
    const storage = memoryStorage();
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(gate.promise);
    vi.mocked(revokeAuthToken).mockRejectedValue(new FluentAuthError("internal", "down", 500));

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    const ended = ending({ storage });
    gate.resolve(pair("late-token", "late-refresh"));

    // A service that cannot be reached must not leave a host's `disconnect()` hanging or
    // rejecting; the family is then one this SDK has done what it can about.
    await expect(ended).resolves.toBeUndefined();
    await expect(pending).resolves.toBe("late-token");
    expect(storage.entries.size).toBe(0);
  });

  it("waits for the family a 401 fallback opens when the refusal lands after the disconnect", async () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, storageKeyFor(), {
      refreshToken: "held-refresh",
      refreshExpiresAt: FAMILY_EXPIRY,
    });
    const refusal = deferred<FluentAuthTokenPair>();
    const fallback = deferred<FluentAuthTokenPair>();
    vi.mocked(refreshAuthToken).mockReturnValue(refusal.promise);
    vi.mocked(exchangeWalletAuthToken).mockReturnValue(fallback.promise);

    const pending = requestAuthToken(walletRequest({ storage }), emptyState());
    await vi.waitFor(() => expect(refreshAuthToken).toHaveBeenCalled());
    // The user disconnects while the renewal is out. No exchange has started yet, so a disconnect
    // that only looked at exchanges in flight could not know one was coming.
    let reportedBack = false;
    const ended = ending({ storage }).then(() => {
      reportedBack = true;
    });
    refusal.reject(new FluentAuthError("refresh_token_reused", "replayed", 401));
    await vi.waitFor(() => expect(exchangeWalletAuthToken).toHaveBeenCalled());

    // The fallback's family does not exist yet, and the disconnect is still waiting for it.
    expect(reportedBack).toBe(false);
    fallback.resolve(pair("fallback-token", "fallback-refresh"));
    await ended;

    // Both families are ended, and the fallback's before the disconnect reported back.
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "held-refresh",
      "fallback-refresh",
    ]);
    await expect(pending).resolves.toBe("fallback-token");
    expect(storage.entries.size).toBe(0);
  });

  it("stops another widget state from serving the ended session's token", async () => {
    const storage = memoryStorage();
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("shared-token", "shared-refresh"));
    const disconnecting = emptyState();
    const other = emptyState();
    expect(await requestAuthToken(walletRequest({ storage }), disconnecting)).toBe("shared-token");
    // A second widget instance on the page takes the same token into its own state.
    expect(await requestAuthToken(walletRequest({ storage }), other)).toBe("shared-token");

    // The user disconnects through the first instance, which clears its own state as the hook
    // does. The other instance is out of reach and still holds its copy.
    disconnecting.cache = null;
    disconnecting.inFlight = null;
    await ending({ storage });

    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after-reconnect", "after-refresh"));
    expect(await requestAuthToken(walletRequest({ storage }), other)).toBe("after-reconnect");
    expect(exchangeWalletAuthToken).toHaveBeenCalledTimes(2);
  });

  it("does not let a later call join a request the disconnect has already ended", async () => {
    const storage = memoryStorage();
    const gate = deferred<FluentAuthTokenPair>();
    vi.mocked(exchangeWalletAuthToken).mockReturnValueOnce(gate.promise);
    const state = emptyState();

    const pending = requestAuthToken(walletRequest({ storage }), state);
    const ended = ending({ storage });
    // The same state asks again after the disconnect, while its first request is still out. That
    // request belongs to the ended session, so this call starts its own instead of joining it.
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue(pair("after", "after-refresh"));
    const afterDisconnect = requestAuthToken(walletRequest({ storage }), state);
    gate.resolve(pair("late-token", "late-refresh"));

    expect(await afterDisconnect).toBe("after");
    // The caller that asked first still gets its answer: bytes already issued cannot be recalled.
    await expect(pending).resolves.toBe("late-token");
    await ended;
    expect(vi.mocked(revokeAuthToken).mock.calls.map(([call]) => call.refreshToken)).toEqual([
      "late-refresh",
    ]);
  });
});
