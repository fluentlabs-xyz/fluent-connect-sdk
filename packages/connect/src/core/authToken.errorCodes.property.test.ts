/**
 * Invariant (3) of FLU-1639, for generated service answers: whatever error body the service
 * answers an exchange, a refresh or a revoke with, the call rejects with a `FluentAuthError`
 * whose `code` is a `FluentAuthErrorCode` (ADR 0006). The body's `code` is generated as any
 * JSON value: the service's own codes, `Object.prototype` member names, unknown strings,
 * numbers, objects and `null`. The calls go through the exported functions, so the mapping runs
 * where it runs for a host.
 *
 * One thing is faked: the network, a `fetch` stub that answers every request with the generated
 * status and body.
 */
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exchangePrivyAuthToken,
  FluentAuthError,
  type FluentAuthErrorCode,
  refreshAuthToken,
  revokeAuthToken,
} from "./authToken";

const API = "https://api.example/api/v1";

/**
 * Every member of `FluentAuthErrorCode`, held at runtime. `satisfies` keeps it exact: the
 * typecheck fails when the union gains or loses a member this record does not.
 */
const AUTH_ERROR_CODES = {
  unknown_app: true,
  app_not_auth_enabled: true,
  origin_not_allowed: true,
  origin_missing: true,
  bad_request: true,
  challenge_unknown: true,
  challenge_used: true,
  challenge_expired: true,
  app_mismatch: true,
  invalid_signature: true,
  signature_prefix_rejected: true,
  address_already_linked: true,
  invalid_login_credential: true,
  no_signer: true,
  invalid_refresh_token: true,
  refresh_token_reused: true,
  rate_limited: true,
  internal: true,
  not_connected: true,
  root_signer_required: true,
  login_credential_missing: true,
  origin_mismatch: true,
  request_failed: true,
  service_refused: true,
  not_authenticated: true,
  user_rejected: true,
  linked_to_another_user: true,
  link_failed: true,
} as const satisfies Record<FluentAuthErrorCode, true>;

const SDK_CODES = Object.keys(AUTH_ERROR_CODES);

/** The service's own codes (`internal/auth/errors.go`), some named differently in the SDK. */
const SERVICE_CODES = [
  "unknown_app",
  "app_not_auth_enabled",
  "origin_not_allowed",
  "origin_missing",
  "bad_request",
  "nonce_unknown",
  "nonce_used",
  "nonce_expired",
  "app_mismatch",
  "invalid_signature",
  "signature_prefix_rejected",
  "address_already_linked",
  "invalid_privy_token",
  "no_embedded_wallet",
  "invalid_refresh_token",
  "refresh_token_reused",
  "rate_limited",
  "internal",
];

const serviceCode = fc.oneof(
  fc.constantFrom<unknown>(
    ...SERVICE_CODES,
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "",
    { toString: null },
  ),
  fc.string(),
  fc.jsonValue(),
);

/** The response body as text: a `{ code, message }` object, any JSON value, or not JSON. */
const responseBody = fc.oneof(
  fc
    .record({ code: serviceCode, message: fc.jsonValue() }, { requiredKeys: ["code"] })
    .map((body) => JSON.stringify(body)),
  fc.jsonValue().map((body) => JSON.stringify(body)),
  fc.string(),
);

const authCall = fc.constantFrom(
  {
    name: "exchange",
    run: () =>
      exchangePrivyAuthToken({
        publicApiUrl: API,
        appId: "app_8908941315934a06b738c6804ce26132",
        accessToken: "access",
        identityToken: "identity",
      }),
  },
  { name: "refresh", run: () => refreshAuthToken({ publicApiUrl: API, refreshToken: "opaque" }) },
  { name: "revoke", run: () => revokeAuthToken({ publicApiUrl: API, refreshToken: "opaque" }) },
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invariant (3): a service refusal maps into the SDK's own codes", () => {
  it("rejects exchange, refresh and revoke with a FluentAuthErrorCode for any body", async () => {
    await fc.assert(
      fc.asyncProperty(
        authCall,
        fc.integer({ min: 400, max: 599 }),
        responseBody,
        async (call, status, body) => {
          vi.stubGlobal(
            "fetch",
            vi.fn(
              async () =>
                new Response(body, { status, headers: { "Content-Type": "application/json" } }),
            ),
          );
          const refusal = await call.run().then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(refusal).toBeInstanceOf(FluentAuthError);
          expect(SDK_CODES).toContain((refusal as FluentAuthError).code);
        },
      ),
    );
  });
});
