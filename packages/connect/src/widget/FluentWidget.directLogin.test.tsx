/**
 * @vitest-environment jsdom
 *
 * Direct login is the only login (FLU-1581).
 *
 * A config that names no login mode — there is no longer a key for one — opens Fluent's own
 * sign-in dialog inside the page on Connect, and opens no window. The second half is what the
 * removal of hosted mode is really about: until 0.5.0 a config that said nothing defaulted to
 * the authorize popup, so the App whose integrator never set `authMode` was the one sending its
 * users out of the page.
 *
 * The mocks follow `FluentWidget.externalWalletTrigger.test.tsx`: nobody is signed in and no
 * wallet is connected, which is the state a first-time visitor presses Connect in.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

/** Nobody signed in, and no Privy method called: the dialog is what is under test. */
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

/** No login mode: the key is gone, and this is every App's config now. */
const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/** What an App that followed the 0.4.1 docs still ships, read past the type. */
const LEGACY_DIRECT_CONFIG = {
  ...CONFIG,
  authMode: "direct",
} as unknown as FluentWidgetConfig;

let openWindow: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openWindow = vi.fn(() => null);
  vi.stubGlobal("open", openWindow);
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

describe("FluentWidget: a config with no login mode", () => {
  it("opens Fluent's in-page sign-in dialog on Connect, and opens no window", async () => {
    render(<FluentWidget config={CONFIG} showDebugPayload={false} />);

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /connect/i })));

    // Fluent's own dialog, in this page: its Fluent methods and the external-wallet
    // branch on one screen. The authorize popup offered neither.
    await waitFor(() => expect(screen.getByText("Continue with X")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Other wallets/i })).toBeTruthy();

    // And nothing left the page for it.
    expect(openWindow).not.toHaveBeenCalled();
  }, 30_000);
});

/**
 * The only case in this file that carries the legacy key: the migration notice is warned once
 * per module load, so a second such case would read an already-spent flag and assert nothing.
 */
describe("FluentWidget: a config left on the 0.4.x authMode: \"direct\"", () => {
  it("logs the migration notice once for one mount, and still logs in on this page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<FluentWidget config={LEGACY_DIRECT_CONFIG} showDebugPayload={false} />);

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /connect/i })));
    await waitFor(() => expect(screen.getByText("Continue with X")).toBeTruthy());
    expect(openWindow).not.toHaveBeenCalled();

    // One mount resolves the config in the widget, in its content and in its fluent instance.
    const notices = warn.mock.calls.filter(([message]) =>
      String(message).includes("authMode was removed in 0.5.0"),
    );
    expect(notices).toHaveLength(1);
    warn.mockRestore();
  }, 30_000);
});
