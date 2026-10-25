/**
 * @vitest-environment jsdom
 *
 * A Fluent ID's `getAuthToken()` with no Direct-login credential in the page (FLU-1622,
 * criterion 4.5): it rejects with the SDK's own `login_credential_missing`, not a vendor code,
 * and asks the service for nothing.
 *
 * Each case calls `getAuthToken()` as the render context hands it out: the function
 * `useAuthToken` returns, with `requestAuthToken` and `core/authToken` running for real.
 *
 * Fakes, and nothing else:
 * - `fetch`, the network boundary, recording every request; no case expects one, so it answers
 *   an Auth token pair as fluent-connect-service `dda9976` does (`POST /auth/exchange/privy`),
 *   which would let a wrongly made request succeed and so be seen only by the recording;
 * - Privy's two Direct-login credentials, the access and the identity token, as plain values,
 *   one of them absent per case, as `@privy-io/react-auth` 2.25.0 reports a credential it does
 *   not hold (`null`).
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FluentAuthError } from "../../core/authToken";
import { resetAuthTokenSessions, useAuthToken } from "./useAuthToken";

const API = "https://api.example/api/v1";

/** `getAuthToken()` for a Fluent ID signed in by Direct login, missing what `missing` names. */
function fluentIdGetAuthToken(missing: {
  identityToken?: null;
  getAccessToken?: () => Promise<null>;
}) {
  const { result } = renderHook(() =>
    useAuthToken({
      publicApiUrl: API,
      appId: "app_8908941315934a06b738c6804ce26132",
      renewalOffsetSeconds: 30,
      accountType: "smart",
      privyUserId: "did:privy:direct-user",
      getAccessToken: async () => "access-credential",
      identityToken: "identity-credential",
      storage: null,
      ...missing,
    }),
  );
  return result.current.getAuthToken;
}

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAuthTokenSessions();
  fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ token: "fluent.token", refreshToken: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("criterion 4.5: a missing Direct-login credential", () => {
  it.each([
    ["the identity credential", { identityToken: null }],
    ["the access credential", { getAccessToken: async () => null }],
  ] as const)("rejects with login_credential_missing when %s is absent", async (_, missing) => {
    const error = await fluentIdGetAuthToken(missing)().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FluentAuthError);
    expect((error as FluentAuthError).code).toBe("login_credential_missing");
    expect(fetch).not.toHaveBeenCalled();
  });
});
