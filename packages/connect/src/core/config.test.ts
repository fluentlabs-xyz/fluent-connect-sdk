import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFluentConnectPrivyConfig,
  resolveFluentWidgetAuthMethods,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
} from "./config";

const APP_ID = "app_8908941315934a06b738c6804ce26132";
const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

describe("resolveFluentWidgetConfig", () => {
  it.each([undefined, "", "   "])("keeps the current-page OAuth redirect when unset (%s)", (customOAuthRedirectUrl) => {
    const resolved = resolveFluentWidgetConfig({
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      customOAuthRedirectUrl,
    });
    expect(resolved.customOAuthRedirectUrl).toBeUndefined();
    expect(createFluentConnectPrivyConfig({
      customOAuthRedirectUrl: resolved.customOAuthRedirectUrl,
    })).not.toHaveProperty("customOAuthRedirectUrl");
  });

  it("passes an exact HTTPS callback to Privy without changing its spelling", () => {
    const callback = "https://example.com/auth/ios/%63allback/";
    const resolved = resolveFluentWidgetConfig({
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      customOAuthRedirectUrl: `  ${callback}  `,
    });
    const privy = createFluentConnectPrivyConfig({
      network: "mainnet",
      customOAuthRedirectUrl: resolved.customOAuthRedirectUrl,
    });
    expect(privy.customOAuthRedirectUrl).toBe(callback);
    expect(privy.defaultChain?.id).toBe(25363);
  });

  it.each([
    "not a URL",
    "/auth/callback",
    "//example.com/auth/callback",
    "https:example.com/auth/callback",
    "http://example.com/auth/callback",
    "capacitor://localhost",
    "xyz.example.app://callback",
    "javascript:alert(1)",
    "https://user:password@example.com/auth/callback",
    "https://example.com/auth/callback?next=/",
    "https://example.com/auth/callback?",
    "https://example.com/auth/callback#result",
    "https://example.com/auth/callback#",
  ])("rejects an unsupported OAuth callback (%s)", (customOAuthRedirectUrl) => {
    expect(() => resolveFluentWidgetConfig({
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      customOAuthRedirectUrl,
    })).toThrow(/customOAuthRedirectUrl must be an absolute HTTPS URL/);
  });

  it("defaults to ETH and allows an explicit gas and reconnect policy", () => {
    const base = { appId: APP_ID, privyClientId: PRIVY_CLIENT_ID, network: "testnet" as const };
    const defaults = resolveFluentWidgetConfig(base);
    expect(defaults.gasPayment.defaultToken).toBe("ETH");
    expect(defaults.gasPayment.sponsorship).toBe("auto");
    expect(defaults.reconnectOnMount).toBeUndefined();
    const configured = resolveFluentWidgetConfig({
      ...base,
      gasPayment: { defaultToken: "usdnr", sponsorship: "never" },
      reconnectOnMount: true,
    });
    expect(configured.gasPayment.defaultToken).toBe("USDnr");
    expect(configured.gasPayment.sponsorship).toBe("never");
    expect(configured.reconnectOnMount).toBe(true);
    expect(() => resolveFluentWidgetConfig({ ...base, gasPayment: { defaultToken: "UNKNOWN" } }))
      .toThrow("Unsupported default gas token");
  });
  it("requires a non-empty appId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: "   ",
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/appId is required/);
  });

  it("requires appId to be present at all", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      } as unknown as FluentWidgetConfig),
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

  describe("the removed authMode key", () => {
    // The migration notice is warned once per page load, so each case takes a module of its
    // own: a flag left set by the case before it would hide the very thing being asserted.
    let resolve: typeof resolveFluentWidgetConfig;

    beforeEach(async () => {
      vi.resetModules();
      ({ resolveFluentWidgetConfig: resolve } = await import("./config"));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fails the typecheck when a config literal still passes it", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      resolve({
        appId: APP_ID,
        privyClientId: PRIVY_CLIENT_ID,
        // @ts-expect-error authMode was removed from FluentWidgetConfig in 0.5.0.
        authMode: "direct",
      });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('refuses authMode: "hosted" with the migration the App has to make', () => {
      expect(() =>
        resolve({
          appId: APP_ID,
          privyClientId: PRIVY_CLIENT_ID,
          authMode: "hosted",
        } as unknown as FluentWidgetConfig),
      ).toThrow(
        /authMode.*hosted mode was removed in 0\.5\.0.*Delete the authMode key.*origin registered on the Privy app client behind privyClientId/s,
      );
    });

    it('accepts authMode: "direct", ignores it, and warns once however often it is resolved', () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = { appId: APP_ID, privyClientId: PRIVY_CLIENT_ID, network: "testnet" as const };
      const legacy = { ...base, authMode: "direct" } as unknown as FluentWidgetConfig;
      expect(resolve(legacy)).toEqual(resolve(base));

      // What a mount does: the same config resolved again by the widget's content and by its
      // own fluent instance, and once more under a config object React rebuilt.
      resolve(legacy);
      resolve({ ...legacy });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/authMode was removed in 0\.5\.0/);
    });
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

  it("preserves the default silent restore policy and both explicit overrides", () => {
    const base = { appId: APP_ID, privyClientId: PRIVY_CLIENT_ID };
    expect(resolveFluentWidgetConfig(base).reconnectOnMount).toBeUndefined();
    expect(resolveFluentWidgetConfig({ ...base, reconnectOnMount: false }).reconnectOnMount).toBe(false);
    expect(resolveFluentWidgetConfig({ ...base, reconnectOnMount: true }).reconnectOnMount).toBe(true);
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

  it("offers every auth method unless the host picks a set", () => {
    const base = {
      appId: APP_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet" as const,
    };
    expect(resolveFluentWidgetConfig(base).authMethods).toEqual(["google", "email", "passkey"]);
    // The host's order is the dialog's order, and a repeat buys no second button.
    expect(
      resolveFluentWidgetConfig({ ...base, enabledAuthMethods: ["passkey", "google", "passkey"] })
        .authMethods,
    ).toEqual(["passkey", "google"]);
    // X is never in this list, so an empty one leaves it as the only Fluent method.
    expect(resolveFluentWidgetConfig({ ...base, enabledAuthMethods: [] }).authMethods).toEqual([]);
    // Values from an untyped host config are dropped rather than drawn as a dead button.
    expect(resolveFluentWidgetAuthMethods(["twitter", "email"] as unknown as ["email"])).toEqual([
      "email",
    ]);
  });

  it("leaves Quick sign unscoped unless the host whitelists addresses", () => {
    const base = { appId: APP_ID, privyClientId: PRIVY_CLIENT_ID };
    expect(resolveFluentWidgetConfig(base).quickSign.whitelistAddresses).toBeUndefined();
    // Lowercased and deduplicated, so execution compares targets without caring how the
    // host spelled them or how many times one was named.
    expect(
      resolveFluentWidgetConfig({
        ...base,
        quickSign: {
          whitelistAddresses: [
            "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            " 0x83fed707a8dddc2535ae591cf19fb6c91d542d8e ",
            "0xF01977020BA70FD4D36077C830037CD30400F436",
          ],
        },
      }).quickSign.whitelistAddresses,
    ).toEqual([
      "0x83fed707a8dddc2535ae591cf19fb6c91d542d8e",
      "0xf01977020ba70fd4d36077c830037cd30400f436",
    ]);
    // An empty list is honoured: Quick sign then silences nothing, which is different
    // from the unset case that covers every address.
    expect(
      resolveFluentWidgetConfig({ ...base, quickSign: { whitelistAddresses: [] } }).quickSign
        .whitelistAddresses,
    ).toEqual([]);
  });

  it.each([
    ["not an address", "deposit-contract"],
    ["short hex", "0x83fed707a8dddc2535ae591cf19fb6c91d542d8"],
    ["missing prefix", "83fed707a8dddc2535ae591cf19fb6c91d542d8e"],
    ["non-hex", "0xzz08941315934a06b738c6804ce2613283fed707"],
  ])("rejects a malformed Quick sign whitelist entry (%s)", (_label, entry) => {
    expect(() =>
      resolveFluentWidgetConfig({
        appId: APP_ID,
        privyClientId: PRIVY_CLIENT_ID,
        quickSign: { whitelistAddresses: [entry] },
      }),
    ).toThrow(/quickSign\.whitelistAddresses contains .*not an address/);
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

describe("createFluentConnectPrivyConfig", () => {
  it("leaves WalletConnect to Reown", () => {
    const config = createFluentConnectPrivyConfig({ network: "testnet" });
    // Privy builds a WalletConnect Core on every mount and never tears it down.
    // Reown builds one per page; one owner is what keeps the count from growing.
    expect(config.externalWallets?.walletConnect?.enabled).toBe(false);
    // And nothing in Privy's own modal promises a route that is now closed.
    expect(config.appearance?.walletList).not.toContain("wallet_connect");
  });

  it("holds nothing a person can change, so Privy never needs rebuilding", () => {
    // Privy reads this once per mount. `showWalletUIs` in particular is a
    // constant: Quick sign reaches signing through each call's `uiOptions`
    // instead, which is what lets the provider stay up across a toggle.
    expect(createFluentConnectPrivyConfig({ network: "testnet" }).embeddedWallets?.showWalletUIs)
      .toBe(false);
    expect(createFluentConnectPrivyConfig({ network: "mainnet" }).embeddedWallets?.showWalletUIs)
      .toBe(false);
  });
});
