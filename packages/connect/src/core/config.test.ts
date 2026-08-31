import { describe, expect, it } from "vitest";

import { resolveFluentWidgetConfig } from "./config";

describe("resolveFluentWidgetConfig", () => {
  it("requires a non-empty clientId from the host app", () => {
    expect(() =>
      resolveFluentWidgetConfig({
        clientId: "   ",
        appName: "Demo",
      }),
    ).toThrow(/clientId is required/);
  });

  it("resolves a registered clientId", () => {
    const resolved = resolveFluentWidgetConfig({
      clientId: "demo_app",
      network: "testnet",
      appName: "Demo",
    });
    expect(resolved.clientId).toBe("demo_app");
    expect(resolved.network).toBe("testnet");
  });

  it("defaults the auth token cache margin to 30 seconds and accepts an override", () => {
    const base = { clientId: "demo_app", network: "testnet" as const, appName: "Demo" };
    expect(resolveFluentWidgetConfig(base).authTokenRenewalOffsetSeconds).toBe(30);
    expect(
      resolveFluentWidgetConfig({ ...base, authTokenRenewalOffsetSeconds: 0 })
        .authTokenRenewalOffsetSeconds,
    ).toBe(0);
  });
});
