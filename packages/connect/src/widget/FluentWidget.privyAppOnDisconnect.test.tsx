/**
 * @vitest-environment jsdom
 *
 * A disconnect clears the last-used login method of the Privy app the widget's network signs in
 * through (FLU-1627), so a mainnet widget forgets the production app's promotion and not the
 * dev app's.
 *
 * The mocks follow `FluentWidget.directLogin.test.tsx`: nobody is signed in and no wallet is
 * connected, and `handleDisconnect` runs its local teardown in that state too (only the Privy
 * logout is behind `authenticated`). Privy, Reown and the ZeroDev account are faked;
 * `FluentWidgetContent` is real, reached through `useFluentWidget().disconnect()` from the
 * host's `renderHome`. Browser storage is jsdom's real `localStorage`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

/** Nobody signed in, and no Privy method called: the teardown is what is under test. */
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: unknown }) => children,
  usePrivy: () => ({
    ready: true,
    authenticated: false,
    user: null,
    getAccessToken: async () => null,
    login: () => {},
    logout: async () => {},
  }),
  useIdentityToken: () => ({ identityToken: null }),
  useUser: () => ({ refreshUser: async () => {} }),
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
  useLoginWithSiwe: () => ({ generateSiweMessage: vi.fn(), loginWithSiwe: vi.fn() }),
  useWallets: () => ({ ready: true, wallets: [] }),
  useModalStatus: () => ({ isOpen: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
  Captcha: () => null,
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
}));

vi.mock("./reownAppKit", () => ({
  REOWN_PROJECT_ID: "test",
  reownConfigured: true,
  ReownProvider: ({ children }: { children: unknown }) => children,
  useReownWallet: () => ({
    configured: true,
    connected: false,
    address: undefined,
    chainId: undefined,
    walletClient: undefined,
    reconnecting: false,
    open: () => {},
    disconnect: () => {},
    switchChain: async () => {},
  }),
}));

/** No Fluent ID, so no smart account is on its way either. */
vi.mock("./zerodevSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zerodevSession")>()),
  useFluentZeroDevAccount: () => ({
    smartAccountEnabled: false,
    smartAccountReady: false,
    smartAccountAddress: undefined,
    signerAddress: undefined,
    error: null,
    privyReady: true,
    privyAuthenticated: false,
    embeddedWalletCount: 0,
    kernel: null,
    refresh: async () => null,
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

const { FluentWidget } = await import("./FluentWidget");
const { useFluentWidget } = await import("./widgetContext");

const MAINNET_PRIVY_APP_ID = "cmig3bvhd005hkz0c2q8vdg3s";
const DEV_PRIVY_APP_ID = "cmi7li7v901yojv0dmtfuf0v4";

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "mainnet",
  reputationEnabled: false,
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

function storedKeys(keys: string[]): (string | null)[] {
  return keys.map((key) => window.localStorage.getItem(key));
}

/** The host's way to the public `disconnect()`, the entry that reaches the teardown. */
function DisconnectProbe() {
  const { disconnect } = useFluentWidget();
  return (
    <button type="button" onClick={() => void disconnect()}>
      probe disconnect
    </button>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("FluentWidget: a disconnect on mainnet", () => {
  it("drops the production Privy app's last-used login method, not the dev app's", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        renderHome={() => <DisconnectProbe />}
      />,
    );
    const probe = await waitFor(() => screen.getByRole("button", { name: "probe disconnect" }));

    // Seeded after the mount, so what the mount's own clearing removed is not what this
    // test counts: only the disconnect is left to remove these.
    for (const key of [...MAINNET_KEYS, ...DEV_KEYS]) {
      window.localStorage.setItem(key, "twitter");
    }

    fireEvent.click(probe);

    await waitFor(() => expect(storedKeys(MAINNET_KEYS)).toEqual([null, null, null]));
    expect(storedKeys(DEV_KEYS)).toEqual(["twitter", "twitter", "twitter"]);
  }, 30_000);
});
