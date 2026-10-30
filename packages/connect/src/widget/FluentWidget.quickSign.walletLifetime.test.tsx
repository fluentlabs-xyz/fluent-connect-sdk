/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for one question: what does toggling Quick sign
 * rebuild?
 *
 * The answer this pins is "nothing", and it is held up by two independent
 * things, which is why both are asserted. Quick sign is no longer in the
 * `PrivyProvider` key, so the subtree below it survives; and `ReownProvider` —
 * which owns AppKit, and AppKit the one WalletConnect Core this page is allowed
 * to have — sits above that key anyway, so it would survive even if the key came
 * back. The mocks follow `FluentWidget.quickSign.test.tsx`, with one difference
 * that is the whole point: `ReownProvider` counts its own mounts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentUserSettings } from "../core/settingsClient";
import type { FluentWidgetConfig } from "../core/config";
import type { FluentPrivyAdapter } from "./privyAdapter";
import type { FluentSigningMode } from "./batchOperation";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => ({
  /** Every mount of the provider that owns AppKit, counted. */
  reownMounts: 0,
  nativePrivyMounts: 0,
  readCalls: 0,
}));

vi.mock("@privy-io/react-auth", () => ({
  // A passthrough. The `key` that rebuilds this subtree is `FluentWidget`'s own,
  // so nothing about Privy itself is needed to exercise it.
  PrivyProvider: ({ children }: { children: unknown }) => children,
  usePrivy: () => ({
    ready: true,
    authenticated: true,
    user: { id: "did:privy:test" },
    getAccessToken: async () => "privy-access-token",
    login: () => {},
    logout: async () => {},
  }),
  useIdentityToken: () => ({ identityToken: "privy-identity-token" }),
  useUser: () => ({ refreshUser: async () => {} }),
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
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

vi.mock("./reownAppKit", async () => {
  const { useEffect } = await import("react");
  return {
    REOWN_PROJECT_ID: "",
    reownConfigured: false,
    /**
     * Stands in for the real provider, which builds AppKit — and with it one
     * WalletConnect Core — on its first mount. Counting mounts counts the
     * instances the real one would have left behind.
     */
    ReownProvider: ({ children }: { children: unknown }) => {
      useEffect(() => {
        fixture.reownMounts += 1;
      }, []);
      return children;
    },
    useReownWallet: () => ({
      configured: false,
      connected: false,
      reconnecting: false,
      open: () => {},
      disconnect: () => {},
      switchChain: async () => {},
    }),
  };
});

vi.mock("./zerodevSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zerodevSession")>()),
  // A Fluent ID that is already there: `deriveWidgetAccount` reads these fields
  // and nothing else to call the account ready.
  useFluentZeroDevAccount: () => ({
    smartAccountReady: true,
    smartAccountAddress: SMART_ACCOUNT,
    signerAddress: SIGNER,
    error: null,
    privyReady: true,
    privyAuthenticated: true,
    embeddedWalletCount: 1,
    kernel: null,
    refresh: async () => {},
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

vi.mock("../core/settingsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/settingsClient")>()),
  createFluentSettingsClient: () => ({
    // Their stored Quick sign is the default, so applying it changes nothing and
    // every mount this test counts belongs to the first render.
    read: async (): Promise<FluentUserSettings> => {
      fixture.readCalls += 1;
      return { quickSign: true, gasTokenSymbol: null, tokens: [] };
    },
    patch: async () => {},
    putToken: async () => {},
    deleteToken: async () => {},
  }),
}));

const { FluentWidget } = await import("./FluentWidget");
const nativeAdapter: FluentPrivyAdapter = {
  ...(await import("@privy-io/react-auth")),
  PrivyProvider: ({ children }) => {
    useEffect(() => {
      fixture.nativePrivyMounts += 1;
    }, []);
    return <>{children}</>;
  },
};

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/**
 * Mounted by the host below the keyed `PrivyProvider`; counts its rebuilds, and shows the
 * signing mode the widget has applied, which is what a toggle changes once it lands.
 */
let subtreeMounts = 0;
function KeyedSubtreeProbe({ signingMode }: { signingMode: FluentSigningMode }) {
  useEffect(() => {
    subtreeMounts += 1;
  }, []);
  return <div data-testid="keyed-subtree-probe" data-signing-mode={signingMode} />;
}

beforeEach(() => {
  subtreeMounts = 0;
  fixture.reownMounts = 0;
  fixture.nativePrivyMounts = 0;
  fixture.readCalls = 0;
  // Balances and prices are not what this test is about, and a test has no
  // business on the network.
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
});

describe.each(["web", "native"] as const)("FluentWidget: what Quick sign rebuilds (%s)", (runtime) => {
  function renderWidget() {
    return render(
      <FluentWidget
        config={CONFIG}
        privyAdapter={runtime === "native" ? nativeAdapter : undefined}
        renderHome={({ widget }) => (
          <KeyedSubtreeProbe signingMode={widget.signingMode} />
        )}
      />,
    );
  }

  /**
   * The drawer, the account menu, then Settings — the way a person reaches it.
   * Leaves the Quick sign switch on screen.
   */
  async function openSettingsScreen() {
    fireEvent.click(screen.getByRole("button", { name: /0x092A/ }));
    fireEvent.click(await waitFor(() => screen.getByLabelText("Account actions")));
    const settings = await waitFor(() => screen.getByRole("option", { name: "Settings" }));
    fireEvent.pointerDown(settings, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(settings, { pointerType: "mouse", button: 0 });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryAllByRole("switch")).toHaveLength(1));
  }

  /** The Settings screen has exactly one switch, and it is Quick sign. */
  const quickSign = () => screen.getByRole("switch");

  /**
   * Waits until a toggle has landed: the switch shows it, and the widget has applied it, which
   * the host reads as `widget.signingMode`. Applying it is the step that used to rebuild the
   * subtree, so each toggle is awaited past it rather than past a fixed delay.
   */
  async function landed(quickSignOn: boolean) {
    await waitFor(() => {
      expect(quickSign().getAttribute("aria-checked")).toBe(String(quickSignOn));
      expect(screen.getByTestId("keyed-subtree-probe").dataset.signingMode).toBe(
        quickSignOn ? "silent" : "prompt",
      );
    });
  }

  // The mount and the drawer, under the full parallel suite, can pass Vitest's 5 s default.
  it("rebuilds nothing, however many times Quick sign is toggled", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();
    await waitFor(() => expect(quickSign().getAttribute("aria-disabled")).toBeNull());

    // One widget, one AppKit, one WalletConnect Core.
    expect(fixture.reownMounts).toBe(1);
    expect(fixture.nativePrivyMounts).toBe(runtime === "native" ? 1 : 0);
    expect(subtreeMounts).toBe(1);
    await landed(true);

    // The hand check from the Issue, in a test: five toggles.
    for (let toggle = 1; toggle <= 5; toggle++) {
      fireEvent.click(quickSign());
      await landed(toggle % 2 === 0);
    }

    // An odd number of them, so the preference has to have landed on the far
    // side — the switch followed every one, rather than quietly ignoring them.
    expect(quickSign().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("keyed-subtree-probe")).toBeTruthy();
    // Nothing was torn down to do it: not the subtree under the Privy key, and
    // not the provider that owns WalletConnect. The second is the count that
    // used to grow without bound.
    expect(subtreeMounts).toBe(1);
    expect(fixture.reownMounts).toBe(1);
    expect(fixture.nativePrivyMounts).toBe(runtime === "native" ? 1 : 0);
  }, 30_000);
});
