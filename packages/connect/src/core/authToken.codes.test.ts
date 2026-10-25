/**
 * @vitest-environment jsdom
 *
 * The codes a host reads when the service refuses an Auth token (FLU-1622, criterion 4.4): the
 * SDK's own, mapped from the service's at the one place the body is read.
 * The service answers `invalid_privy_token`, `no_embedded_wallet` and `nonce_*`; a host sees
 * `invalid_login_credential`, `no_signer` and `challenge_*`. A used or expired Sign-in challenge
 * is still retried once with a fresh one before it reaches the host. A code the SDK does not
 * name, `constructor` included, reaches the host as `service_refused`, with the service's code
 * in the message; a `code` that is not a string, even one whose conversion to text throws, is
 * `service_refused` too, so no service body reaches the host as anything but a `FluentAuthError`.
 *
 * Each case calls `getAuthToken()` as the render context hands it out: the function
 * `useAuthToken` returns, with `requestAuthToken` and `core/authToken` running for real.
 *
 * Fakes, and nothing else:
 * - `fetch`, answering as fluent-connect-service does at `dda9976` (2026-10-22,
 *   `internal/auth/errors.go`): a JSON body with `code` and `message`, and the status the
 *   service sends that code with;
 * - Privy's two Direct-login credentials, the access and the identity token, as plain values;
 * - the External wallet: a `viem` `WalletClient` whose `signTypedData` answers a signature.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";

import { resetAuthTokenSessions, useAuthToken } from "../widget/hooks/useAuthToken";
import { FluentAuthError } from "./authToken";

const API = "https://api.example/api/v1";
const APP_ID = "app_8908941315934a06b738c6804ce26132";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A Sign-in challenge as the service mints it, for this page's origin. */
function challenge(nonce: string) {
  return {
    nonce,
    typedData: {
      domain: { name: "Fluent Connect Login", version: "1", chainId: 20994 },
      primaryType: "FluentLogin",
      types: { FluentLogin: [{ name: "account", type: "address" }] },
      message: { account: ADDRESS, appId: APP_ID, origin: window.location.origin, nonce },
    },
  };
}

const walletClient = { signTypedData: vi.fn(async () => "0xsig") } as unknown as WalletClient;

/** `fetch` answering every request with one service refusal. */
function serviceRefuses(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, body)));
}

/** `getAuthToken()` for a Fluent ID signed in by Direct login. */
function fluentIdGetAuthToken() {
  const { result } = renderHook(() =>
    useAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      renewalOffsetSeconds: 30,
      accountType: "smart",
      privyUserId: "did:privy:direct-user",
      getAccessToken: async () => "access-credential",
      identityToken: "identity-credential",
      storage: null,
    }),
  );
  return result.current.getAuthToken;
}

/** `getAuthToken()` for an External wallet. */
function externalWalletGetAuthToken() {
  const { result } = renderHook(() =>
    useAuthToken({
      publicApiUrl: API,
      appId: APP_ID,
      renewalOffsetSeconds: 30,
      accountType: "eoa",
      getAccessToken: async () => null,
      identityToken: null,
      walletAddress: ADDRESS,
      walletClient,
      storage: null,
    }),
  );
  return result.current.getAuthToken;
}

async function rejection(promise: Promise<unknown>): Promise<FluentAuthError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FluentAuthError);
  return error as FluentAuthError;
}

beforeEach(() => {
  resetAuthTokenSessions();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("criterion 4.4: a service code from the Direct-login exchange", () => {
  it.each([
    ["invalid_privy_token", 401, "invalid_login_credential"],
    ["no_embedded_wallet", 400, "no_signer"],
  ])("%s reaches the host as FluentAuthError %s", async (serviceCode, status, sdkCode) => {
    serviceRefuses(status, { code: serviceCode, message: "no" });

    const error = await rejection(fluentIdGetAuthToken()());

    expect(error.code).toBe(sdkCode);
    expect(error.status).toBe(status);
  });
});

describe("criterion 4.4: a service code from the External wallet exchange", () => {
  it("nonce_unknown reaches the host as challenge_unknown, with no retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(jsonResponse(400, { code: "nonce_unknown", message: "no" }));
    vi.stubGlobal("fetch", fetch);

    const error = await rejection(externalWalletGetAuthToken()());

    expect(error.code).toBe("challenge_unknown");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["nonce_used", "challenge_used"],
    ["nonce_expired", "challenge_expired"],
  ])("%s is retried once with a fresh challenge, then reaches the host as %s", async (
    serviceCode,
    sdkCode,
  ) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(jsonResponse(400, { code: serviceCode, message: "no" }))
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn2")))
      .mockResolvedValueOnce(jsonResponse(400, { code: serviceCode, message: "no" }));
    vi.stubGlobal("fetch", fetch);

    const error = await rejection(externalWalletGetAuthToken()());

    expect(error.code).toBe(sdkCode);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("a service code the SDK does not name", () => {
  it.each([
    // A code the service sends today that is no member of `FluentAuthErrorCode`.
    ["privy_wallet_mismatch", 403],
    // An `Object.prototype` key: a plain object lookup would hand the host a function.
    ["constructor", 400],
  ])("%s reaches the host as service_refused, the service's code in the message", async (
    serviceCode,
    status,
  ) => {
    serviceRefuses(status, { code: serviceCode, message: "no" });

    const error = await rejection(fluentIdGetAuthToken()());

    expect(error.code).toBe("service_refused");
    expect(error.status).toBe(status);
    expect(error.message).toContain(serviceCode);
  });

  it.each([
    // Valid JSON whose conversion to text throws: `String()` finds no `toString` to call.
    ["an object without a toString", { toString: null }],
    ["a number", 7],
    ["an object", { reason: "x" }],
  ])("a code that is %s reaches the host as service_refused", async (_, serviceCode) => {
    serviceRefuses(400, { code: serviceCode, message: "no" });

    const error = await rejection(fluentIdGetAuthToken()());

    expect(error.code).toBe("service_refused");
    expect(error.status).toBe(400);
  });

  it("keeps request_failed for a refusal that carries no code at all", async () => {
    serviceRefuses(404, { message: "not found" });

    const error = await rejection(fluentIdGetAuthToken()());

    expect(error.code).toBe("request_failed");
    expect(error.status).toBe(404);
  });
});
