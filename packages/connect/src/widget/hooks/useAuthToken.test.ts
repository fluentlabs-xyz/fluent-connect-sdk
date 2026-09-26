import type { WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  readAuthTokenExpiry,
} from "../../core/authToken";
import {
  type AuthTokenRequest,
  type AuthTokenState,
  authTokenCacheKey,
  requestAuthToken,
} from "./useAuthToken";

vi.mock("../../core/authToken", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/authToken")>()),
  exchangePrivyAuthToken: vi.fn(),
  exchangeWalletAuthToken: vi.fn(),
  readAuthTokenExpiry: vi.fn(),
}));

const API = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
const APP_A = "app_8908941315934a06b738c6804ce26132";
const APP_B = "app_331cfc2d6666e6a57e7e552fcd614a99";
const SUBJECT = "wallet:0x1111111111111111111111111111111111111111";

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
      authTokenCacheKey({
        publicApiUrl: "https://fluent-connect.api.fluent.xyz/api/v1",
        appId: APP_A,
        subject: SUBJECT,
      }),
    );
  });

  it("changes with the subject", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: SUBJECT })).not.toBe(
      authTokenCacheKey({ publicApiUrl: API, appId: APP_A, subject: "privy:did:privy:abc" }),
    );
  });
});

describe("requestAuthToken in hosted mode", () => {
  const WALLET = "0x2222222222222222222222222222222222222222";
  const PRIVY_USER = "did:privy:hosted-user";
  const ORIGIN = "http://localhost:5173";
  const walletClient = { account: { address: WALLET } } as unknown as WalletClient;
  const getAccessToken = vi.fn(async () => "privy-access-token");

  function request(overrides: Partial<AuthTokenRequest>): AuthTokenRequest {
    return {
      publicApiUrl: API,
      appId: APP_A,
      authMode: "direct",
      renewalOffsetSeconds: 30,
      accountType: undefined,
      getAccessToken,
      identityToken: null,
      origin: ORIGIN,
      ...overrides,
    };
  }

  function emptyState(): AuthTokenState {
    return { cache: null, inFlight: null };
  }

  async function expectHostedNotSupported(promise: Promise<string>) {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FluentAuthError);
    expect((error as FluentAuthError).code).toBe("hosted_not_supported");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
    expect(exchangeWalletAuthToken).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAuthTokenExpiry).mockReturnValue(Date.now() + 5 * 60_000);
  });

  it("gets an external wallet a token through the wallet exchange", async () => {
    vi.mocked(exchangeWalletAuthToken).mockResolvedValue("wallet-token");

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
      subject: `privy:${PRIVY_USER}`,
    });
    const state: AuthTokenState = {
      cache: { key, token: "direct-mode-token", expiresAt: Date.now() + 5 * 60_000 },
      inFlight: null,
    };

    await expectHostedNotSupported(
      requestAuthToken(
        request({ accountType: "smart", privyUserId: PRIVY_USER, identityToken: "privy-id-token" }),
        state,
      ),
    );
  });

  it("refuses a Fluent ID with hosted_not_supported even over a request in flight", async () => {
    const key = authTokenCacheKey({
      publicApiUrl: API,
      appId: APP_A,
      subject: `privy:${PRIVY_USER}`,
    });
    const state: AuthTokenState = {
      cache: null,
      inFlight: { key, promise: Promise.resolve("direct-mode-token") },
    };

    await expectHostedNotSupported(
      requestAuthToken(
        request({ accountType: "smart", privyUserId: PRIVY_USER, identityToken: "privy-id-token" }),
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

describe("requestAuthToken with a forced refresh", () => {
  const PRIVY_USER = "did:privy:direct-user";
  const ORIGIN = "http://localhost:5173";
  const getAccessToken = vi.fn(async () => "privy-access-token");

  function request(): AuthTokenRequest {
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
    };
  }

  function stateWithCachedToken(): AuthTokenState {
    return {
      cache: {
        key: authTokenCacheKey({
          publicApiUrl: API,
          appId: APP_A,
          subject: `privy:${PRIVY_USER}`,
        }),
        token: "rejected-fluent-token",
        expiresAt: Date.now() + 5 * 60_000,
      },
      inFlight: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAuthTokenExpiry).mockReturnValue(Date.now() + 5 * 60_000);
  });

  it("serves the cached token when nobody asked for a fresh one", async () => {
    const token = await requestAuthToken(request(), stateWithCachedToken());

    expect(token).toBe("rejected-fluent-token");
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });

  it("drops the cached token and exchanges again when asked for a fresh one", async () => {
    vi.mocked(exchangePrivyAuthToken).mockResolvedValue("fresh-fluent-token");
    const state = stateWithCachedToken();

    const token = await requestAuthToken(request(), state, { fresh: true });

    expect(token).toBe("fresh-fluent-token");
    expect(exchangePrivyAuthToken).toHaveBeenCalledTimes(1);
    expect(state.cache?.token).toBe("fresh-fluent-token");
  });

  it("leaves another App's cached token alone, even when this App's refresh fails", async () => {
    vi.mocked(exchangePrivyAuthToken).mockRejectedValue(
      new FluentAuthError("rate_limited", "slow down"),
    );
    const otherApp = {
      key: authTokenCacheKey({ publicApiUrl: API, appId: APP_B, subject: `privy:${PRIVY_USER}` }),
      token: "other-app-token",
      expiresAt: Date.now() + 5 * 60_000,
    };
    const state: AuthTokenState = { cache: { ...otherApp }, inFlight: null };

    // Only the rejected bearer's own entry is dropped: `fresh` is keyed, not a cache wipe.
    await expect(requestAuthToken(request(), state, { fresh: true })).rejects.toBeInstanceOf(
      FluentAuthError,
    );
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
      inFlight: { key, promise: Promise.resolve("in-flight-token") },
    };

    const token = await requestAuthToken(request(), state, { fresh: true });

    expect(token).toBe("in-flight-token");
    expect(exchangePrivyAuthToken).not.toHaveBeenCalled();
  });
});
