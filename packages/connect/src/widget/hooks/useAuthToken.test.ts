import { describe, expect, it } from "vitest";

import { authTokenCacheKey } from "./useAuthToken";

const API = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
const PARTNER_A = "partner_8908941315934a06b738c6804ce26132";
const PARTNER_B = "partner_331cfc2d6666e6a57e7e552fcd614a99";
const SUBJECT = "wallet:0x1111111111111111111111111111111111111111";

describe("authTokenCacheKey", () => {
  it("is stable for the same user, partner and service", () => {
    expect(authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: SUBJECT })).toBe(
      authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: SUBJECT }),
    );
  });

  it("changes with the partner — a token's aud must not outlive a partner switch", () => {
    expect(
      authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: SUBJECT }),
    ).not.toBe(authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_B, subject: SUBJECT }));
  });

  it("changes with the service a token was issued by", () => {
    expect(
      authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: SUBJECT }),
    ).not.toBe(
      authTokenCacheKey({
        publicApiUrl: "https://fluent-connect.api.fluent.xyz/api/v1",
        partnerId: PARTNER_A,
        subject: SUBJECT,
      }),
    );
  });

  it("changes with the subject", () => {
    expect(
      authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: SUBJECT }),
    ).not.toBe(
      authTokenCacheKey({ publicApiUrl: API, partnerId: PARTNER_A, subject: "privy:did:privy:abc" }),
    );
  });
});
