import { describe, expect, it } from "vitest";

import { authTokenCacheKey } from "./useAuthToken";

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
