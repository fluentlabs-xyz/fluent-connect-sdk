/** @vitest-environment jsdom */
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

const fixture = vi.hoisted(() => ({ config: undefined as PrivyClientConfig | undefined }));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ config, children }: { config: PrivyClientConfig; children: ReactNode }) => {
    fixture.config = config;
    return children;
  },
}));
vi.mock("./reownAppKit", () => ({
  ReownProvider: ({ children }: { children: ReactNode }) => children,
}));
// Only the provider configuration is under test; account UI needs no network or wallet.
vi.mock("./FluentWidgetContent", () => ({ FluentWidgetContent: () => null }));

const { FluentWidget } = await import("./FluentWidget");
const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  disableAnalytics: true,
};

afterEach(() => {
  cleanup();
  fixture.config = undefined;
});

describe("FluentWidget OAuth redirect", () => {
  it("keeps Privy's current-page callback by default", () => {
    render(<FluentWidget config={CONFIG} />);
    expect(fixture.config).toBeDefined();
    expect(fixture.config).not.toHaveProperty("customOAuthRedirectUrl");
  });

  it("forwards the callback and updates or removes it when the host changes config", () => {
    const first = "https://app.example.com/auth/ios/callback";
    const second = "https://app.example.com/auth/android/callback";
    const view = render(<FluentWidget config={{ ...CONFIG, customOAuthRedirectUrl: first }} />);
    expect(fixture.config?.customOAuthRedirectUrl).toBe(first);

    view.rerender(<FluentWidget config={{ ...CONFIG, customOAuthRedirectUrl: second }} />);
    expect(fixture.config?.customOAuthRedirectUrl).toBe(second);

    view.rerender(<FluentWidget config={CONFIG} />);
    expect(fixture.config).not.toHaveProperty("customOAuthRedirectUrl");
  });
});
