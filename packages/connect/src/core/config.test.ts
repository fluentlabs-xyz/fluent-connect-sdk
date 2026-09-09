import { describe, expect, it } from "vitest";

import { resolveFluentWidgetConfig, type FluentWidgetConfig } from "./config";

const APP_ID = "app_8908941315934a06b738c6804ce26132";
const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

describe("resolveFluentWidgetConfig", () => {
  it("requires a non-empty appId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: "   ",
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/appId is required/);
  });

  it("requires a non-empty privyClientId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: APP_ID,
        privyClientId: "   ",
        appName: "Demo",
      }),
    ).toThrow(/privyClientId is required/);
  });

  it("rejects the removed clientId option with a migration hint", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        clientId: "client-abc",
        appName: "Demo",
      } as unknown as FluentWidgetConfig),
    ).toThrow(/clientId was removed in 0\.2\.0/);
  });

  it("rejects the renamed partnerId option by name, before complaining that appId is missing", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: "partner_8908941315934a06b738c6804ce26132",
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      } as unknown as FluentWidgetConfig),
    ).toThrow(/partnerId was renamed to appId in 0\.3\.0/);
  });

  it("rejects a Privy client id passed as the appId", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: PRIVY_CLIENT_ID,
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/Privy app client, not an app id/);
  });

  it("rejects an old partner_… id — the service no longer knows it", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: "partner_8908941315934a06b738c6804ce26132",
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/"partner_8908941315934a06b738c6804ce26132" is not an app id.*app_<32 hex>.*Fluent Dashboard/);
  });

  it.each([
    ["short hex", "app_8908941315934a06b738c6804ce2613"],
    ["long hex", "app_8908941315934a06b738c6804ce261320"],
    ["uppercase hex", "app_8908941315934A06B738C6804CE26132"],
    ["non-hex", "app_zz08941315934a06b738c6804ce26132"],
    ["missing underscore", "app8908941315934a06b738c6804ce26132"],
  ])("rejects a malformed app id (%s)", (_label, appId) => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId,
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/is not an app id/);
  });

  it("rejects a privyClientId that is not a client-… value", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: APP_ID,
        privyClientId: "clientWY6-typo",
        appName: "Demo",
      }),
    ).toThrow(/does not look like a Privy app client/);
  });

  it("rejects an app id passed as the privyClientId", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: APP_ID,
        privyClientId: APP_ID,
        appName: "Demo",
      }),
    ).toThrow(/Swap the two/);
  });

  it("resolves both ids", () => {
    const resolved = resolveFluentWidgetConfig({
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet",
      appName: "Demo",
    });
    expect(resolved.appId).toBe(APP_ID);
    expect(resolved.privyClientId).toBe(PRIVY_CLIENT_ID);
    expect(resolved.network).toBe("testnet");
  });

  it("trims whitespace around the ids before asserting their shape", () => {
    const resolved = resolveFluentWidgetConfig({
      appId: `  ${APP_ID}  `,
      privyClientId: ` ${PRIVY_CLIENT_ID} `,
      appName: "Demo",
    });
    expect(resolved.appId).toBe(APP_ID);
    expect(resolved.privyClientId).toBe(PRIVY_CLIENT_ID);
  });

  it("defaults the auth token cache margin to 30 seconds and accepts an override", () => {
    const base = {
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet" as const,
      appName: "Demo",
    };
    expect(resolveFluentWidgetConfig(base).authTokenRenewalOffsetSeconds).toBe(30);
    expect(
      resolveFluentWidgetConfig({ ...base, authTokenRenewalOffsetSeconds: 0 })
        .authTokenRenewalOffsetSeconds,
    ).toBe(0);
  });

  it("keeps the reputation tab on unless the host opts out", () => {
    const base = {
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet" as const,
      appName: "Demo",
    };
    expect(resolveFluentWidgetConfig(base).reputationEnabled).toBe(true);
    expect(
      resolveFluentWidgetConfig({ ...base, reputationEnabled: false }).reputationEnabled,
    ).toBe(false);
  });

  it("resolves the account avatar to the Fluent mark unless the host overrides it", () => {
    const base = {
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet" as const,
      appName: "Demo",
    };
    expect(resolveFluentWidgetConfig(base).avatar).toEqual({
      defaultLogoUrl: undefined,
      forceDefault: false,
    });
    expect(
      resolveFluentWidgetConfig({
        ...base,
        avatar: { defaultLogoUrl: "  /brand/logo.svg  ", forceDefault: true },
      }).avatar,
    ).toEqual({ defaultLogoUrl: "/brand/logo.svg", forceDefault: true });
    // A blank string is a host passing an unset value through, not a request for
    // a blank avatar — it has to land back on the Fluent mark.
    expect(
      resolveFluentWidgetConfig({ ...base, avatar: { defaultLogoUrl: "   " } }).avatar
        .defaultLogoUrl,
    ).toBeUndefined();
  });
});
