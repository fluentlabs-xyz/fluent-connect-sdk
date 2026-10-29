/**
 * @vitest-environment jsdom
 *
 * The Privy app a widget mounts follows its network (FLU-1627): the production service
 * verifies a Privy token against the production Privy app, so a mainnet widget signed in to
 * the dev app could never complete Direct login on mainnet.
 *
 * Three fakes, and no more: `@privy-io/react-auth` (a `PrivyProvider` that records its `appId`
 * and renders its children), `./reownAppKit` (its provider renders its children) and
 * `./FluentWidgetContent` (records the `requestPrivyLogin` prop it is given and renders
 * nothing). Browser storage is jsdom's real `localStorage`.
 */
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

const fixture = vi.hoisted(() => ({
  appId: undefined as string | undefined,
  requestPrivyLogin: undefined as (() => void) | undefined,
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ appId, children }: { appId: string; children: ReactNode }) => {
    fixture.appId = appId;
    return children;
  },
}));
vi.mock("./reownAppKit", () => ({
  ReownProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./FluentWidgetContent", () => ({
  FluentWidgetContent: ({ requestPrivyLogin }: { requestPrivyLogin: () => void }) => {
    fixture.requestPrivyLogin = requestPrivyLogin;
    return null;
  },
}));

const { FluentWidget } = await import("./FluentWidget");

const MAINNET_PRIVY_APP_ID = "cmig3bvhd005hkz0c2q8vdg3s";
const DEV_PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  disableAnalytics: true,
};

/** The keys `clearPrivyRecentLoginMethod` removes, for one Privy app. */
function recentLoginKeys(privyAppId: string): string[] {
  return [
    `privy:${privyAppId}:recent-login-method`,
    `privy:${privyAppId}:recent-login-wallet-client`,
    `privy:${privyAppId}:recent-login-chain-type`,
  ];
}

const MAINNET_KEYS = recentLoginKeys(MAINNET_PRIVY_APP_ID);
const DEV_KEYS = recentLoginKeys(DEV_PRIVY_APP_ID);

/** What a browser holds after a login on each Privy app: a promoted method on both. */
function seedRecentLogins(): void {
  for (const key of [...MAINNET_KEYS, ...DEV_KEYS]) {
    window.localStorage.setItem(key, "twitter");
  }
}

function storedKeys(keys: string[]): (string | null)[] {
  return keys.map((key) => window.localStorage.getItem(key));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  fixture.appId = undefined;
  fixture.requestPrivyLogin = undefined;
});

describe("FluentWidget: the Privy app it mounts", () => {
  it("mounts a mainnet widget on the production Privy app", () => {
    render(<FluentWidget config={{ ...CONFIG, network: "mainnet" }} />);
    expect(fixture.appId).toBe("cmig3bvhd005hkz0c2q8vdg3s");
  });

  it("mounts a testnet widget on the dev Privy app, as before", () => {
    render(<FluentWidget config={{ ...CONFIG, network: "testnet" }} />);
    expect(fixture.appId).toBe("cmi7li7v901yojv0dmtfuf0v4");
  });

  it("drops the mainnet app's last-used login method before mounting, not the dev app's", () => {
    seedRecentLogins();
    render(<FluentWidget config={{ ...CONFIG, network: "mainnet" }} />);
    expect(storedKeys(MAINNET_KEYS)).toEqual([null, null, null]);
    expect(storedKeys(DEV_KEYS)).toEqual(["twitter", "twitter", "twitter"]);
  });

  it("drops the mainnet app's last-used login method again on each login request", () => {
    render(<FluentWidget config={{ ...CONFIG, network: "mainnet" }} />);
    seedRecentLogins();
    expect(fixture.requestPrivyLogin).toBeDefined();
    act(() => fixture.requestPrivyLogin?.());
    expect(storedKeys(MAINNET_KEYS)).toEqual([null, null, null]);
    expect(storedKeys(DEV_KEYS)).toEqual(["twitter", "twitter", "twitter"]);
  });
});
