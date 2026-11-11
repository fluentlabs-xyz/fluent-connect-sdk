/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for a returning Fluent ID with an additional External
 * wallet connected, on a page load where the smart account fails to initialize:
 * the chain RPC is unreachable, so ZeroDev reports an error and no kernel.
 *
 * Seen on rookrift.xyz: every reload opened MetaMask on a "Fluent Login" Sign-in
 * challenge, for a person signed in with a Fluent ID. Through that window the
 * derived account kind is the wallet's, and the User settings read that follows
 * minted an Auth token for the wallet — a signature prompt for settings that
 * belong to the Fluent ID.
 *
 * Four fakes, at the external boundaries: Privy (hydrating after mount), Reown
 * AppKit (a connected wallet whose client records every signature request),
 * ZeroDev (an initialization that fails, and in one case recovers) and the
 * network (`fetch`, which records every request and answers the Sign-in
 * challenge the way the service does). The settings client, the Auth token
 * request and the widget run for real, so the assertion is on what leaves the
 * browser.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";
import { FLUENT_WIDGET_SESSION_STORAGE_KEY } from "../core/storageKeys";
import { createLocalFluentSession } from "../utils/createLocalFluentSession";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => ({
  /** Every request that left the browser, in order. */
  requests: [] as { method: string; url: string }[],
  /** Every signature the External wallet was asked for, in order. */
  signatures: [] as unknown[],
}));

/**
 * Privy as it really is on a page load: for its first ticks it is not ready,
 * names no user and holds no wallets, and only then hydrates. The widget's own
 * session is what still names the person meanwhile.
 */
const privyState = vi.hoisted(() => ({ hydrateMs: 10 }));

/**
 * ZeroDev on a page load whose chain RPC is unreachable: the initialization the
 * widget requests once Privy has hydrated fails at `failMs`, and the hook
 * reports the error with no kernel. With `recoverMs` set, the RPC is back by
 * then and the retried initialization succeeds.
 */
const zeroDevState = vi.hoisted(() => ({ failMs: 20, recoverMs: null as number | null }));

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
    // Privy 2.25.0 exposes the existing Signer the ZeroDev fake below reads.
    useWallets: () => ({
      ready: true,
      wallets: [{ address: SIGNER, walletClientType: "privy", chainType: "ethereum" }],
    }),
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
  // The additional wallet, connected from the Swap page and reconnected by
  // AppKit on this page load, with its client in hand: enough for
  // `deriveWidgetAccount` to call it an executable EOA. Its `signTypedData` is
  // what the Sign-in challenge reaches, and what MetaMask opens on.
  useReownWallet: () => ({
    configured: true,
    connected: true,
    address: EXTERNAL_WALLET,
    chainId: 20994,
    walletClient: {
      account: { address: EXTERNAL_WALLET },
      signTypedData: async (request: unknown) => {
        fixture.signatures.push(request);
        return "0xsigned";
      },
    },
    reconnecting: false,
    open: () => {},
    choices: [],
    connectChoice: async () => {},
    disconnect: () => {},
    switchChain: async () => {},
  }),
}));

vi.mock("./zerodevSession", async (importOriginal) => {
  const { useEffect, useMemo, useState } = await import("react");
  return {
    ...(await importOriginal<typeof import("./zerodevSession")>()),
    // `useFluentZeroDevAccount` 0.7.2: `initialize` runs once Privy is ready and
    // authenticated with an embedded wallet, and a failed kernel build leaves
    // `error` set, `smartAccountReady` false and no address — the initializer
    // then asks again. The fake reports the same fields on the same clock.
    useFluentZeroDevAccount: () => {
      const [privyHydrated, setPrivyHydrated] = useState(false);
      const [failed, setFailed] = useState(false);
      const [recovered, setRecovered] = useState(false);
      const error = useMemo(() => new Error("HTTP request failed: chain RPC unreachable"), []);
      useEffect(() => {
        const timers = [
          setTimeout(() => setPrivyHydrated(true), privyState.hydrateMs),
          setTimeout(() => setFailed(true), zeroDevState.failMs),
        ];
        if (zeroDevState.recoverMs !== null) {
          timers.push(setTimeout(() => setRecovered(true), zeroDevState.recoverMs));
        }
        return () => timers.forEach(clearTimeout);
      }, []);
      const ready = recovered;
      return {
        smartAccountEnabled: true,
        smartAccountReady: ready,
        smartAccountAddress: ready ? SMART_ACCOUNT : undefined,
        signerAddress: SIGNER,
        error: failed && !recovered ? error : null,
        privyReady: privyHydrated,
        privyAuthenticated: privyHydrated,
        embeddedWalletCount: privyHydrated ? 1 : 0,
        kernel: ready ? { smartAccountAddress: SMART_ACCOUNT } : null,
        refresh: async () => {
          if (ready) return { smartAccountAddress: SMART_ACCOUNT };
          throw error;
        },
        sendCalls: async () => "0x",
        ensureExecutionReady: async () => {},
      };
    },
  };
});

const { FluentWidget } = await import("./FluentWidget");

/**
 * One App per case. The Auth token cache is page-shared and keyed by App and
 * subject, and it outlives a case: a token the wallet obtained in one case would
 * answer the next case's read with no challenge at all, and the case would pass
 * over the very read it exists to rule out.
 */
function configFor(app: number): FluentWidgetConfig {
  return {
    appId: `app_${String(app).padStart(32, "0")}`,
    privyClientId: "client-test",
    network: "testnet",
    reputationEnabled: false,
    disableAnalytics: true,
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * The service and the chain, as far as this page load reaches them. The Sign-in
 * challenge is answered for the page's own origin, so that on a widget which
 * does ask the wallet, the request reaches `signTypedData` instead of failing
 * on the origin check first.
 */
function answer(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fixture.requests.push({ method: init?.method ?? "GET", url });
  if (url.endsWith("/auth/challenge")) {
    return json({
      nonce: "0xnonce",
      typedData: {
        domain: { name: "Fluent Connect Login", version: "1", chainId: 20994 },
        primaryType: "FluentLogin",
        types: { FluentLogin: [{ name: "origin", type: "string" }] },
        message: { origin: window.location.origin },
      },
    });
  }
  if (url.includes("/auth/exchange/")) {
    return json({
      token: "fluent-token",
      refreshToken: "fluent-refresh",
      refreshExpiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });
  }
  if (url.endsWith("/me/settings")) {
    return json({ quick_sign: true, gas_token_symbol: null, tokens: [] });
  }
  return json({ jsonrpc: "2.0", id: 1, result: "0x0" });
}

const challenges = () => fixture.requests.filter((r) => r.url.endsWith("/auth/challenge"));
const privyExchanges = () =>
  fixture.requests.filter((r) => r.url.endsWith("/auth/exchange/privy"));

/**
 * A returning person: the session is already in storage, so the first mount
 * knows the Fluent ID before Privy does.
 */
function storeSession(config: FluentWidgetConfig) {
  window.localStorage.setItem(
    FLUENT_WIDGET_SESSION_STORAGE_KEY,
    JSON.stringify(
      createLocalFluentSession({
        app: { mode: "registered", origin: "http://localhost", installationId: "test" },
        appId: config.appId,
        scopes: [],
        userId: "did:privy:test",
        signerAddress: SIGNER,
        smartAccountAddress: SMART_ACCOUNT,
      }),
    ),
  );
}

beforeEach(() => {
  fixture.requests = [];
  fixture.signatures = [];
  zeroDevState.recoverMs = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    answer(input, init),
  ));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/**
 * Time in these tests is the fake timers' (T6): the windows in which the widget must stand
 * still are advanced through, not slept through, and the fakes' own delays run on the same
 * clock. Only the timer functions are faked, so React's scheduler, which runs on
 * `setImmediate` and `MessageChannel`, keeps working. `vi.waitFor` is used rather than Testing
 * Library's `waitFor`, because it advances fake timers between its checks.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

/** Lets `ms` of fake time pass, running every timer that falls due within it. */
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("FluentWidget: a Fluent ID whose smart account fails, with an external wallet", () => {
  /** Long enough for the failed initialization, its retries, and the read they could release. */
  const STILL_MS = 1500;
  /** `vi.waitFor` with room for a busy tree and a loaded machine. */
  const WAIT = { timeout: 10_000 } as const;

  it("asks the External wallet for no Sign-in challenge while it fails", async () => {
    const config = configFor(1);
    storeSession(config);
    render(<FluentWidget config={config} />);
    // What the person sees: their Fluent ID, named by the session, on the button.
    await vi.waitFor(() => screen.getByRole("button", { name: /0x092A/ }), WAIT);
    await pass(STILL_MS);

    // The settings belong to the Fluent ID, and the Fluent ID cannot read them
    // yet. Nothing on this page may read them as the wallet's instead: that
    // read opens the wallet on a Sign-in challenge the person never asked for,
    // and again on every reload until they disconnect the wallet.
    expect({ challenges: challenges(), signatures: fixture.signatures }).toEqual({
      challenges: [],
      signatures: [],
    });
    expect(screen.getByRole("button", { name: /0x092A/ })).toBeTruthy();
  });

  it("reads the Fluent ID's own settings once it is back, with no challenge", async () => {
    zeroDevState.recoverMs = 300;
    const config = configFor(2);
    storeSession(config);
    render(<FluentWidget config={config} />);
    await vi.waitFor(() => screen.getByRole("button", { name: /0x092A/ }), WAIT);
    // The read that was held through the failure goes out for the Fluent ID,
    // with its Direct login: no wallet is involved.
    await vi.waitFor(() => expect(privyExchanges().length).toBeGreaterThanOrEqual(1), WAIT);
    await pass(STILL_MS);

    expect({ challenges: challenges(), signatures: fixture.signatures }).toEqual({
      challenges: [],
      signatures: [],
    });
  });
});
