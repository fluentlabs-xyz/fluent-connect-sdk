/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, with an external wallet connected, for two questions:
 * what applying a stored Quick sign does when a Fluent ID has one as an
 * addition, and what the widget does with a stored Quick sign when the external
 * wallet is the whole account.
 *
 * The mocks follow `FluentWidget.quickSign.test.tsx`, with two differences that
 * are the whole point: the Reown wallet reports a connected EOA, and the ZeroDev
 * smart account takes a moment to become ready after every mount — exactly what
 * a real rebuild looks like, where wagmi still names the wallet while the smart
 * account is being rebuilt. `accountState` turns the smart account off entirely,
 * which is the external-wallet-only account.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentUserSettings } from "../core/settingsClient";
import type { FluentWidgetConfig } from "../core/config";
import { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "../core/storageKeys";
import { createLocalFluentSession } from "../utils/createLocalFluentSession";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => ({
  readCalls: 0,
  /** Every preference write the widget sent, in order. */
  patches: [] as unknown[],
  /** Every subject the settings client was created for, in order. */
  readSubjects: [] as string[],
}));

/**
 * Whether there is a Fluent ID behind the wallet at all. Off is the
 * external-wallet-only account: no smart account, no session, so
 * `deriveWidgetAccount` resolves `type: "eoa"`.
 */
const accountState = vi.hoisted(() => ({ smartAccount: true }));

/**
 * Privy as it really is on the far side of a keyed remount: for its first ticks
 * it is not ready, names no user and holds no wallets, and only then hydrates.
 * The widget's own session is what still names the person meanwhile.
 */
const privyState = vi.hoisted(() => ({ hydrateMs: 10 }));

vi.mock("@privy-io/react-auth", async () => {
  const { useEffect, useState } = await import("react");
  const useHydrated = () => {
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => setHydrated(true), privyState.hydrateMs);
      return () => clearTimeout(timer);
    }, []);
    return hydrated;
  };
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    usePrivy: () => {
      const hydrated = useHydrated();
      return {
        ready: hydrated,
        authenticated: hydrated,
        user: hydrated ? { id: "did:privy:test" } : null,
        getAccessToken: async () => "privy-access-token",
        login: () => {},
        logout: async () => {},
      };
    },
    useIdentityToken: () => ({ identityToken: "privy-identity-token" }),
    useUser: () => ({ refreshUser: async () => {} }),
    // Linking X is not what this file is about; the widget calls the hook on every render.
    useLinkAccount: () => ({ linkTwitter: vi.fn() }),
    // Nor is registering a passkey — same reason.
    useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
    // Nor is the SIWE login a wallet's `linkX()` goes through — same reason: the widget mounts
    // the hook on every render, and only these two functions are ever read from it.
    useLoginWithSiwe: () => ({
      generateSiweMessage: vi.fn(),
      loginWithSiwe: vi.fn(),
    }),
    useWallets: () => ({ ready: true, wallets: [] }),
  useModalStatus: () => ({ isOpen: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
  Captcha: () => null,
    useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
    useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  };
});

vi.mock("./reownAppKit", () => ({
  REOWN_PROJECT_ID: "test",
  reownConfigured: true,
  ReownProvider: ({ children }: { children: unknown }) => children,
  // The additional wallet, connected for the bridge, with its client in hand:
  // enough for `deriveWidgetAccount` to call it an executable EOA.
  useReownWallet: () => ({
    configured: true,
    connected: true,
    address: EXTERNAL_WALLET,
    chainId: 20994,
    walletClient: { account: { address: EXTERNAL_WALLET } },
    reconnecting: false,
    open: () => {},
    choices: [],
    connectChoice: async () => {},
    disconnect: () => {},
    switchChain: async () => {},
  }),
}));

vi.mock("./zerodevSession", async (importOriginal) => {
  const { useEffect, useState } = await import("react");
  return {
    ...(await importOriginal<typeof import("./zerodevSession")>()),
    // A Fluent ID whose smart account is rebuilt on every mount: not ready for
    // the first renders, ready a tick later. The real hook keeps its kernels in
    // component state, so a keyed remount starts from exactly this — and reads
    // its Privy fields from a Privy that is itself still hydrating.
    useFluentZeroDevAccount: () => {
      const [privyHydrated, setPrivyHydrated] = useState(false);
      const [smartReady, setSmartReady] = useState(false);
      useEffect(() => {
        const privyTimer = setTimeout(() => setPrivyHydrated(true), privyState.hydrateMs);
        const timer = setTimeout(() => setSmartReady(true), 30);
        return () => {
          clearTimeout(privyTimer);
          clearTimeout(timer);
        };
      }, []);
      // Never ready without a Fluent ID: there is no smart account to build.
      const ready = accountState.smartAccount && smartReady;
      return {
        smartAccountEnabled: accountState.smartAccount,
        smartAccountReady: ready,
        smartAccountAddress: ready ? SMART_ACCOUNT : undefined,
        signerAddress: accountState.smartAccount ? SIGNER : undefined,
        error: null,
        privyReady: privyHydrated,
        privyAuthenticated: privyHydrated,
        embeddedWalletCount: privyHydrated ? 1 : 0,
        kernel: ready ? { smartAccountAddress: SMART_ACCOUNT } : null,
        refresh: async () => (ready ? { smartAccountAddress: SMART_ACCOUNT } : null),
        sendCalls: async () => "0x",
        ensureExecutionReady: async () => {},
      };
    },
  };
});

vi.mock("../core/settingsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/settingsClient")>()),
  createFluentSettingsClient: () => ({
    read: async (): Promise<FluentUserSettings> => {
      fixture.readCalls += 1;
      // This person's stored choice is off, which differs from the default: the
      // one condition under which applying it changes the `PrivyProvider` key.
      // It is also what an external wallet must not apply — the same row, since
      // the service resolves both of this person's sessions to one of its own.
      return { quickSign: false, gasTokenSymbol: "USDnr", tokens: [] };
    },
    patch: async (body: unknown) => {
      fixture.patches.push(body);
      return { quickSign: false, gasTokenSymbol: "USDnr", tokens: [] };
    },
    putToken: async () => {},
    deleteToken: async () => {},
  }),
}));

const { FluentWidget } = await import("./FluentWidget");

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/** Mounted by the host below the keyed `PrivyProvider`; counts its rebuilds. */
let subtreeMounts = 0;
function KeyedSubtreeProbe() {
  useEffect(() => {
    subtreeMounts += 1;
  }, []);
  return <div data-testid="keyed-subtree-probe" />;
}

beforeEach(() => {
  subtreeMounts = 0;
  fixture.readCalls = 0;
  fixture.patches = [];
  fixture.readSubjects = [];
  accountState.smartAccount = true;
  // A returning person: the session is already in storage, as it is in the tab
  // this reproduces, so the first mount knows the Fluent ID before Privy does.
  window.localStorage.setItem(
    FLUENT_WIDGET_SESSION_STORAGE_KEY,
    JSON.stringify(
      createLocalFluentSession({
        app: { mode: "registered", origin: "http://localhost", installationId: "test" },
        appId: CONFIG.appId,
        scopes: [],
        userId: "did:privy:test",
        signerAddress: SIGNER,
        smartAccountAddress: SMART_ACCOUNT,
      }),
    ),
  );
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
});

describe("FluentWidget: Quick sign with an additional external wallet", () => {
  /** Long enough for several rebuild rounds, should the widget be looping. */
  const settle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));
  /** `waitFor` with room for a busy tree and a loaded machine. */
  const WAIT = { timeout: 10_000 } as const;

  it("applies this person's stored Quick sign without a rebuild, and then stands still", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        showDebugPayload={false}
        renderHome={() => <KeyedSubtreeProbe />}
      />,
    );
    // The Fluent ID is the account on show, the wallet is an addition to it.
    await waitFor(() => screen.getByRole("button", { name: /0x092A/ }));
    await waitFor(() => expect(fixture.readCalls).toBeGreaterThanOrEqual(1));
    await act(() => settle());

    // One read, the Fluent ID's, and no rebuild at all: applying a stored Quick
    // sign no longer changes the provider key. The loop this test was written
    // for ran on rebuilds — through one the smart account was not ready, Privy
    // was not hydrated and wagmi still named the wallet, and the settings
    // subject could flip between the two, which is what the person saw as
    // "Connecting…" (69 reads in the time this test waits). With nothing torn
    // down there is no window for it to start in.
    expect(fixture.readCalls).toBe(1);
    expect(subtreeMounts).toBe(1);
    const settled = { reads: fixture.readCalls, mounts: subtreeMounts };

    await act(() => settle());
    expect(fixture.readCalls).toBe(settled.reads);
    expect(subtreeMounts).toBe(settled.mounts);
    expect(screen.getByRole("button", { name: /0x092A/ })).toBeTruthy();
  });

  it("keeps the Fluent ID's own Settings screen through a Quick sign toggle", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        showDebugPayload={false}
        renderHome={() => <KeyedSubtreeProbe />}
      />,
    );
    // Let this person's stored Quick sign be applied first, and the smart
    // account catch up: the mock builds it a tick after mount, and the frames
    // before that are the ones where the derived account kind can be the
    // wallet's.
    await waitFor(() => expect(fixture.readCalls).toBe(1), WAIT);
    await settle(400);

    // Opened by retry rather than by three clicks in a row: the menu lives below
    // the `PrivyProvider` key, and a click that lands on a frame being rebuilt
    // is simply lost. Nothing rebuilds here any more, but the retry costs
    // nothing and the next person to put a key back will be glad of it.
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /0x092A/ }), WAIT));
    await waitFor(() => {
      if (!screen.queryByRole("option", { name: "Settings" })) {
        const actions = screen.queryByLabelText("Account actions");
        if (actions) fireEvent.click(actions);
      }
      expect(screen.getByRole("option", { name: "Settings" })).toBeTruthy();
    }, WAIT);
    const settings = screen.getByRole("option", { name: "Settings" });
    fireEvent.pointerDown(settings, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(settings, { pointerType: "mouse", button: 0 });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryAllByRole("switch")).toHaveLength(1), WAIT);

    fireEvent.click(screen.getByRole("switch"));

    // Sampled rather than settled: what must never happen is a frame on which
    // this person's preferences read as an external wallet's. The toggle used to
    // open a window for exactly that — through the rebuild it caused, the smart
    // account was not ready while wagmi still named the wallet — and the window
    // is what this samples for. It is closed now by there being no rebuild at
    // all, which the count below is the whole of.
    const seen: string[] = [];
    for (let sample = 0; sample < 120; sample += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (screen.queryAllByText("Available with a Fluent smart account").length > 0) {
        seen.push(`sample ${sample}`);
      }
    }

    expect(seen).toEqual([]);
    expect(screen.getByText("Sign transactions without a confirmation popup.")).toBeTruthy();
    // One mount for the page, and the toggle did not add to it.
    expect(subtreeMounts).toBe(1);
  }, 30_000);
});

describe("FluentWidget: Settings for an external-wallet account", () => {
  /**
   * Long enough for the read, its apply and a rebuild, had one been started.
   *
   * Deliberately not wrapped in `act`, as in `FluentWidget.quickSign.test.tsx`:
   * the wallet's balance and price queries keep React busy for as long as this
   * widget lives, and `act` waits for a tree that never goes idle.
   */
  const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

  /** No Fluent ID at all: the connected external wallet is the whole account. */
  beforeEach(() => {
    accountState.smartAccount = false;
    window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
  });

  /**
   * The drawer, the account menu, then Settings — the way a person reaches it.
   * The menu is opened by retry: this widget keeps React busy, and a click that
   * lands on a frame still rendering is lost rather than queued.
   */
  async function openSettingsScreen() {
    const wait = { timeout: 10_000 } as const;
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /0x2222/ }), wait));
    await waitFor(() => {
      if (!screen.queryByRole("option", { name: "Settings" })) {
        const actions = screen.queryByLabelText("Account actions");
        if (actions) fireEvent.click(actions);
      }
      expect(screen.getByRole("option", { name: "Settings" })).toBeTruthy();
    }, wait);
    const settings = screen.getByRole("option", { name: "Settings" });
    fireEvent.pointerDown(settings, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(settings, { pointerType: "mouse", button: 0 });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryAllByRole("switch")).toHaveLength(1), wait);
  }

  it("applies neither stored preference and writes nothing, while the read still happens", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        showDebugPayload={false}
        renderHome={() => <KeyedSubtreeProbe />}
      />,
    );
    // The external wallet is the account on show: there is no Fluent ID.
    await waitFor(() => screen.getByRole("button", { name: /0x2222/ }));
    // The read is still made — this account's token list rides on it.
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await settle();

    // The row's `quickSign: false` differs from the widget's default, so
    // applying it would change the `PrivyProvider` key and rebuild the subtree.
    // It is not applied, so the subtree is mounted once and only once.
    expect(subtreeMounts).toBe(1);
    // And nothing was written back for either preference, on any path.
    expect(fixture.patches).toEqual([]);
    expect(fixture.readCalls).toBe(1);
  });

  it("shows both preferences disabled, hides the faucet and points Explorer at the EOA", async () => {
    render(
      <FluentWidget
        config={CONFIG}
        showDebugPayload={false}
        renderHome={() => <KeyedSubtreeProbe />}
      />,
    );
    await waitFor(() => expect(fixture.readCalls).toBe(1), { timeout: 10_000 });
    await openSettingsScreen();
    await settle();

    const quickSign = screen.getByRole("switch");
    expect(quickSign.getAttribute("aria-disabled")).toBe("true");
    expect(quickSign.getAttribute("aria-checked")).toBe("false");
    const gasPayment = screen.getByRole("combobox");
    expect(gasPayment.hasAttribute("disabled")).toBe(true);
    // The row holds `USDnr`, which this account could never be charged in.
    expect(gasPayment.textContent).toContain("ETH");
    expect(screen.getAllByText("Available with a Fluent smart account")).toHaveLength(2);
    expect(screen.queryByText("Faucet")).toBeNull();
    expect(screen.getByText("View account on explorer")).toBeTruthy();
    // Still nothing written: reaching the screen is not a choice.
    expect(fixture.patches).toEqual([]);
  });
});
