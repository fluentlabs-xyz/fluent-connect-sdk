import { describe, expect, it } from "vitest";

import { resolveFluentWidgetConfig, type FluentWidgetConfig } from "./config";

const PARTNER_ID = "partner_8908941315934a06b738c6804ce26132";
const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

describe("resolveFluentWidgetConfig", () => {
  it("requires a non-empty partnerId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: "   ",
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/partnerId is required/);
  });

  it("requires a non-empty privyClientId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: PARTNER_ID,
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
    ).toThrow(/clientId was replaced in the PartnerId cutover/);
  });

  it("rejects a Privy client id passed as the partnerId", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: PRIVY_CLIENT_ID,
        privyClientId: PRIVY_CLIENT_ID,
        appName: "Demo",
      }),
    ).toThrow(/privyClientId/);
  });

  it("rejects a privyClientId that is not a client-… value", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: PARTNER_ID,
        privyClientId: "clientWY6-typo",
        appName: "Demo",
      }),
    ).toThrow(/does not look like a Privy app client/);
  });

  it("rejects a partner id passed as the privyClientId", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        partnerId: PARTNER_ID,
        privyClientId: PARTNER_ID,
        appName: "Demo",
      }),
    ).toThrow(/Swap the two/);
  });

  it("resolves both ids", () => {
    const resolved = resolveFluentWidgetConfig({
      partnerId: PARTNER_ID,
      privyClientId: PRIVY_CLIENT_ID,
      network: "testnet",
      appName: "Demo",
    });
    expect(resolved.partnerId).toBe(PARTNER_ID);
    expect(resolved.privyClientId).toBe(PRIVY_CLIENT_ID);
    expect(resolved.network).toBe("testnet");
  });

  it("defaults the auth token cache margin to 30 seconds and accepts an override", () => {
    const base = {
      partnerId: PARTNER_ID,
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
});
