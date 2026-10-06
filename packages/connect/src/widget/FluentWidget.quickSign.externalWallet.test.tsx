/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for one question: what applying a stored Quick sign
 * does when a Fluent ID has an additional external wallet connected.
 *
 * The mocks follow `FluentWidget.quickSign.test.tsx`, with two differences that
 * are the whole point: the Reown wallet reports a connected EOA, and the ZeroDev
 * smart account takes a moment to become ready after every mount — exactly what
 * a real rebuild looks like, where wagmi still names the wallet while the smart
 * account is being rebuilt.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  /** Every subject the settings client was created for, in order. */
  readSubjects: [] as string[],
}));

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
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const privyTimer = setTimeout(() => setPrivyHydrated(true), privyState.hydrateMs);
        const timer = setTimeout(() => setReady(true), 30);
        return () => {
          clearTimeout(privyTimer);
          clearTimeout(timer);
        };
      }, []);
      return {
        smartAccountEnabled: true,
        smartAccountReady: ready,
        smartAccountAddress: ready ? SMART_ACCOUNT : undefined,
        signerAddress: SIGNER,
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
      return { quickSign: false, gasTokenSymbol: null, tokens: [] };
    },
    patch: async () => ({ quickSign: false, gasTokenSymbol: null, tokens: [] }),
    putToken: async () => {},
    deleteToken: async () => {},
  }),
}));

const { FluentWidget } = await import("./FluentWidget");

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  authMode: "direct",
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
  fixture.readSubjects = [];
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

  it("applies this person's stored Quick sign with one rebuild, and then stands still", async () => {
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

    // One read, the Fluent ID's, and one rebuild for its stored choice. Through
    // that rebuild the smart account is not ready, Privy is not hydrated and
    // wagmi still names the wallet; the settings subject stays the Fluent ID's,
    // so nothing applies the defaults, nothing changes the key again, and
    // nothing reads again. Before the fix, this was the loop the person saw as
    // "Connecting…": thousands of Privy mounts, the subject flipping between
    // the two (69 reads in the time this test waits).
    expect(fixture.readCalls).toBe(1);
    expect(subtreeMounts).toBe(2);
    const settled = { reads: fixture.readCalls, mounts: subtreeMounts };

    await act(() => settle());
    expect(fixture.readCalls).toBe(settled.reads);
    expect(subtreeMounts).toBe(settled.mounts);
    expect(screen.getByRole("button", { name: /0x092A/ })).toBeTruthy();
  });
});
