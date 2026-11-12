/**
 * @vitest-environment jsdom
 *
 * The render context's `renderBridge(onClose)` hands an App the drawer's Swap page as an element
 * of its own, so a Deposit can be made from the App's modal without the account drawer opening.
 *
 * Fakes, and no module of this repository:
 * - `@privy-io/react-auth` 2.25.0, ready with nobody signed in and no Signer;
 * - `@reown/appkit/react` 1.8.20 `createAppKit` and `useAppKit`, the External wallet modal;
 *   `@reown/appkit-adapter-wagmi` 1.8.20 runs for real and mounts the widget's own query client;
 * - `fetch`, for the price and fee reads the Swap page starts.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

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
  useWallets: () => ({ ready: true, wallets: [] }),
  useModalStatus: () => ({ isOpen: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  useLoginWithSiwe: () => ({
    generateSiweNonce: vi.fn(),
    loginWithSiwe: vi.fn(),
  }),
  Captcha: () => null,
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
}));

vi.mock("@reown/appkit/react", () => ({
  createAppKit: () => ({}),
  useAppKit: () => ({ open: () => {} }),
}));

const { FluentWidget } = await import("./FluentWidget");

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("renderBridge in the render context", () => {
  it("renders the Swap page inside the App's own element", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        mode="page"
        connectButton={false}
        renderPage={({ renderBridge }) => (
          <div data-testid="app-modal">{renderBridge(() => {})}</div>
        )}
      />,
    );

    // The page's first state with nobody connected: its amount card and the way to connect the
    // External wallet that pays, drawn where the App put them.
    const modal = screen.getByTestId("app-modal");
    expect(await within(modal).findByRole("button", { name: "Connect a wallet" })).toBeTruthy();
    expect(within(modal).getByLabelText("Amount to deposit in ETH")).toBeTruthy();
    // The account drawer stays closed: the App, not the drawer, holds the page.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
