/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for the half of `linkX()` that cannot live in the core: the return
 * gate, the identity-token refresh over Privy's hooks, the marker's ownership, and — for an
 * external wallet — the SIWE sign-in over Privy's headless hook, the pre-link logout of a Privy
 * session that is another wallet's, and the guards that keep that session from becoming a
 * Fluent ID.
 *
 * Four modules are mocked — Privy, the Reown/wagmi provider, the ZeroDev smart account and the
 * settings client — exactly as in `FluentWidget.quickSign.test.tsx`, and `fetch` is routed by
 * URL in `beforeEach`. Everything between them is the widget's own code: the adapter in
 * `FluentWidgetContent`, the core action, `useAuthToken` and `useLinkX`.
 *
 * The Privy and Reown mocks are a fixture the cases move and a `rerender` they drive: that is
 * what a page coming back from the X redirect looks like from inside React — a user restored on
 * a later commit, with an X account on it that was not there before, and a wallet whose client
 * the connector hands over a commit after it has named the address.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  type FluentWidgetConfig,
} from "../core/config";
import {
  FLUENT_LINK_X_MARKER_KEY,
  type FluentLinkXPrivyUser,
  type FluentLinkXResult,
} from "../core/linkX";
import { FluentAuthError } from "../core/authToken";
import { refreshCredentialStorageKey } from "../core/refreshCredentialStore";
import { FluentSettingsError, type FluentUserSettings } from "../core/settingsClient";

// The demo consumes the package entry; use the same source instance as the widget under test.
vi.mock("@fluent.xyz/connect", async () => import("../index"));
const { AuthPanel } = await import("../../../../apps/auth-demo/src/components/AuthPanel");

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const PRIVY_USER = "did:privy:owner";
const OTHER_PRIVY_USER = "did:privy:someone-else";
/** The audience the testnet config below resolves to; the token cache and the refresh credential are keyed on it. */
const PUBLIC_API_URL = FLUENT_CONNECT_TESTNET_PUBLIC_API_URL;
/**
 * The external wallet, spelled as wagmi hands it to a host — lowercase — and in the EIP-55 form
 * Privy's SIWE is declared for. The two differ, which is what the normalization cases need.
 */
const EOA_CHECKSUM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
const EOA = EOA_CHECKSUM.toLowerCase();
const OTHER_EOA = "0x3333333333333333333333333333333333333333" as const;
/** The Privy users SIWE signs the wallets in as. */
const WALLET_PRIVY_USER = "did:privy:wallet-owner";
const OTHER_WALLET_PRIVY_USER = "did:privy:other-wallet-owner";
const TESTNET_CHAIN_ID = 20994;
const SIWE_MESSAGE = "localhost wants you to sign in with your Ethereum account:\n0x5aAe…\n\nNonce: n-1";
const SIWE_SIGNATURE = "0xsiwe-signature";
/** The bounds `FluentWidgetContent` holds a Privy step and the wallet's signature prompt to. */
const SIWE_STEP_TIMEOUT_MS = 10_000;
const WALLET_SIGNATURE_TIMEOUT_MS = 5 * 60_000;
/** Where the widget arms the Fluent ID sign-in intent that survives the OAuth reload. */
const DIRECT_LOGIN_INTENT_KEY = "fluent:widget:direct-login-intent:v1";

const X_ACCOUNT = {
  id: "1458",
  handle: "fluentxyz",
  avatarUrl: "https://pbs.twimg.com/profile_images/1458/avatar.jpg",
};

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => {
  const googleEntry = { type: "google_oauth", subject: "google-1" };
  const xEntry = { type: "twitter_oauth", subject: "1458", username: "fluentxyz" };
  let minted = 0;
  /**
   * A fresh identity token, as Privy really mints them: `refreshUser()` fetches the user and
   * gets a newly signed token every time, so the bytes always change even when the linked
   * accounts in it do not.
   */
  const mintIdentityToken = (hasX: boolean): string => {
    minted += 1;
    const payload = btoa(
      JSON.stringify({
        sub: "did:privy:owner",
        iat: 1_759_800_000 + minted,
        linked_accounts: JSON.stringify(hasX ? [googleEntry, xEntry] : [googleEntry]),
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
  };

  /**
   * Privy's identity-token store, as a store rather than a value — which is what it is in
   * 2.25.0 (`storeIdentityToken` does a synchronous `setState`, and `useIdentityToken()` is a
   * subscriber). The publication *timing* is the whole subject of the refresh adapter, so
   * mocking it as a plain render value would test the wrong thing.
   */
  const identityTokens = {
    value: "",
    listeners: new Set<() => void>(),
  };

  type LinkedAccount = { type: string; chainType?: string; address?: string };

  return {
    realReown: false,
    reownConfig: null as import("wagmi").Config | null,
    reownConnect: vi.fn(),
    reownSavedConnection: undefined as { address?: string } | undefined,
    reownStartup: Promise.resolve(),
    mintIdentityToken,
    identityTokens,
    setIdentityToken: (next: string) => {
      identityTokens.value = next;
      for (const notify of [...identityTokens.listeners]) notify();
    },
    /** Whether the ZeroDev smart account is back yet. A reload takes seconds over it. */
    smartAccountReady: true,
    /** The embedded wallets the ZeroDev hook counts on the Privy user. */
    embeddedWalletCount: 1,
    /** Every `smartAccount.refresh()` — a kernel being built on an embedded wallet. */
    zerodevRefreshCalls: 0,
    /** Whether a `refresh()` succeeds — builds the kernel — should anything ask for one. */
    refreshCompletesInitialization: false,
    /** What the mocked Privy reports on the next render. */
    privy: {
      ready: true,
      authenticated: true,
      userId: "did:privy:owner" as string | undefined,
      linkedAccounts: [googleEntry] as LinkedAccount[],
    },
    /** The callbacks `useLinkAccount` was last given, so a case can fire Privy's own onError. */
    linkAccountCallbacks: null as { onSuccess?: unknown; onError?: (code: string, details: unknown) => void } | null,
    /** Every `linkTwitter()` Privy's guard let through: the count, and the user of the render each came from. */
    linkTwitterCalls: 0,
    linkTwitterRenders: [] as Array<string | undefined>,
    /** The navigations to X Privy requested — what a real `linkTwitter()` ends in. */
    navigations: 0,
    /** What happens between `linkTwitter()` and the navigation. Set per case; a case that holds Privy returns a promise. */
    onLinkTwitter: (() => {}) as () => void | Promise<void>,
    refreshUserCalls: 0,
    /** What `refreshUser()` does to the fixture. Set per case. */
    onRefreshUser: (() => {}) as () => void,
    /**
     * Privy's `logout()`: how many, and what it does to the fixture. Set per case; a case that
     * holds Privy's own promise — a logout still pending — returns one.
     */
    logoutCalls: 0,
    onLogout: (() => {}) as () => void | Promise<void>,
    /** Privy's headless SIWE, as `useLoginWithSiwe` hands it out. */
    siwe: {
      message: "",
      generateCalls: [] as Array<{ address: string; chainId: string }>,
      loginCalls: [] as Array<{ message: string; signature: string }>,
      /** What `generateSiweMessage` resolves. Set per case; a case that holds Privy returns a promise. */
      onGenerate: (() => "") as () => string | Promise<string>,
      /**
       * What `loginWithSiwe` resolves, and what it does to the fixture. Set per case; a case
       * that needs the page to commit before the login answers returns a promise.
       */
      onLogin: (() => ({ id: "", linkedAccounts: [] })) as () => FluentLinkXPrivyUser | Promise<FluentLinkXPrivyUser>,
    },
    /** The Reown wallet as the connector reports it on the next render. */
    wallet: {
      connected: false,
      address: undefined as string | undefined,
      /** Whether the connector has handed over the client yet; it comes a commit after the address. */
      hasClient: true,
      /** Whether wagmi is still reconnecting the wallet from storage, as it is for a page's first ticks. */
      reconnecting: false,
      disconnectCalls: 0,
      signMessageCalls: [] as Array<{ account: string; message: string }>,
      /** What `signMessage` does. Set per case; the default signs. */
      onSignMessage: (() => "0xsiwe-signature") as () => string | Promise<string>,
      /** Every typed-data signature: the Fluent token's challenge, which mints the wallet's token. */
      signTypedDataCalls: 0,
      /** What `signTypedData` does. Set per case; the default signs. */
      onSignTypedData: (() => "0xfluent-challenge-signature") as () => string,
    },
    /**
     * The order of the side effects a wallet's `linkX()` is held to: Privy's logout, the three
     * SIWE steps, the challenge signature that mints the wallet's Fluent token (absent when a
     * usable token is cached), the marker, the redirect.
     */
    journal: [] as string[],
  };
});

vi.mock("@privy-io/react-auth", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (notify: () => void) => {
    fixture.identityTokens.listeners.add(notify);
    return () => {
      fixture.identityTokens.listeners.delete(notify);
    };
  };
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    usePrivy: () => ({
      ready: fixture.privy.ready,
      authenticated: fixture.privy.authenticated,
      user: fixture.privy.userId
        ? {
            id: fixture.privy.userId,
            linkedAccounts: fixture.privy.linkedAccounts,
          }
        : null,
      getAccessToken: async () => "privy-access-token",
      login: () => {},
      logout: async () => {
        fixture.logoutCalls += 1;
        fixture.journal.push("logout");
        await fixture.onLogout();
      },
    }),
    /**
     * As in 2.25.0: `loginWithSiwe` refuses while the render that created it had a user. The
     * fixture is read when the hook runs, not when the function is called, so a `linkX()` that
     * kept the function of the render before a logout is told `User already authenticated` —
     * exactly what the adapter's call-time thunks exist to avoid.
     */
    useLoginWithSiwe: () => {
      const userAtRender = fixture.privy.userId;
      return {
        generateSiweMessage: async ({ address, chainId }: { address: string; chainId: string }) => {
          fixture.siwe.generateCalls.push({ address, chainId });
          fixture.journal.push("generateSiweMessage");
          return fixture.siwe.onGenerate();
        },
        generateSiweNonce: async () => "n-1",
        loginWithSiwe: async ({ message, signature }: { message: string; signature: string }) => {
          if (userAtRender) throw new Error("User already authenticated");
          fixture.siwe.loginCalls.push({ message, signature });
          fixture.journal.push("loginWithSiwe");
          return fixture.siwe.onLogin();
        },
        state: { status: "initial" },
      };
    },
    useIdentityToken: () => ({
      identityToken: useSyncExternalStore(
        subscribe,
        () => fixture.identityTokens.value,
        () => fixture.identityTokens.value,
      ),
    }),
    useUser: () => ({
      refreshUser: async () => {
        fixture.refreshUserCalls += 1;
        fixture.onRefreshUser();
      },
    }),
    /**
     * As in 2.25.0: `linkTwitter` is an `async` function that closes over the `authenticated`
     * of the render that made it. From a render with nobody signed in it raises
     * `onError(must_be_authenticated)` and throws — inside the async function, so the caller
     * gets a rejected promise and no navigation. From a signed-in render it requests the
     * navigation to X and resolves once it has. The fixture is read when the hook runs, not
     * when the function is called, so a `linkX()` that kept the `linkTwitter` of the render it
     * started on — before SIWE signed anybody in — is refused exactly as the real SDK refuses
     * it, which is the bug the adapter's call-time read exists to prevent.
     */
    useLinkAccount: (callbacks?: {
      onSuccess?: unknown;
      onError?: (code: string, details: unknown) => void;
    }) => {
      fixture.linkAccountCallbacks = callbacks ?? null;
      const authenticatedAtRender = fixture.privy.authenticated;
      const userAtRender = fixture.privy.userId;
      return {
        linkTwitter: async () => {
          if (!authenticatedAtRender) {
            fixture.journal.push("linkTwitter:must_be_authenticated");
            fixture.linkAccountCallbacks?.onError?.("must_be_authenticated", { linkMethod: "twitter" });
            throw new Error("User must be authenticated before linking an account.");
          }
          fixture.linkTwitterCalls += 1;
          fixture.linkTwitterRenders.push(userAtRender);
          fixture.journal.push("linkTwitter");
          await fixture.onLinkTwitter();
          fixture.navigations += 1;
        },
      };
    },
    useWallets: () => ({ ready: true, wallets: [] }),
    useModalStatus: () => ({ isOpen: false }),
    // A promise, as Privy's is: the connect modal chains on it while a login is "connecting".
    // In the journal: the modal creates one for whoever Privy reports once a method has run.
    useCreateWallet: () => ({
      createWallet: async () => {
        fixture.journal.push("createWallet");
        return {};
      },
    }),
    useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
    // The connect modal's Fluent methods, in the journal: what a wallet user's sign-out gates.
    useLoginWithOAuth: () => ({
      initOAuth: async ({ provider }: { provider: string }) => {
        fixture.journal.push(`initOAuth:${provider}`);
      },
      state: { status: "initial" },
    }),
    useLoginWithPasskey: () => ({
      loginWithPasskey: async () => {
        fixture.journal.push("loginWithPasskey");
      },
    }),
    Captcha: () => null,
    useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
    useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  };
});

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: async () => {} }),
  createAppKit: ({ adapters }: { adapters: Array<{
    syncConnection(params: { id: string; chainId: number }): Promise<{ address?: string }>;
    syncConnections(): Promise<void>;
  }> }) => {
    // Match AppKit's saved-connection sync before its aggregate reconnect pass.
    fixture.reownStartup = Promise.resolve().then(async () => {
      fixture.reownSavedConnection = await adapters[0]!.syncConnection({ id: "io.metamask", chainId: 20994 });
      await adapters[0]!.syncConnections();
    });
  },
}));

vi.mock("@reown/appkit-adapter-wagmi", async () => {
  const { createConfig, createStorage, http } = await import("wagmi");
  const { mock } = await import("wagmi/connectors");
  const { getConnections } = await import("wagmi/actions");
  const { version } = await import("@wagmi/core");
  return {
    WagmiAdapter: class {
      wagmiConfig;
      constructor(options: { networks: readonly [import("viem").Chain, ...import("viem").Chain[]]; ssr: boolean }) {
        const saved = new Map<string, string>();
        const address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
        this.wagmiConfig = createConfig({
          ssr: options.ssr, chains: options.networks,
          transports: Object.fromEntries(options.networks.map(chain => [chain.id, http()])),
          multiInjectedProviderDiscovery: false,
          storage: createStorage({ storage: {
            getItem: async key => saved.get(key) ?? null,
            setItem: (key, value) => { saved.set(key, value); },
            removeItem: key => { saved.delete(key); },
          } }),
          connectors: [params => {
            const connector = mock({ accounts: [address] })(params);
            return {
              ...connector, id: "io.metamask", type: "injected",
              isAuthorized: async () => true,
              getAccounts: async () => [address],
              connect: async (parameters) => {
                fixture.reownConnect();
                return connector.connect(parameters);
              },
            };
          }],
        });
        // Persisted state only: no connected in-memory wallet or wallet prop on return.
        void this.wagmiConfig.storage!.setItem("store", {
          // wagmi versions persisted state by its package major version.
          version: Number.parseInt(version.split(".")[0]!, 10),
          state: {
            chainId: options.networks[0].id, current: "outgoing-page",
            connections: new Map([["outgoing-page", {
              accounts: [address], chainId: options.networks[0].id,
              connector: { id: "io.metamask", type: "injected", uid: "outgoing-page" },
            }]]),
          },
        });
        fixture.reownConfig = this.wagmiConfig;
      }
      async syncConnection({ id }: { id: string }) {
        const connection = getConnections(this.wagmiConfig).find(c => c.connector.id === id);
        const provider = await this.wagmiConfig.connectors.find(c => c.id === id)?.getProvider();
        return { address: connection?.accounts[0], chainId: connection?.chainId, provider };
      }
    },
  };
});

vi.mock("./reownAppKit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reownAppKit")>();
  return ({
  REOWN_PROJECT_ID: "test",
  reownConfigured: true,
  ReownProvider: (props: import("react").ComponentProps<typeof actual.ReownProvider>) =>
    fixture.realReown ? <actual.ReownProvider {...props} /> : props.children,
  // The external wallet as wagmi reports it: an address first, its client a commit later. The
  // client signs — `personal_sign` for SIWE, typed data for the Fluent token's challenge — and
  // records the account it was asked to sign with.
  useReownWallet: () => {
    if (fixture.realReown) return actual.useReownWallet();
    const { connected, address, hasClient } = fixture.wallet;
    return {
      configured: true,
      connected,
      address,
      chainId: TESTNET_CHAIN_ID,
      walletClient:
        connected && address && hasClient
          ? {
              account: { address },
              signMessage: async ({ account, message }: { account: string; message: string }) => {
                fixture.wallet.signMessageCalls.push({ account, message });
                fixture.journal.push("sign");
                return fixture.wallet.onSignMessage();
              },
              signTypedData: async () => {
                fixture.wallet.signTypedDataCalls += 1;
                fixture.journal.push("signChallenge");
                return fixture.wallet.onSignTypedData();
              },
            }
          : undefined,
      reconnecting: fixture.wallet.reconnecting,
      open: () => {},
      choices: [],
      connectChoice: async () => {},
      disconnect: () => {
        fixture.wallet.disconnectCalls += 1;
      },
      switchChain: async () => {},
    };
  },
});
});

vi.mock("./zerodevSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zerodevSession")>()),
  useFluentZeroDevAccount: () => ({
    smartAccountEnabled: true,
    smartAccountReady: fixture.smartAccountReady,
    smartAccountAddress: fixture.smartAccountReady ? SMART_ACCOUNT : undefined,
    signerAddress: SIGNER,
    error: null,
    privyReady: fixture.privy.ready,
    privyAuthenticated: fixture.privy.authenticated,
    embeddedWalletCount: fixture.embeddedWalletCount,
    kernel: fixture.smartAccountReady ? { smartAccountAddress: SMART_ACCOUNT } : null,
    refresh: async () => {
      fixture.zerodevRefreshCalls += 1;
      if (fixture.refreshCompletesInitialization) fixture.smartAccountReady = true;
      return fixture.smartAccountReady ? { smartAccountAddress: SMART_ACCOUNT } : null;
    },
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

vi.mock("../core/settingsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/settingsClient")>()),
  // Not what this file is about: a controller that never answers would keep the widget asking.
  createFluentSettingsClient: () => ({
    read: async () => {
      throw new FluentSettingsError("internal", "unreachable", 500);
    },
    patch: async () => {
      throw new FluentSettingsError("internal", "unreachable", 500);
    },
    putToken: async () => {},
    deleteToken: async () => {},
  } as unknown as { read: () => Promise<FluentUserSettings> }),
}));

const { FluentWidget } = await import("./FluentWidget");
const { useLinkX } = await import("../index");
const { authTokenCacheKey, resetAuthTokenSessions } = await import("./hooks/useAuthToken");
const { useFluentWidget } = await import("./widgetContext");
type FluentWidgetRenderContext = import("./FluentWidget").FluentWidgetRenderContext;

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  authMode: "direct",
  reputationEnabled: false,
  disableAnalytics: true,
};

/** Every `POST /me/identity/privy` the widget made, and what the next one answers. */
const wire = {
  identityPosts: [] as Array<{ url: string; init: RequestInit }>,
  profilePosts: 0,
  profileResponse: () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: null }),
  identityResponse: (): Response | Promise<Response> => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT }),
  /** The Fluent token's two families: a Fluent ID's Privy exchange, a wallet's challenge. */
  privyExchanges: 0,
  challenges: 0,
  walletExchanges: 0,
  /** Renewals from a stored refresh credential: no wallet prompt, no Privy. */
  refreshes: 0,
  /** What would end a session: a refresh-family revoke. */
  revokes: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A Fluent token the auth-token cache can read an expiry out of. */
function fluentToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
}

/** What the probe below publishes, so a case can read the context and the hook from outside. */
let probe: {
  linkX: FluentWidgetRenderContext["linkX"];
  getAuthToken: FluentWidgetRenderContext["getAuthToken"];
  /** The host's way to the connect modal, where a wallet user may choose a Fluent ID. */
  openConnect: FluentWidgetRenderContext["openConnect"];
  /** The account as the host sees it on the latest render. */
  account: FluentWidgetRenderContext["widget"]["account"] | null;
  /** The connection status as the host sees it on the latest render. */
  status: FluentWidgetRenderContext["status"] | null;
  hook: ReturnType<typeof useLinkX> | null;
} = {
  linkX: async () => ({ status: "redirecting" }),
  getAuthToken: async () => "",
  openConnect: () => {},
  account: null,
  status: null,
  hook: null,
};

/** Every connection status the host was shown, in render order: what a case holds "never `connecting`" to. */
let renderedStatuses: string[] = [];

function ContextProbe() {
  const ctx = useFluentWidget();
  renderedStatuses.push(ctx.status);
  probe = {
    linkX: ctx.linkX,
    getAuthToken: ctx.getAuthToken,
    openConnect: ctx.openConnect,
    account: ctx.widget.account,
    status: ctx.status,
    hook: probe.hook,
  };
  return <div data-testid="context-probe" />;
}

function HookProbe() {
  const ctx = useFluentWidget();
  const hook = useLinkX();
  renderedStatuses.push(ctx.status);
  probe = {
    linkX: ctx.linkX,
    getAuthToken: ctx.getAuthToken,
    openConnect: ctx.openConnect,
    account: ctx.widget.account,
    status: ctx.status,
    hook,
  };
  return <div data-testid="hook-probe" data-status={hook.status} />;
}

/** Every session the widget set — through `setSession`, which is the only way one changes. */
let sessionChanges: Array<unknown> = [];

function renderWidget(options: { withHook: boolean; authMode?: "direct" | "hosted"; debug?: boolean; withDemo?: boolean }) {
  const config = { ...CONFIG, authMode: options.authMode ?? "direct" } as FluentWidgetConfig;
  // A fresh element per render pass on purpose: handed the very same element object, React
  // bails out of the subtree, and these cases move the mocked Privy rather than any prop.
  // `debug` mounts the debug panel, which is where the connect status is shown.
  const element = () => (
    <FluentWidget
      config={config}
      showDebugPayload={options.debug ?? false}
      onSessionChange={(session) => {
        sessionChanges.push(session);
      }}
      renderHome={(ctx) => options.withDemo ? <><ContextProbe /><AuthPanel ctx={ctx} /></> : (options.withHook ? <HookProbe /> : <ContextProbe />)}
    />
  );
  const result = render(element());
  return { ...result, rerenderWidget: () => result.rerender(element()) };
}

/** A stored session for the Privy user the cases sign in as. */
function seedSession(userId = PRIVY_USER) {
  window.localStorage.setItem(
    FLUENT_WIDGET_SESSION_STORAGE_KEY,
    JSON.stringify({
      app: { id: CONFIG.appId, name: "test", origin: "http://localhost" },
      appId: CONFIG.appId,
      idToken: "mock.e30.signature",
      user: { id: userId },
      wallet: { signerAddress: SIGNER, smartAccountAddress: SMART_ACCOUNT },
      scopes: [],
      issuedAt: Math.floor(Date.now() / 1000),
      metadata: { authMode: "direct", origin: "http://localhost" },
    }),
  );
}

function seedMarker(raw: string) {
  window.sessionStorage.setItem(FLUENT_LINK_X_MARKER_KEY, raw);
}

/** Where `useAuthToken` keeps the wallet's refresh credential: keyed on `wallet:<lowercased>`. */
function walletRefreshCredentialKey(address: string = EOA): string {
  return refreshCredentialStorageKey(
    authTokenCacheKey({ publicApiUrl: PUBLIC_API_URL, appId: CONFIG.appId, subject: `wallet:${address.toLowerCase()}` }),
  );
}

/** A page that minted the wallet's token on an earlier load: its refresh credential is stored. */
function seedWalletRefreshCredential(address: string = EOA) {
  window.localStorage.setItem(
    walletRefreshCredentialKey(address),
    JSON.stringify({ v: 1, refreshToken: "wallet-refresh", refreshExpiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }),
  );
}

/** The connect status as the debug panel shows it (`renderWidget({ debug: true })`). */
function connectStatus(): string | null {
  for (const pre of Array.from(document.querySelectorAll("pre"))) {
    try {
      const parsed = JSON.parse(pre.textContent ?? "") as { status?: unknown };
      if (typeof parsed.status === "string") return parsed.status;
    } catch {
      // The session dump, or not JSON at all.
    }
  }
  return null;
}

/** Whether the connect modal is on screen. */
function connectModalOpen(): boolean {
  return screen.queryAllByRole("dialog").length > 0;
}

function storedMarker(): string | null {
  return window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY);
}

/** The adapter made no progress: nothing refreshed, nothing sent, nothing redirected again. */
function expectNoWork() {
  expect(fixture.refreshUserCalls).toBe(0);
  expect(fixture.linkTwitterCalls).toBe(0);
  expect(wire.identityPosts).toHaveLength(0);
}

/** No SIWE step ran: no message, no signature prompt, no login. */
function expectNoSiwe() {
  expect(fixture.siwe.generateCalls).toHaveLength(0);
  expect(fixture.wallet.signMessageCalls).toHaveLength(0);
  expect(fixture.siwe.loginCalls).toHaveLength(0);
}

/**
 * Nothing about the Fluent user changed (criterion 2): the connected account is still the
 * wallet, no Fluent session was created or set, no Privy-auth exchange ran, no refresh family
 * was revoked, and the wallet was not disconnected — which is to say neither the direct-auth
 * exchange nor `handleDisconnect` ran, observed by what each would have done.
 */
function expectWalletUserUnchanged() {
  expect(probe.account?.type).toBe("eoa");
  expect(probe.account?.address).toBe(fixture.wallet.address);
  expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
  expect(sessionChanges).toEqual([]);
  expect(wire.privyExchanges).toBe(0);
  expect(wire.revokes).toBe(0);
  expect(fixture.wallet.disconnectCalls).toBe(0);
  expect(fixture.zerodevRefreshCalls).toBe(0);
}

beforeEach(() => {
  resetAuthTokenSessions();
  window.localStorage.clear();
  window.sessionStorage.clear();
  wire.identityPosts = [];
  wire.profilePosts = 0;
  wire.profileResponse = () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: null });
  wire.identityResponse = () =>
    jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT });
  wire.privyExchanges = 0;
  wire.challenges = 0;
  wire.walletExchanges = 0;
  wire.refreshes = 0;
  wire.revokes = 0;
  fixture.smartAccountReady = true;
  fixture.embeddedWalletCount = 1;
  fixture.zerodevRefreshCalls = 0;
  fixture.refreshCompletesInitialization = false;
  fixture.privy.ready = true;
  fixture.privy.authenticated = true;
  fixture.privy.userId = PRIVY_USER;
  fixture.privy.linkedAccounts = [{ type: "google_oauth" }];
  fixture.identityTokens.value = fixture.mintIdentityToken(false);
  fixture.identityTokens.listeners.clear();
  fixture.linkAccountCallbacks = null;
  fixture.linkTwitterCalls = 0;
  fixture.linkTwitterRenders = [];
  fixture.navigations = 0;
  fixture.onLinkTwitter = () => {};
  fixture.refreshUserCalls = 0;
  // What a real `refreshUser()` does: the user GET answers with a newly signed identity token,
  // and the store publishes it. Cases that link X swap in one that carries the X account.
  fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(false));
  fixture.logoutCalls = 0;
  // What a real `logout()` does: Privy's next render reports nobody.
  fixture.onLogout = () => privySignedOut();
  fixture.siwe.message = SIWE_MESSAGE;
  fixture.siwe.onGenerate = () => fixture.siwe.message;
  fixture.siwe.generateCalls = [];
  fixture.siwe.loginCalls = [];
  // What a real `loginWithSiwe()` does: Privy's next render reports the wallet's user, and the
  // call resolves that user — with the wallet among its linked accounts.
  fixture.siwe.onLogin = () => privySignedInBySiwe(EOA);
  fixture.realReown = false;
  fixture.reownConnect.mockClear();
  fixture.wallet.connected = false;
  fixture.wallet.address = undefined;
  fixture.wallet.hasClient = true;
  fixture.wallet.reconnecting = false;
  fixture.wallet.disconnectCalls = 0;
  fixture.wallet.signMessageCalls = [];
  fixture.wallet.onSignMessage = () => SIWE_SIGNATURE;
  fixture.wallet.signTypedDataCalls = 0;
  fixture.wallet.onSignTypedData = () => "0xfluent-challenge-signature";
  fixture.journal = [];
  sessionChanges = [];
  renderedStatuses = [];
  probe = {
    linkX: async () => ({ status: "redirecting" }),
    getAuthToken: async () => "",
    openConnect: () => {},
    account: null,
    status: null,
    hook: null,
  };

  // The marker write, in the journal, so a case can hold the SIWE steps to their order against
  // it; the direct-login intent too, so a case can hold a Fluent method to running after it.
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === FLUENT_LINK_X_MARKER_KEY) fixture.journal.push("marker");
    if (key === DIRECT_LOGIN_INTENT_KEY) fixture.journal.push("intent");
    setItem.call(this, key, value);
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/me/identity/privy")) {
        wire.identityPosts.push({ url, init: init ?? {} });
        return wire.identityResponse();
      }
      if (url.includes("/me/profile")) {
        wire.profilePosts += 1;
        return wire.profileResponse();
      }
      if (url.endsWith("/auth/exchange/privy")) {
        wire.privyExchanges += 1;
        return jsonResponse({ token: fluentToken(), refreshToken: "r", refreshExpiresAt: 1 });
      }
      // The wallet's family: a challenge bound to this page, then the exchange of its signature.
      if (url.endsWith("/auth/challenge")) {
        wire.challenges += 1;
        const { address } = JSON.parse(String(init?.body)) as { address: string };
        return jsonResponse({
          nonce: "challenge-nonce",
          typedData: {
            domain: { name: "Fluent", version: "1", chainId: TESTNET_CHAIN_ID },
            primaryType: "FluentLogin",
            types: { FluentLogin: [{ name: "origin", type: "string" }] },
            message: { origin: window.location.origin, address, nonce: "challenge-nonce" },
          },
        });
      }
      if (url.endsWith("/auth/exchange/wallet")) {
        wire.walletExchanges += 1;
        return jsonResponse({
          token: fluentToken(),
          refreshToken: "wallet-refresh",
          refreshExpiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        });
      }
      if (url.endsWith("/auth/refresh")) {
        wire.refreshes += 1;
        return jsonResponse({
          token: fluentToken(),
          refreshToken: "wallet-refresh-rotated",
          refreshExpiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        });
      }
      if (url.endsWith("/auth/revoke")) {
        wire.revokes += 1;
        return jsonResponse({});
      }
      // Balances, prices and anything else the widget reaches for: not this file's subject.
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x0" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Privy reports nobody: the state a `logout()` leaves, and a page nobody has signed in on. */
function privySignedOut() {
  fixture.privy.authenticated = false;
  fixture.privy.userId = undefined;
  fixture.privy.linkedAccounts = [];
}

/** A Privy user's external Ethereum wallet entry, as `user.linkedAccounts` carries one SIWE made. */
function walletEntry(address: string) {
  return { type: "wallet", chainType: "ethereum", address };
}

/** A Privy embedded wallet entry, marked as Privy marks one: `walletClientType: "privy"`. */
function embeddedWalletEntry(address: string) {
  return { type: "wallet", chainType: "ethereum", address, walletClientType: "privy", connectorType: "embedded" };
}

/**
 * Privy reports the wallet's own user, signed in by SIWE: the wallet among its linked accounts
 * and no embedded one. Returns what `loginWithSiwe` resolves.
 */
function privySignedInBySiwe(
  address: string,
  options: { userId?: string; hasX?: boolean; embeddedWallet?: boolean } = {},
): FluentLinkXPrivyUser {
  const linkedAccounts = [
    walletEntry(address),
    ...(options.embeddedWallet ? [embeddedWalletEntry(SIGNER)] : []),
    ...(options.hasX ? [{ type: "twitter_oauth" }] : []),
  ];
  fixture.privy.ready = true;
  fixture.privy.authenticated = true;
  fixture.privy.userId = options.userId ?? WALLET_PRIVY_USER;
  fixture.privy.linkedAccounts = linkedAccounts;
  fixture.embeddedWalletCount = options.embeddedWallet ? 1 : 0;
  return { id: fixture.privy.userId, linkedAccounts };
}

/** An external wallet connected, with no Fluent ID anywhere: no session, no smart account. */
function connectWallet(address: string = EOA, options: { hasClient?: boolean } = {}) {
  fixture.wallet.connected = true;
  fixture.wallet.address = address;
  fixture.wallet.hasClient = options.hasClient ?? true;
  fixture.smartAccountReady = false;
  fixture.embeddedWalletCount = 0;
}


/**
 * Let React commit whatever is waiting, repeatedly.
 *
 * Every path through the identity-token refresh needs this *separately* from awaiting the call:
 * React's async `act` awaits the thenable it is handed **before** flushing its work queue, so
 * `await act(() => linkX())` deadlocks — the commit the refresh is waiting for is the one `act`
 * will not perform until the call it is awaiting has already finished. A browser commits on its
 * own; a test has to ask. Repeated because one `linkX()` can need several: the return gate's
 * signal, the refreshed token, and the hook's own state.
 */
async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {});
  }
}

/**
 * Commit until something has happened, rather than a fixed number of times. One `linkX()` is a
 * chain of commits and promises — the gate's signal, the refreshed token, the request, the
 * hook's state — and under `IS_REACT_ACT_ENVIRONMENT` nothing in it moves between them unless a
 * test asks, so awaiting the call outside `act` would wait for a commit that is never scheduled.
 */
async function flushUntil(done: () => boolean, rounds = 25): Promise<void> {
  for (let round = 0; round < rounds && !done(); round += 1) {
    await act(async () => {});
  }
}

/** One `linkX()`, with the commits it needs, and its answer. */
async function linkXNow(): Promise<FluentLinkXResult> {
  let answer: FluentLinkXResult | null = null;
  const pending = probe.linkX();
  void pending.then((result) => {
    answer = result;
  }, () => undefined);
  await flushUntil(() => answer !== null);
  return pending;
}

/** One `linkX()` that is expected to refuse. */
async function linkXRefusal(): Promise<FluentAuthError> {
  let answer: FluentAuthError | null = null;
  const pending = probe.linkX().then(
    () => null,
    (err: FluentAuthError) => {
      answer = err;
      return err;
    },
  );
  await flushUntil(() => answer !== null);
  const error = await pending;
  if (!error) throw new Error("expected linkX() to reject");
  return error;
}

/** What a `linkX()` left in flight rejected with, once it has — with the commits it needs. */
async function refusalOf(pending: Promise<unknown>): Promise<FluentAuthError> {
  let answer: FluentAuthError | null = null;
  const settled = pending.then(
    () => null,
    (err: FluentAuthError) => {
      answer = err;
      return err;
    },
  );
  await flushUntil(() => answer !== null);
  const error = await settled;
  if (!error) throw new Error("expected linkX() to reject");
  return error;
}

/** A `linkX()` left in flight, so a case can assert what it did *not* do yet. */
function linkXInFlight(): { settled: () => FluentLinkXResult | null; pending: Promise<FluentLinkXResult> } {
  let answer: FluentLinkXResult | null = null;
  const pending = probe.linkX();
  void pending.then(
    (result) => {
      answer = result;
    },
    () => undefined,
  );
  return { settled: () => answer, pending };
}

describe("linkX(): a user who already has X", () => {
  it("resolves linked from one POST, with no dialog and no marker", async () => {
    seedSession();
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(wire.identityPosts).toHaveLength(1);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(fixture.refreshUserCalls).toBe(0);
    expect(storedMarker()).toBeNull();
    expect(wire.profilePosts).toBe(0);
  });

  it("authenticates the POST with the Fluent token getAuthToken() minted", async () => {
    seedSession();
    const token = (fixture.identityTokens.value = fixture.mintIdentityToken(true));
    renderWidget({ withHook: false });

    await linkXNow();

    const headers = wire.identityPosts[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toMatch(/^Bearer eyJ/);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body))).toEqual({
      accessToken: "privy-access-token",
      identityToken: token,
    });
  });
});

describe("linkX(): the hop", () => {
  it("marks the tab for the signed-in subject, redirects, and sends nothing", async () => {
    seedSession();
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });

    // One refresh, and only then the marker and the redirect.
    expect(fixture.refreshUserCalls).toBe(1);
    expect(fixture.linkTwitterCalls).toBe(1);
    expect(wire.identityPosts).toHaveLength(0);
    expect(JSON.parse(String(storedMarker()))).toEqual({
      started: expect.any(Number),
      subject: PRIVY_USER,
    });
  });

  it("refuses hosted mode before anything else", async () => {
    seedSession();
    renderWidget({ withHook: false, authMode: "hosted" });

    expect((await linkXRefusal()).code).toBe("hosted_not_supported");

    expectNoWork();
    expect(storedMarker()).toBeNull();
  });
});

/** A Privy still restoring its user: what a page sees in its first ticks after any reload. */
function privyRestoring() {
  fixture.privy.ready = false;
  fixture.privy.authenticated = false;
  fixture.privy.userId = undefined;
}

/** A page that just came back from X: a marker, and a Privy still restoring its user. */
function arriveFromRedirect(markerSubject = PRIVY_USER) {
  seedSession();
  seedMarker(JSON.stringify({ started: Date.now(), subject: markerSubject }));
  privyRestoring();
}

/** Privy comes back authenticated, with the X account now on the user. */
function privyRestoredWithX(userId = PRIVY_USER) {
  fixture.privy.ready = true;
  fixture.privy.authenticated = true;
  fixture.privy.userId = userId;
  fixture.privy.linkedAccounts = [{ type: "google_oauth" }, { type: "twitter_oauth" }];
  // The OAuth link mints no identity token of its own: `refreshUser()` is what produces the
  // post-link one, and only then does the store publish it.
  fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
}

/** A direct `linkX()` expected to refuse, left in flight so a case can watch it wait first. */
function linkXRefusalInFlight(): { refused: () => FluentAuthError | null } {
  let refusal: FluentAuthError | null = null;
  void probe.linkX().then(
    () => undefined,
    (err: FluentAuthError) => {
      refusal = err;
    },
  );
  return { refused: () => refusal };
}

describe("the return gate", () => {
  it("completes the link on mount, reading the X account off the restored user", async () => {
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: true });

    // Before either signal: no core call, no POST, no refresh, no second redirect.
    await flush();
    expectNoWork();
    expect(storedMarker()).not.toBeNull();
    expect(probe.hook?.status).toBe("pending");

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(probe.hook?.x).toEqual(X_ACCOUNT);
    expect(wire.identityPosts).toHaveLength(1);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body)).identityToken).toBe(
      fixture.identityTokens.value,
    );
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(storedMarker()).toBeNull();
  });

  it("serves a direct FluentWidgetRenderContext.linkX() caller the same way", async () => {
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flush();
    expectNoWork();
    expect(call.settled()).toBeNull();
    expect(storedMarker()).not.toBeNull();

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "linked", x: X_ACCOUNT });
    expect(wire.identityPosts).toHaveLength(1);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(storedMarker()).toBeNull();
  });

  it("waits for the Fluent ID to be back, not only for Privy", async () => {
    // A reload restores Privy in a tick and the smart account in seconds. A re-entry that ran
    // in between would refuse itself with `not_authenticated` for an account still arriving.
    arriveFromRedirect();
    fixture.smartAccountReady = false;
    const { rerenderWidget } = renderWidget({ withHook: true });

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expectNoWork();
    expect(probe.hook?.status).toBe("pending");
    expect(storedMarker()).not.toBeNull();

    fixture.smartAccountReady = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(wire.identityPosts).toHaveLength(1);
    expect(storedMarker()).toBeNull();
  });

  it("never asks useLinkAccount for an onSuccess", async () => {
    // The completion signal is the restored user, not this callback: in 2.25.0 the link intent
    // is a `useRef` the OAuth reload destroys, so `onSuccess` never fires after a redirect.
    arriveFromRedirect();
    renderWidget({ withHook: true });
    await flush();

    expect(fixture.linkAccountCallbacks).not.toBeNull();
    expect(fixture.linkAccountCallbacks?.onSuccess).toBeUndefined();
    expect(typeof fixture.linkAccountCallbacks?.onError).toBe("function");
  });

  it.each([
    ["linked_to_another_user", "linked_to_another_user"],
    ["oauth_user_denied", "user_rejected"],
    ["exited_link_flow", "user_rejected"],
    ["cannot_link_more_of_type", "link_failed"],
  ])("reports Privy's %s as %s, with no second redirect", async (privyCode, fluentCode) => {
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: PRIVY_USER }));
    renderWidget({ withHook: true });
    await flush();
    expectNoWork();

    await act(async () => {
      fixture.linkAccountCallbacks?.onError?.(privyCode, { linkMethod: "twitter_oauth" });
    });
    await flushUntil(() => probe.hook?.status === "error");

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe(fluentCode);
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("does nothing on mount when there is no marker", async () => {
    seedSession();
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expectNoWork();
  });
});

describe("the marker is owned by the subject that started it", () => {
  it("drops storage that is not a marker, and resumes nothing", async () => {
    seedSession();
    seedMarker('{"started":"yesterday"}');
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("drops a marker user A left behind when user B arrives, and resumes nothing", async () => {
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it.each([
    ["already has X", true],
    ["has no X yet", false],
  ])(
    "stops a direct call at another subject's marker when the signed-in user %s: cleared, no work",
    async (_, hasX) => {
      // Not a fresh ask: the call did nothing, and says so, rather than resolving `linked` for
      // a request it never sent or walking user B into a redirect over user A's leftover.
      seedSession();
      seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
      fixture.identityTokens.value = fixture.mintIdentityToken(hasX);
      renderWidget({ withHook: false });

      const error = await linkXRefusal();

      expect(error).toBeInstanceOf(FluentAuthError);
      expect(error.code).toBe("link_failed");
      expect(storedMarker()).toBeNull();
      expectNoWork();
    },
  );

  it("stops a direct call at storage that is not a marker: cleared, no work", async () => {
    seedSession();
    seedMarker('{"started":"yesterday"}');
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: false });

    expect((await linkXRefusal()).code).toBe("link_failed");

    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("keeps the marker while Privy is still restoring, and discards it once Privy restores somebody else", async () => {
    // Who is here is not known until Privy says so. A marker met before that is neither
    // resumed nor dropped; the verdict comes with the restored user.
    arriveFromRedirect(OTHER_PRIVY_USER);
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXRefusalInFlight();
    await flush();
    expect(call.refused()).toBeNull();
    expect(storedMarker()).not.toBeNull();
    expectNoWork();

    privyRestoredWithX(PRIVY_USER);
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.refused() !== null);

    expect(call.refused()?.code).toBe("link_failed");
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("leaves useLinkX() idle, with no error, when Privy restores somebody else over the session's own marker", async () => {
    // The hook only knows the stored session when it resumes; the session names the subject,
    // so the resume starts and waits. Privy then restores another person: the gate discards
    // the marker, nothing is linked, and the component that never asked sees no error.
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: true });

    await flush();
    expect(probe.hook?.status).toBe("pending");
    expect(storedMarker()).not.toBeNull();
    expectNoWork();

    privyRestoredWithX(OTHER_PRIVY_USER);
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(probe.hook?.x).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("still tells a component that asked when its ask met somebody else's marker", async () => {
    // The same discard, reached through the hook's own `linkX()` rather than the mount-time
    // resume: the component asked, so it is told, as a direct caller is.
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("idle");
    // The mount-time check already dropped the foreign marker; put one back for the ask.
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));

    let refusal: FluentAuthError | null = null;
    const pending = probe.hook?.linkX().catch((err: FluentAuthError) => {
      refusal = err;
    });
    await flushUntil(() => probe.hook?.status === "error");
    await pending;

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("link_failed");
    expect(refusal).toBe(probe.hook?.error);
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("keeps a marker for the subject a signed-out page is still waiting for", async () => {
    // No Fluent session yet is not "another subject": the marker waits for Privy, and for the
    // session the widget derives from the user Privy restores.
    seedMarker(JSON.stringify({ started: Date.now(), subject: PRIVY_USER }));
    privyRestoring();
    renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flush();

    expect(call.settled()).toBeNull();
    expect(storedMarker()).not.toBeNull();
    expectNoWork();
  });
});

describe("linkX(): an external wallet signs in to Privy first", () => {
  it("runs SIWE — message, signature, login — then marks the tab for the wallet's user and redirects", async () => {
    connectWallet();
    privySignedOut();
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });

    // The order, and what each step was handed. Privy's message is generated for the EIP-55
    // form of the address on the widget's chain; the wallet signs exactly that message with the
    // connected account; the login gets the message and the signature and nothing else; then
    // the wallet signs the challenge that mints its Fluent token; and only then come FLU-1552's
    // steps, with the user SIWE signed in as the marker's subject.
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker", "linkTwitter"]);
    expect(fixture.siwe.generateCalls).toEqual([{ address: EOA_CHECKSUM, chainId: `eip155:${TESTNET_CHAIN_ID}` }]);
    expect(fixture.wallet.signMessageCalls).toHaveLength(1);
    expect(fixture.wallet.signMessageCalls[0]?.message).toBe(SIWE_MESSAGE);
    expect(fixture.wallet.signMessageCalls[0]?.account.toLowerCase()).toBe(EOA);
    expect(fixture.siwe.loginCalls).toEqual([{ message: SIWE_MESSAGE, signature: SIWE_SIGNATURE }]);
    expect(JSON.parse(String(storedMarker()))).toEqual({
      started: expect.any(Number),
      subject: WALLET_PRIVY_USER,
    });
    expect(wire.identityPosts).toHaveLength(0);
    expect(fixture.logoutCalls).toBe(0);
    // The token was minted before the page left: one challenge, one exchange, and the refresh
    // credential the return page renews from is stored under the wallet's own key.
    expect(wire.challenges).toBe(1);
    expect(wire.walletExchanges).toBe(1);
    expect(wire.privyExchanges).toBe(0);
    expect(window.localStorage.getItem(walletRefreshCredentialKey())).not.toBeNull();
    expectWalletUserUnchanged();
  });

  it("keeps the wallet's subject, token and cache key through SIWE: a lowercase address stays as supplied", async () => {
    connectWallet(EOA);
    privySignedOut();
    renderWidget({ withHook: false });
    await flush();
    // The wallet's Fluent token first: one challenge, one signature, one exchange.
    const before = await probe.getAuthToken();
    expect(wire.challenges).toBe(1);
    expect(wire.walletExchanges).toBe(1);

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    await flush();

    // Privy was handed the EIP-55 form; the account the host sees is still the connector's own
    // spelling, and the subject under the token is still `wallet:<lowercased address>`: the same
    // cached token comes back without a second challenge, and no Privy exchange ever ran.
    expect(fixture.siwe.generateCalls[0]?.address).toBe(EOA_CHECKSUM);
    expect(probe.account?.address).toBe(EOA);
    await expect(probe.getAuthToken()).resolves.toBe(before);
    expect(wire.challenges).toBe(1);
    expect(wire.walletExchanges).toBe(1);
    expect(fixture.wallet.signTypedDataCalls).toBe(1);
    expectWalletUserUnchanged();
    // Where the widget put the wallet's refresh credential says what the token is keyed on:
    // `wallet:<lowercased address>`, and nothing under the Privy user SIWE signed in.
    expect(window.localStorage.getItem(walletRefreshCredentialKey(EOA))).not.toBeNull();
    expect(
      window.localStorage.getItem(
        refreshCredentialStorageKey(
          authTokenCacheKey({ publicApiUrl: PUBLIC_API_URL, appId: CONFIG.appId, subject: `privy:${WALLET_PRIVY_USER}` }),
        ),
      ),
    ).toBeNull();
  });

  it("tolerates an embedded wallet Privy attaches to the SIWE user, and never reads it", async () => {
    // Should headless SIWE ever create one: it is not the connected account, not the signer, and
    // not the address in the SIWE message — and its presence starts no smart account and no
    // direct-auth exchange.
    connectWallet(EOA);
    privySignedOut();
    fixture.siwe.onLogin = () => privySignedInBySiwe(EOA, { embeddedWallet: true });
    const { rerenderWidget } = renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    await act(async () => {
      rerenderWidget();
    });
    await flush();

    expect(fixture.siwe.generateCalls[0]?.address).toBe(EOA_CHECKSUM);
    expect(fixture.wallet.signMessageCalls[0]?.account.toLowerCase()).toBe(EOA);
    expect(fixture.embeddedWalletCount).toBe(1);
    expectWalletUserUnchanged();
  });
});

describe("linkX(): a wallet user with a live Privy session of their own", () => {
  it("runs no SIWE step and no logout on a repeat call, and takes the hop", async () => {
    connectWallet();
    privySignedInBySiwe(EOA);
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });

    expect(fixture.journal).toEqual(["signChallenge", "marker", "linkTwitter"]);
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(fixture.refreshUserCalls).toBe(1);
    expect(JSON.parse(String(storedMarker())).subject).toBe(WALLET_PRIVY_USER);
    expectWalletUserUnchanged();
  });

  it("runs no SIWE step and no logout on a repeat call, and resolves linked with X", async () => {
    connectWallet();
    privySignedInBySiwe(EOA, { hasX: true });
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    // The one signature is the challenge that mints the wallet's token for the POST.
    expect(fixture.journal).toEqual(["signChallenge"]);
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(1);
    // The POST was authenticated as the wallet: its own challenge, never a Privy exchange.
    expect(wire.challenges).toBe(1);
    expect(wire.walletExchanges).toBe(1);
    expect(storedMarker()).toBeNull();
    expectWalletUserUnchanged();
  });

  it("reports 403 privy_wallet_mismatch as link_failed", async () => {
    connectWallet();
    privySignedInBySiwe(EOA, { hasX: true });
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    wire.identityResponse = () =>
      jsonResponse({ code: "privy_wallet_mismatch", message: "wallet mismatch" }, 403);
    renderWidget({ withHook: false });

    const error = await linkXRefusal();

    expect(error.code).toBe("link_failed");
    expect(error.status).toBe(403);
    expectNoSiwe();
    expectWalletUserUnchanged();
  });
});

describe("linkX(): a live Privy session that is not the connected wallet's", () => {
  it("logs it out, waits for the signed-out commit, then signs the wallet in — the wallet, its token and its Fluent session untouched", async () => {
    // The Privy session is another wallet's: the user switched accounts in MetaMask, Privy kept
    // the old session across the reload, the connector followed the switch.
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER });
    const { rerenderWidget } = renderWidget({ withHook: false });
    await flush();
    const before = await probe.getAuthToken();
    expect(wire.challenges).toBe(1);
    // The journal from here on: the mint above signed the challenge once already.
    fixture.journal = [];

    const call = linkXInFlight();
    // The logout is asked for, and the call waits: the mocked `logout` has flipped the fixture,
    // but nothing in the widget may move on until React has committed the render that reports
    // nobody signed in — which this rerender is.
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(fixture.journal).toEqual(["logout"]);
    expect(call.settled()).toBeNull();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["logout", "generateSiweMessage", "sign", "loginWithSiwe", "marker", "linkTwitter"]);
    expect(fixture.siwe.generateCalls).toEqual([{ address: EOA_CHECKSUM, chainId: `eip155:${TESTNET_CHAIN_ID}` }]);
    expect(JSON.parse(String(storedMarker())).subject).toBe(WALLET_PRIVY_USER);
    // The `wallet:<address>` token cache is as it was: the same bytes, no second challenge, no
    // revoke — the logout ended nothing of the wallet's — and the wallet is still connected.
    await expect(probe.getAuthToken()).resolves.toBe(before);
    expect(wire.challenges).toBe(1);
    expectWalletUserUnchanged();
  });

  it("never probes or sends the replaced user's identity token: the wallet's own is refreshed after SIWE", async () => {
    // The other wallet's Privy user has X, and the token the widget holds is theirs and says
    // so. The wallet signing in now has none: it must take the hop, and nothing of the other
    // user's may be read as its answer or POSTed under its name.
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER, hasX: true });
    const staleToken = fixture.mintIdentityToken(true);
    fixture.identityTokens.value = staleToken;
    fixture.siwe.onLogin = () => {
      const user = privySignedInBySiwe(EOA);
      // Privy publishes the signed-in user's own token with the login.
      fixture.setIdentityToken(fixture.mintIdentityToken(false));
      return user;
    };
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flushUntil(() => fixture.logoutCalls === 1);
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["logout", "generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker", "linkTwitter"]);
    expect(fixture.refreshUserCalls).toBe(1);
    expect(wire.identityPosts).toHaveLength(0);
    expect(fixture.identityTokens.value).not.toBe(staleToken);
    expect(JSON.parse(String(storedMarker())).subject).toBe(WALLET_PRIVY_USER);
  });

  it("rejects link_failed, signing nothing, on a page holding a Fluent session Privy has not restored yet", async () => {
    // The same Fluent ID's page a moment earlier: the stored session names them, Privy is still
    // restoring, and the external wallet beside them already reads as `eoa`. The page has no
    // SIWE to offer — signing the wallet in would put a second user under the Fluent ID's own
    // session — so the call is refused where SIWE would have started.
    seedSession(PRIVY_USER);
    privyRestoring();
    fixture.wallet.connected = true;
    fixture.wallet.address = EOA;
    fixture.smartAccountReady = false;
    renderWidget({ withHook: false });
    await flush();
    expect(probe.account?.type).toBe("eoa");

    const error = await linkXRefusal();

    expect(error.code).toBe("link_failed");
    expect(fixture.logoutCalls).toBe(0);
    expectNoSiwe();
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(sessionChanges).toEqual([]);
  });

  it("rejects link_failed, calling neither logout nor any SIWE step, when the Fluent session names that user", async () => {
    // A Fluent ID whose smart account is still arriving, with an external wallet connected
    // beside it: the account reads as `eoa`, and the Privy session is the Fluent ID's. Signing
    // it out from under the person is not this call's to do.
    seedSession(PRIVY_USER);
    fixture.privy.linkedAccounts = [{ type: "google_oauth" }, walletEntry(SIGNER)];
    fixture.wallet.connected = true;
    fixture.wallet.address = EOA;
    fixture.smartAccountReady = false;
    renderWidget({ withHook: false });
    await flush();
    expect(probe.account?.type).toBe("eoa");

    const error = await linkXRefusal();

    expect(error.code).toBe("link_failed");
    expect(fixture.logoutCalls).toBe(0);
    expectNoSiwe();
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
  });

  it("fails the call with link_failed when the signed-out commit never comes", async () => {
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER });
    // `logout()` resolves and Privy's next render still reports the user.
    fixture.onLogout = () => {};
    renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(fixture.logoutCalls).toBe(1);
    expectNoSiwe();
    expectNoWork();
    expect(storedMarker()).toBeNull();
  });

  /**
   * Review round 4, R7: the bound covers Privy's `logout()` itself, not only the commit after
   * it. Privy's logout awaits its own calls before it publishes anything, so one that never
   * resolves would otherwise hold the call open for good. And a logout that completes after
   * the bound changes nothing: the call has its answer, and nothing continues into SIWE.
   */
  it("fails the call with link_failed within the bound while Privy's logout is still pending, and runs no SIWE when it completes late", async () => {
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER });
    // Privy's `logout()` is held: it has been asked for, and has not answered.
    let releaseLogout!: () => void;
    fixture.onLogout = () =>
      new Promise<void>((resolve) => {
        releaseLogout = resolve;
      });
    const { rerenderWidget } = renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(fixture.journal).toEqual(["logout"]);
    expect(refusals).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(fixture.logoutCalls).toBe(1);
    expectNoSiwe();
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);

    // Privy answers late, and its next render reports nobody: the call that timed out is not
    // resumed by it — no SIWE step runs on its account.
    releaseLogout();
    await act(async () => {
      privySignedOut();
      rerenderWidget();
    });
    await flush();
    expect(fixture.journal).toEqual(["logout"]);
    expectNoSiwe();
    expectNoWork();
  });
});

describe("a Fluent ID with the connected wallet among its linked accounts", () => {
  it("keeps its smart account, its signer and its session: owning the wallet alone makes no session SIWE's", async () => {
    // A signed-in Fluent ID — stored session naming the Privy user, smart account ready,
    // embedded signer — whose Privy user also holds the connected external wallet. The wallet
    // guard reads the session before it masks anything: this is a Fluent ID's page, as before.
    seedSession(PRIVY_USER);
    connectWallet(EOA);
    fixture.smartAccountReady = true;
    fixture.embeddedWalletCount = 1;
    fixture.privy.linkedAccounts = [{ type: "google_oauth" }, embeddedWalletEntry(SIGNER), walletEntry(EOA)];
    renderWidget({ withHook: false });
    await flush();

    expect(probe.account?.type).toBe("smart");
    expect(probe.account?.address).toBe(SMART_ACCOUNT);
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(wire.challenges).toBe(0);

    // And its `linkX()` is a Fluent ID's: the Privy exchange mints the token, nothing is signed.
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(1);
    expect(wire.privyExchanges).toBe(1);
    expect(wire.challenges).toBe(0);
  });
});

describe("linkX(): what SIWE can fail with, for a wallet user", () => {
  it("reports a refused signature as user_rejected, and logs nothing in", async () => {
    connectWallet();
    privySignedOut();
    fixture.wallet.onSignMessage = () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    };
    renderWidget({ withHook: false });

    const error = await linkXRefusal();

    expect(error.code).toBe("user_rejected");
    expect(fixture.siwe.loginCalls).toHaveLength(0);
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign"]);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    // Nobody was signed in, so nothing is signed out, and the wallet's token was not minted.
    expect(fixture.logoutCalls).toBe(0);
    expect(wire.challenges).toBe(0);
    expectWalletUserUnchanged();
  });

  it("reports the same code through useLinkX()", async () => {
    connectWallet();
    privySignedOut();
    fixture.wallet.onSignMessage = () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    };
    renderWidget({ withHook: true });

    let refusal: FluentAuthError | null = null;
    const pending = probe.hook?.linkX().catch((err: FluentAuthError) => {
      refusal = err;
    });
    await flushUntil(() => probe.hook?.status === "error");
    await pending;

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("user_rejected");
    expect(refusal).toBe(probe.hook?.error);
  });

  it("fails closed when the user loginWithSiwe resolved does not own the wallet: nothing written, probed or sent, and that session logged out", async () => {
    connectWallet(EOA);
    privySignedOut();
    // Privy signed somebody in, and says nothing about this wallet on them.
    fixture.siwe.onLogin = () => {
      const linkedAccounts = [{ type: "google_oauth" }];
      fixture.privy.authenticated = true;
      fixture.privy.userId = "did:privy:unverified";
      fixture.privy.linkedAccounts = linkedAccounts;
      return { id: "did:privy:unverified", linkedAccounts };
    };
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    // The logout is the last step, after SIWE and with no marker, refresh or POST anywhere —
    // and the call waits for the signed-out commit, which this rerender is.
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "logout"]);
    expect(call.settled()).toBeNull();
    await act(async () => {
      rerenderWidget();
    });
    const error = await refusalOf(call.pending);

    expect(error.code).toBe("link_failed");
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.logoutCalls).toBe(1);
    expectWalletUserUnchanged();
    // The session SIWE made does not outlive the call, and the page after it is the wallet's:
    // the next token is the wallet's own exchange, through no Privy exchange, and the next
    // `linkX()` has to sign the wallet in again.
    await probe.getAuthToken();
    expect(wire.privyExchanges).toBe(0);
    expect(wire.challenges).toBe(1);
    fixture.journal = [];
    fixture.siwe.onLogin = () => privySignedInBySiwe(EOA);
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "marker", "linkTwitter"]);
  });

  /**
   * Review round 3, R6: the same failed-ownership answer, with the returned user holding a Privy
   * embedded wallet — the one shape of Privy session the direct-auth effect would take for a
   * Fluent ID login. The session is logged out before the rejection settles, so the effect
   * never meets it: no kernel is built on that embedded wallet, no Fluent session is created or
   * stored, the account stays the wallet's, and the next `getAuthToken()` is the wallet's own
   * exchange. Both with the kernel already ready and with it absent until a `refresh()` that
   * would succeed — the second is the variant that would otherwise initialize one.
   */
  it.each([true, false])(
    "logs out a rejected SIWE user who holds an embedded wallet before the rejection settles, and keeps the wallet as the account (kernel ready: %s)",
    async (kernelReady) => {
      connectWallet(EOA);
      privySignedOut();
      fixture.siwe.onLogin = () => {
        const linkedAccounts = [{ type: "google_oauth" }, embeddedWalletEntry(SIGNER)];
        fixture.privy.authenticated = true;
        fixture.privy.userId = "did:privy:unverified";
        fixture.privy.linkedAccounts = linkedAccounts;
        fixture.embeddedWalletCount = 1;
        fixture.smartAccountReady = kernelReady;
        fixture.refreshCompletesInitialization = true;
        // Privy publishes the identity token of whoever it signed in.
        fixture.setIdentityToken(fixture.mintIdentityToken(false));
        return { id: "did:privy:unverified", linkedAccounts };
      };
      const { rerenderWidget } = renderWidget({ withHook: false });

      const call = linkXInFlight();
      // Privy has committed the user it signed in — embedded wallet, identity token and all —
      // and the logout has been asked for. Nothing has taken that user for a Fluent ID.
      await flushUntil(() => fixture.logoutCalls === 1);
      expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "logout"]);
      expect(call.settled()).toBeNull();
      expect(sessionChanges).toEqual([]);
      expect(wire.privyExchanges).toBe(0);
      expect(fixture.zerodevRefreshCalls).toBe(0);
      // The signed-out commit the call is waiting for.
      await act(async () => {
        rerenderWidget();
      });
      const error = await refusalOf(call.pending);
      await flush();

      expect(error.code).toBe("link_failed");
      expect(fixture.logoutCalls).toBe(1);
      expectNoWork();
      expect(storedMarker()).toBeNull();
      expectWalletUserUnchanged();

      // The wallet's token is still the wallet's: one challenge, the wallet exchange, no
      // Privy exchange — the account is still `eoa` at the connected address.
      await probe.getAuthToken();
      expect(wire.privyExchanges).toBe(0);
      expect(wire.challenges).toBe(1);
      expect(wire.walletExchanges).toBe(1);
      expect(probe.account?.type).toBe("eoa");
      expect(probe.account?.address).toBe(EOA);
      expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
      expect(sessionChanges).toEqual([]);
      expect(fixture.zerodevRefreshCalls).toBe(0);
    },
  );

  it("waits for the signed-out commit after a failed ownership check, and fails link_failed when it never comes", async () => {
    connectWallet(EOA);
    privySignedOut();
    // `loginWithSiwe` is held until the page has committed the user Privy signed in — the
    // window a real page has between the login and the logout — so the wait is a real one.
    let releaseLogin!: () => void;
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    fixture.siwe.onLogin = () => {
      const linkedAccounts = [{ type: "google_oauth" }];
      fixture.privy.authenticated = true;
      fixture.privy.userId = "did:privy:unverified";
      fixture.privy.linkedAccounts = linkedAccounts;
      fixture.setIdentityToken(fixture.mintIdentityToken(false));
      return loginGate.then(() => ({ id: "did:privy:unverified", linkedAccounts }));
    };
    // `logout()` resolves and Privy's next render still reports the user.
    fixture.onLogout = () => {};
    renderWidget({ withHook: false });

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.siwe.loginCalls.length === 1);
    vi.useFakeTimers();
    releaseLogin();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "logout"]);
    expect(fixture.logoutCalls).toBe(1);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
  });

  /**
   * Review round 4, R7, on the failed-ownership path: the bound covers Privy's `logout()`
   * itself. The rejected user holds an embedded wallet, and Privy has committed them, identity
   * token and all, so the guard is what keeps them from becoming a Fluent ID while the logout
   * is pending — and after the bound, while it still has not answered.
   */
  it("fails link_failed within the bound while the logout after a failed ownership check is still pending", async () => {
    connectWallet(EOA);
    privySignedOut();
    fixture.siwe.onLogin = () => {
      const linkedAccounts = [{ type: "google_oauth" }, embeddedWalletEntry(SIGNER)];
      fixture.privy.authenticated = true;
      fixture.privy.userId = "did:privy:unverified";
      fixture.privy.linkedAccounts = linkedAccounts;
      fixture.embeddedWalletCount = 1;
      fixture.smartAccountReady = true;
      fixture.setIdentityToken(fixture.mintIdentityToken(false));
      return { id: "did:privy:unverified", linkedAccounts };
    };
    let releaseLogout!: () => void;
    fixture.onLogout = () =>
      new Promise<void>((resolve) => {
        releaseLogout = resolve;
      });
    const { rerenderWidget } = renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "logout"]);
    expect(refusals).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(refusals[0]?.message).toContain("did not confirm");
    expect(fixture.logoutCalls).toBe(1);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.wallet.disconnectCalls).toBe(0);
    // Nothing has taken the rejected user, whom Privy still reports, for a Fluent ID.
    expectWalletUserUnchanged();

    // The late answer, and the signed-out commit, resume nothing.
    releaseLogout();
    await act(async () => {
      privySignedOut();
      rerenderWidget();
    });
    await flush();
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "logout"]);
    expectNoWork();
    expectWalletUserUnchanged();
  });

  /**
   * Review round 4, standards: guarding the rejected SIWE user lasts until they are signed
   * out, not for the life of the page. The same person — a Google account with an embedded
   * wallet, which is what a rejected SIWE user looks like — signing in afterwards the ordinary
   * way is a Fluent ID login, and gets its session as it did before `linkX()` ever ran.
   */
  it("lets the rejected SIWE user sign in the ordinary way afterwards, as the Fluent ID they are", async () => {
    connectWallet(EOA);
    privySignedOut();
    const linkedAccounts = [{ type: "google_oauth" }, embeddedWalletEntry(SIGNER)];
    fixture.siwe.onLogin = () => {
      fixture.privy.authenticated = true;
      fixture.privy.userId = "did:privy:unverified";
      fixture.privy.linkedAccounts = linkedAccounts;
      fixture.embeddedWalletCount = 1;
      fixture.smartAccountReady = true;
      fixture.setIdentityToken(fixture.mintIdentityToken(false));
      return { id: "did:privy:unverified", linkedAccounts };
    };
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flushUntil(() => fixture.logoutCalls === 1);
    await act(async () => {
      rerenderWidget();
    });
    const error = await refusalOf(call.pending);
    await flush();
    expect(error.code).toBe("link_failed");
    expectWalletUserUnchanged();

    // The ordinary login of that very user: Privy reports them again, with no external wallet
    // among their accounts, their embedded wallet, a kernel ready and an identity token.
    fixture.privy.authenticated = true;
    fixture.privy.userId = "did:privy:unverified";
    fixture.privy.linkedAccounts = linkedAccounts;
    fixture.embeddedWalletCount = 1;
    fixture.smartAccountReady = true;
    await act(async () => {
      fixture.setIdentityToken(fixture.mintIdentityToken(false));
      rerenderWidget();
    });
    await flushUntil(() => sessionChanges.length > 0);

    expect(sessionChanges).toHaveLength(1);
    expect((sessionChanges[0] as { user: { id: string } }).user.id).toBe("did:privy:unverified");
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(probe.account?.type).toBe("smart");
    expectNoWork();
    expect(fixture.logoutCalls).toBe(1);
  });
});

describe("the wallet signs everything before the hop", () => {
  // Criterion 13: the Fluent token's challenge is signed on the page that leaves for X, so the
  // page that comes back renews the token from the stored refresh credential and opens the
  // wallet for nothing. The mint's place in the order is asserted on the hop cases above
  // (`signChallenge` before `marker`); here is the return, and the refusal.

  it("completes the return from the stored refresh credential, asking the wallet for nothing", async () => {
    seedWalletRefreshCredential(EOA);
    arriveFromWalletRedirect(EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();

    privySignedInBySiwe(EOA, { hasX: true });
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(probe.hook?.x).toEqual(X_ACCOUNT);
    expect(wire.identityPosts).toHaveLength(1);
    // The token the POST carried came out of the refresh family: no challenge, no typed-data
    // signature, no SIWE message — the wallet was not asked to sign anything.
    expect(wire.refreshes).toBe(1);
    expect(wire.challenges).toBe(0);
    expect(wire.walletExchanges).toBe(0);
    expect(fixture.wallet.signTypedDataCalls).toBe(0);
    expect(fixture.wallet.signMessageCalls).toHaveLength(0);
    expectNoSiwe();
    expect(storedMarker()).toBeNull();
    expectWalletUserUnchanged();
  });

  it("reports a refused challenge signature as user_rejected, with no marker and no redirect, and keeps the session for the next call", async () => {
    connectWallet(EOA);
    privySignedOut();
    fixture.wallet.onSignTypedData = () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    };
    const { rerenderWidget } = renderWidget({ withHook: false });

    const error = await linkXRefusal();

    expect(error.code).toBe("user_rejected");
    // SIWE had run; the mint was the last step, and nothing came after it.
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge"]);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(fixture.logoutCalls).toBe(0);
    expect(window.localStorage.getItem(walletRefreshCredentialKey())).toBeNull();
    expectWalletUserUnchanged();

    // The Privy session SIWE made is the wallet's own, and stays: the next call asks for no
    // SIWE signature, only for the challenge the user accepts this time.
    await act(async () => {
      rerenderWidget();
    });
    fixture.journal = [];
    fixture.siwe.generateCalls = [];
    fixture.siwe.loginCalls = [];
    fixture.wallet.signMessageCalls = [];
    fixture.wallet.onSignTypedData = () => "0xfluent-challenge-signature";
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["signChallenge", "marker", "linkTwitter"]);
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
  });
});

describe("linkX(): Privy's SIWE steps and the wallet's prompt are bounded", () => {
  // Criterion 14: a step that never answers is a `link_failed` after its bound, with a message
  // naming what an integrator can check — Privy's captcha, which the headless hook waits on
  // and this SDK does not mount during `linkX()`, or wallet login disabled on the Privy app —
  // and a step that answers late resumes nothing.

  let release: () => void = () => {};

  it.each([
    [
      "generateSiweMessage",
      () => {
        fixture.siwe.onGenerate = () =>
          new Promise<string>((resolve) => {
            release = () => resolve(SIWE_MESSAGE);
          });
      },
      ["generateSiweMessage"],
    ],
    [
      "loginWithSiwe",
      () => {
        fixture.siwe.onLogin = () =>
          new Promise<FluentLinkXPrivyUser>((resolve) => {
            release = () => resolve(privySignedInBySiwe(EOA));
          });
      },
      ["generateSiweMessage", "sign", "loginWithSiwe"],
    ],
  ])("fails link_failed, naming captcha, when %s never answers — and a late answer resumes nothing", async (_, hold, journal) => {
    connectWallet(EOA);
    privySignedOut();
    hold();
    const { rerenderWidget } = renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.journal.length === journal.length);
    expect(fixture.journal).toEqual(journal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIWE_STEP_TIMEOUT_MS - 1);
    });
    expect(refusals).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toBeInstanceOf(FluentAuthError);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(refusals[0]?.message).toMatch(/captcha/);
    expect(refusals[0]?.message).toMatch(/wallet login is disabled/);
    expect(fixture.journal).toEqual(journal);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(wire.challenges).toBe(0);
    expectWalletUserUnchanged();

    // Privy answers late. The call that timed out is not resumed by it: no further step, no
    // token, no marker, no redirect — and a user signed in late is a wallet's session here,
    // never a Fluent ID.
    release();
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expect(fixture.journal).toEqual(journal);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expect(wire.challenges).toBe(0);
    expectWalletUserUnchanged();
  });

  it("fails link_failed when the wallet never answers the signature prompt, after minutes rather than seconds", async () => {
    connectWallet(EOA);
    privySignedOut();
    fixture.wallet.onSignMessage = () => new Promise<string>(() => {});
    renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.wallet.signMessageCalls.length === 1);
    // A person is answering this one: Privy's bound passes, and the call still waits.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIWE_STEP_TIMEOUT_MS + 1);
    });
    expect(refusals).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WALLET_SIGNATURE_TIMEOUT_MS - SIWE_STEP_TIMEOUT_MS);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toBeInstanceOf(FluentAuthError);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(refusals[0]?.message).toMatch(/signature request/);
    // The same diagnostic as Privy's steps (criterion 14): what an integrator can check.
    expect(refusals[0]?.message).toMatch(/captcha/);
    expect(refusals[0]?.message).toMatch(/wallet login is disabled/);
    expect(fixture.siwe.loginCalls).toHaveLength(0);
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign"]);
    expectNoWork();
    expect(storedMarker()).toBeNull();
    expectWalletUserUnchanged();
  });
});

describe("the auth demo reads the current X profile", () => {
  it("waits for the wallet client on load, then reads the existing X account without a stale signer error", async () => {
    connectWallet(EOA, { hasClient: false });
    privySignedOut();
    wire.profileResponse = () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT });
    const { rerenderWidget } = renderWidget({ withHook: false, withDemo: true });
    await flush();
    expect(probe.account?.type).toBe("eoa");
    expect(probe.account?.executionReady).toBe(false);
    expect(wire.profilePosts).toBe(0);
    expect(wire.challenges).toBe(0);
    expect(screen.queryByText(/External wallet has no signer/)).toBeNull();

    fixture.wallet.hasClient = true;
    await act(async () => { rerenderWidget(); });
    await waitFor(() => expect(screen.getByText(`✓ @${X_ACCOUNT.handle}`)).toBeTruthy());
    expect(probe.account?.executionReady).toBe(true);
    expect(wire.profilePosts).toBe(1);
    expect(wire.walletExchanges).toBe(1);
    expect(screen.queryByText(/External wallet has no signer/)).toBeNull();
    expectNoSiwe();
    expect(wire.privyExchanges).toBe(0);
  });

  it("shows an existing X account on load using the wallet's Fluent token", async () => {
    connectWallet(EOA);
    privySignedOut();
    seedWalletRefreshCredential();
    wire.profileResponse = () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT });
    renderWidget({ withHook: false, withDemo: true });
    await waitFor(() => expect(screen.getByText(`✓ @${X_ACCOUNT.handle}`)).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(
      "https://api.fluent-connect.dev.gblend.xyz/api/v1/me/profile",
      { headers: { Authorization: `Bearer ${await probe.getAuthToken()}` } },
    );
    expectNoSiwe();
    expect(wire.privyExchanges).toBe(0);
  });

  it("clears a failed action on retry and rereads the profile after each link attempt", async () => {
    connectWallet(EOA);
    privySignedInBySiwe(EOA, { hasX: true });
    seedWalletRefreshCredential();
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    wire.identityResponse = () => jsonResponse({ code: "privy_wallet_mismatch", message: "Profile link refused" }, 403);
    renderWidget({ withHook: false, withDemo: true });
    await waitFor(() => expect(wire.profilePosts).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Link X" }));
    await waitFor(() => expect(screen.getByText(/link_failed:.*Profile link refused/)).toBeTruthy());
    await waitFor(() => expect(wire.profilePosts).toBe(2));

    let finishPost!: () => void;
    wire.identityResponse = () => new Promise<Response>((resolve) => {
      finishPost = () => {
        wire.profileResponse = () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT });
        resolve(jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT }));
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Link X" }));
    await waitFor(() => expect(wire.identityPosts).toHaveLength(2));
    expect(screen.queryByText(/Profile link refused/)).toBeNull();
    finishPost();
    await waitFor(() => expect(screen.getByText(`✓ @${X_ACCOUNT.handle}`)).toBeTruthy());
    expect(wire.profilePosts).toBe(3);
    expect(screen.queryByText(/Profile link refused/)).toBeNull();
    expectNoSiwe();
  });
});

describe("the connect modal cannot create a wallet on a SIWE session", () => {
  // An OAuth return opens the real modal directly on its connecting screen. This exercises
  // wallet creation independently of the sign-in method's logout gate (criterion 16).
  function seedConnectingModal() {
    window.sessionStorage.setItem("fluent:inline-oauth:v1", JSON.stringify({
      started: Date.now(), provider: "twitter",
    }));
  }

  it.each([true, false])("does not create an embedded wallet on a restored SIWE session (wallet connected: %s), then creates once for a real Fluent login", async (connected) => {
    connectWallet(EOA);
    fixture.wallet.connected = connected;
    if (!connected) fixture.wallet.address = undefined;
    privySignedInBySiwe(EOA);
    seedConnectingModal();
    const { rerenderWidget } = renderWidget({ withHook: false });
    await flush();
    expect(connectModalOpen()).toBe(true);
    expect(fixture.journal).not.toContain("createWallet");
    expect(wire.privyExchanges).toBe(0);
    expect(sessionChanges).toEqual([]);

    // The SIWE user is signed out; the following OAuth login has no external wallet.
    privySignedOut();
    await act(async () => { rerenderWidget(); });
    fixture.privy.authenticated = true;
    fixture.privy.userId = PRIVY_USER;
    fixture.privy.linkedAccounts = [{ type: "google_oauth" }];
    await act(async () => { rerenderWidget(); });
    await flush();
    expect(fixture.journal.filter((event) => event === "createWallet")).toHaveLength(1);
    await act(async () => { rerenderWidget(); });
    expect(fixture.journal.filter((event) => event === "createWallet")).toHaveLength(1);
  });

  it("blocks wallet creation while SIWE is pending and while its rejected returned user awaits logout", async () => {
    connectWallet(EOA);
    privySignedOut();
    seedConnectingModal();
    let finishLogin!: (user: FluentLinkXPrivyUser) => void;
    let finishLogout!: () => void;
    fixture.siwe.onLogin = () => new Promise((resolve) => { finishLogin = resolve; });
    fixture.onLogout = () => new Promise<void>((resolve) => { finishLogout = resolve; });
    const { rerenderWidget } = renderWidget({ withHook: false });
    const pending = probe.linkX().catch((error: FluentAuthError) => error);
    await flushUntil(() => fixture.siwe.loginCalls.length === 1);

    // Privy publishes before answering loginWithSiwe. No external-wallet shape can guard it.
    fixture.privy.authenticated = true;
    fixture.privy.userId = WALLET_PRIVY_USER;
    fixture.privy.linkedAccounts = [{ type: "google_oauth" }];
    await act(async () => { rerenderWidget(); });
    await flush();
    expect(connectModalOpen()).toBe(true);
    expect(fixture.journal).not.toContain("createWallet");

    finishLogin({ id: WALLET_PRIVY_USER, linkedAccounts: [] });
    await flushUntil(() => fixture.logoutCalls === 1);
    await act(async () => { rerenderWidget(); });
    expect(fixture.journal).not.toContain("createWallet");
    expect(wire.privyExchanges).toBe(0);
    expect(sessionChanges).toEqual([]);

    privySignedOut();
    finishLogout();
    await act(async () => { rerenderWidget(); });
    await flush();
    expect(await pending).toMatchObject({ code: "link_failed" });
    expectWalletUserUnchanged();
  });
});

describe("choosing a Fluent ID while the wallet's Privy session lives", () => {
  // Criterion 12 (Senior Dev diff review, blocking): before this, a wallet user who had linked
  // X and then chose a Fluent ID sign-in hit a dead end — the status said "Opening Fluent
  // Connect ID", the intent stayed armed across reloads, and no modal opened, because the live
  // Privy session was taken for a Fluent ID to complete and then refused as a wallet's.

  /** A wallet user who has linked X on this page, with the connect modal open on its choices. */
  async function walletUserAtTheConnectModal() {
    connectWallet(EOA);
    privySignedOut();
    const rendered = renderWidget({ withHook: false, debug: true });
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    await act(async () => {
      rendered.rerenderWidget();
    });
    await flush();
    expect(probe.account?.type).toBe("eoa");
    await act(async () => {
      probe.openConnect();
    });
    expect(connectModalOpen()).toBe(true);
    return rendered;
  }

  it("signs the wallet's Privy session out, then opens the sign-in: the wallet stays connected, and a closed sign-in leaves no armed intent behind", async () => {
    const { rerenderWidget, unmount } = await walletUserAtTheConnectModal();

    // The person chooses a Fluent ID method.
    fireEvent.click(screen.getByRole("button", { name: "Continue with X" }));
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(fixture.logoutCalls).toBe(1);
    expect(connectStatus()).toBe("Signing the wallet's Privy session out");
    // The signed-out commit the sign-in waits for.
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => connectStatus() === "Opening Fluent Connect ID");

    expect(connectStatus()).toBe("Opening Fluent Connect ID");
    expect(connectModalOpen()).toBe(true);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    // Only Privy was signed out: the wallet is connected, its session and token untouched.
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(wire.revokes).toBe(0);
    expect(probe.account?.type).toBe("eoa");
    expect(probe.account?.address).toBe(EOA);
    expect(window.localStorage.getItem(walletRefreshCredentialKey())).not.toBeNull();

    // The person closes the sign-in instead. The intent goes with it, and a remount — the
    // reload the dead end used to survive — arms nothing, opens nothing and signs nobody in.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush();
    expect(connectModalOpen()).toBe(false);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    unmount();
    renderWidget({ withHook: false, debug: true });
    await flush();
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    expect(connectModalOpen()).toBe(false);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(fixture.logoutCalls).toBe(1);
    expect(probe.account?.type).toBe("eoa");
  });

  it("reports a logout that does not complete within the bound, arms no intent, and leaves the wallet as it was", async () => {
    // `logout()` resolves and Privy's next render still reports the wallet's user.
    fixture.onLogout = () => {};
    await walletUserAtTheConnectModal();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Continue with X" }));
    await flushUntil(() => fixture.logoutCalls === 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await flush();

    expect(connectStatus()).toMatch(/did not sign the previous session out/);
    expect(connectStatus()).not.toBe("Opening Fluent Connect ID");
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    expect(fixture.logoutCalls).toBe(1);
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(wire.revokes).toBe(0);
    expect(probe.account?.type).toBe("eoa");
    expect(probe.account?.address).toBe(EOA);
  });

  // Criterion 16 (review round 6, R9): the real modal is open on its methods before one is
  // chosen, and calls its method right after `onFluentLogin` — `initOAuth` leaves the page — so
  // opening the modal after the logout gates nothing. The method is what waits: on the logout,
  // on its signed-out commit, and on the intent that the return needs.
  const INLINE_OAUTH_KEY = "fluent:inline-oauth:v1";

  it.each([
    ["Continue with X", "initOAuth:twitter"],
    ["Continue with passkey", "loginWithPasskey"],
  ])("runs no Fluent method — %s — before the SIWE logout and its signed-out commit have finished, then runs it with the intent armed", async (label, method) => {
    let releaseLogout!: () => void;
    fixture.onLogout = () =>
      new Promise<void>((resolve) => {
        releaseLogout = resolve;
      });
    const { rerenderWidget } = await walletUserAtTheConnectModal();
    fixture.journal = [];

    fireEvent.click(screen.getByRole("button", { name: label }));
    await flushUntil(() => fixture.logoutCalls === 1);
    await flush();
    // Privy has been asked and has not answered: the method waits, and nothing is armed.
    expect(fixture.journal).toEqual(["logout"]);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(INLINE_OAUTH_KEY)).toBeNull();

    // Privy's `logout()` resolves, but the commit that reports nobody has not happened yet.
    releaseLogout();
    await flush();
    expect(fixture.journal).toEqual(["logout"]);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();

    // The signed-out commit. The intent is armed first; only then does the method run.
    privySignedOut();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => fixture.journal.length === 3);
    expect(fixture.journal).toEqual(["logout", "intent", method]);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    expect(connectStatus()).toBe("Opening Fluent Connect ID");
    // Only Privy was signed out: the wallet is connected, its session and token untouched.
    expect(fixture.logoutCalls).toBe(1);
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(wire.revokes).toBe(0);
    expect(probe.account?.type).toBe("eoa");
  });

  it("opens the email step only once the SIWE logout has finished", async () => {
    let releaseLogout!: () => void;
    fixture.onLogout = () =>
      new Promise<void>((resolve) => {
        releaseLogout = () => {
          privySignedOut();
          resolve();
        };
      });
    const { rerenderWidget } = await walletUserAtTheConnectModal();
    fixture.journal = [];

    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    await flushUntil(() => fixture.logoutCalls === 1);
    await flush();
    // The dialog stays on its choices: not the email step, and not the "connecting" screen,
    // which would create an embedded wallet for the wallet's user Privy still reports.
    expect(fixture.journal).toEqual(["logout"]);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with X" })).toBeTruthy();

    releaseLogout();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => screen.queryByLabelText("Email address") !== null);
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(fixture.journal).toEqual(["logout", "intent"]);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    expect(probe.account?.type).toBe("eoa");
  });

  it("runs no Fluent method when the logout runs past its bound: the dialog shows the failure, a late sign-out starts nothing, and the next click asks again", async () => {
    // `logout()` resolves and Privy's next render still reports the wallet's user.
    fixture.onLogout = () => {};
    const { rerenderWidget } = await walletUserAtTheConnectModal();
    fixture.journal = [];
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Continue with X" }));
    await flushUntil(() => fixture.logoutCalls === 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await flush();

    expect(fixture.journal).toEqual(["logout"]);
    expect(connectModalOpen()).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/did not sign the previous session out/);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(INLINE_OAUTH_KEY)).toBeNull();
    expect(fixture.wallet.disconnectCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(probe.account?.type).toBe("eoa");

    // Privy signs the user out late. Nothing was waiting for it: no method runs.
    privySignedOut();
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expect(fixture.journal).toEqual(["logout"]);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();

    // The person clicks again. The host is asked afresh — nobody is signed in to Privy now, so
    // there is nothing to sign out — and the method runs with the intent armed.
    fireEvent.click(screen.getByRole("button", { name: "Continue with X" }));
    await flushUntil(() => fixture.journal.length === 3);
    expect(fixture.journal).toEqual(["logout", "intent", "initOAuth:twitter"]);
    expect(fixture.logoutCalls).toBe(1);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    expect(probe.account?.type).toBe("eoa");
  });
});

/** A page that just came back from X for a wallet user: the marker, Privy restoring, the wallet reconnecting. */
function arriveFromWalletRedirect(address: string = EOA, options: { hasClient?: boolean } = {}) {
  seedMarker(JSON.stringify({ started: Date.now(), subject: WALLET_PRIVY_USER }));
  privyRestoring();
  connectWallet(address, options);
}

describe("the return gate for a wallet user", () => {
  it("completes the link on mount once the restored user owns the wallet and its client is back", async () => {
    // Nothing of a Fluent ID anywhere: no session, no smart account. The hook resumes for the
    // connected wallet, and the gate waits for Privy, then for the client the connector hands
    // over after the address.
    arriveFromWalletRedirect(EOA, { hasClient: false });
    const { rerenderWidget } = renderWidget({ withHook: true });

    await flush();
    expectNoWork();
    expect(storedMarker()).not.toBeNull();
    expect(probe.hook?.status).toBe("pending");

    privySignedInBySiwe(EOA, { hasX: true });
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    // Restored and owning, but the client that signs the token's exchange is not here yet.
    expectNoWork();
    expect(probe.hook?.status).toBe("pending");
    expect(storedMarker()).not.toBeNull();

    fixture.wallet.hasClient = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(probe.hook?.x).toEqual(X_ACCOUNT);
    expect(wire.identityPosts).toHaveLength(1);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body)).identityToken).toBe(
      fixture.identityTokens.value,
    );
    // No second SIWE, no second redirect: the restored session is the wallet's own.
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(wire.challenges).toBe(1);
    expect(storedMarker()).toBeNull();
    expectWalletUserUnchanged();
  });

  it("serves a direct FluentWidgetRenderContext.linkX() caller the same way", async () => {
    arriveFromWalletRedirect(EOA, { hasClient: false });
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flush();
    expectNoWork();
    expect(call.settled()).toBeNull();

    privySignedInBySiwe(EOA, { hasX: true });
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expectNoWork();
    expect(call.settled()).toBeNull();

    fixture.wallet.hasClient = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "linked", x: X_ACCOUNT });
    expect(wire.identityPosts).toHaveLength(1);
    expectNoSiwe();
    expect(storedMarker()).toBeNull();
    expectWalletUserUnchanged();
  });

  it("keeps the account a wallet on a return mount that restores an embedded wallet beside it", async () => {
    // The guard that keeps the direct-auth exchange off the wallet's session has to hold on the
    // page load the redirect performs, where nothing from the page that started the hop is in
    // memory: it is read from the restored user and the connected wallet.
    arriveFromWalletRedirect(EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();

    privySignedInBySiwe(EOA, { hasX: true, embeddedWallet: true });
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");
    await flush();

    expect(probe.hook?.status).toBe("linked");
    expect(fixture.embeddedWalletCount).toBe(1);
    expect(probe.account?.type).toBe("eoa");
    expectWalletUserUnchanged();
  });

  it("discards the marker when the wallet connected now is not the one the restored session owns", async () => {
    // The user switched wallets across the redirect. The hop the marker records is the other
    // wallet's: cleared, no POST, `link_failed` to a direct caller.
    arriveFromWalletRedirect(OTHER_EOA);
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXRefusalInFlight();
    await flush();
    expect(call.refused()).toBeNull();

    privySignedInBySiwe(EOA, { hasX: true });
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.refused() !== null);

    expect(call.refused()?.code).toBe("link_failed");
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
  });

  it("leaves useLinkX() idle, with no error, over the same wallet change", async () => {
    arriveFromWalletRedirect(OTHER_EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("pending");

    privySignedInBySiwe(EOA, { hasX: true });
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("discards another wallet's marker before waiting for X: the restored session owns no X and not this wallet", async () => {
    // The hop the marker records was abandoned at X by the other wallet, so the restored user
    // has no X account. Ownership is decided first: the marker is cleared, the hook is idle and
    // nothing waits for an X account that would be the other wallet's anyway.
    arriveFromWalletRedirect(OTHER_EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("pending");

    privySignedInBySiwe(EOA, { hasX: false });
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();
  });

  it("hands a direct caller link_failed over the same marker, with X not linked and the client not here yet", async () => {
    // Neither the X account nor the wallet client is waited for once the wallet is not the
    // restored session's.
    arriveFromWalletRedirect(OTHER_EOA, { hasClient: false });
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXRefusalInFlight();
    await flush();
    expect(call.refused()).toBeNull();

    privySignedInBySiwe(EOA, { hasX: false });
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.refused() !== null);

    expect(call.refused()?.code).toBe("link_failed");
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
  });

  it("discards the marker when Privy restores nobody on a wallet page, so the next call can sign in afresh", async () => {
    // The wallet's Privy session is the one SIWE made; with it gone the subject cannot come back
    // except through a new SIWE — which a marker left in the way would stop before it starts.
    arriveFromWalletRedirect(EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("pending");

    privySignedOut();
    fixture.privy.ready = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();

    // And a fresh ask signs the wallet in. (The journal so far holds the seeded marker's write.)
    fixture.journal = [];
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker", "linkTwitter"]);
  });
});

describe("a wallet user's Privy session never becomes a Fluent ID, whatever the connector reports", () => {
  // The guard is read from the restored user — an external wallet among its linked accounts —
  // and the stored session, not from whether the Privy user owns the wallet connected *now*.
  // Ownership is the return gate's question; here it would turn a wallet user into a Fluent ID
  // the moment the addresses stop matching.

  it("keeps the wallet connected now as the account when the leftover session, embedded wallet and all, is another wallet's — then replaces it", async () => {
    // Privy restored the SIWE session of a wallet the user has since switched away from, with an
    // embedded wallet Privy attached to it and a kernel ready to be built on. No Fluent session
    // anywhere. That session is a wallet's, mismatched for this one: not a Fluent ID for the
    // direct-auth exchange to complete, and its embedded wallet not a signer.
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER, embeddedWallet: true });
    fixture.smartAccountReady = true;
    const { rerenderWidget } = renderWidget({ withHook: false });
    await flush();
    expectWalletUserUnchanged();

    // And `linkX()` takes the mismatch path: the leftover session is logged out and, on the
    // commit that reports nobody, the connected wallet signed in — nothing of the wallet user
    // changed by either.
    const call = linkXInFlight();
    await flushUntil(() => fixture.logoutCalls === 1);
    expect(call.settled()).toBeNull();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "redirecting" });
    expect(fixture.journal).toEqual(["logout", "generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker", "linkTwitter"]);
    expect(fixture.siwe.generateCalls[0]?.address).toBe(EOA_CHECKSUM);
    expect(JSON.parse(storedMarker() ?? "null")?.subject).toBe(WALLET_PRIVY_USER);
    expectWalletUserUnchanged();
  });

  it("builds no kernel on the leftover session's embedded wallet for a different connected wallet", async () => {
    connectWallet(EOA);
    privySignedInBySiwe(OTHER_EOA, { userId: OTHER_WALLET_PRIVY_USER, embeddedWallet: true });
    // A refresh that would succeed, were anything to ask for one.
    fixture.refreshCompletesInitialization = true;
    renderWidget({ withHook: false });
    await flush();

    expect(fixture.zerodevRefreshCalls).toBe(0);
    expect(fixture.smartAccountReady).toBe(false);
    expectWalletUserUnchanged();
  });

  it("discards another wallet's marker on a return that restores an embedded wallet beside that wallet's session", async () => {
    // The user switched wallets across the redirect, and the restored session — the other
    // wallet's, X linked, an embedded wallet attached — has a kernel ready. It is still the
    // other wallet's: the marker is dropped, nothing is POSTed, and no Fluent ID is made of it.
    arriveFromWalletRedirect(OTHER_EOA);
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("pending");

    privySignedInBySiwe(EOA, { hasX: true, embeddedWallet: true });
    fixture.smartAccountReady = true;
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();
    expectWalletUserUnchanged();
  });

  it("stays a wallet's session when the connector drops the wallet, embedded wallet and all", async () => {
    connectWallet(EOA);
    privySignedOut();
    fixture.siwe.onLogin = () => privySignedInBySiwe(EOA, { embeddedWallet: true });
    const { rerenderWidget } = renderWidget({ withHook: false });
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expectWalletUserUnchanged();

    // The connector reports the wallet gone — the user disconnected it in MetaMask — while Privy
    // keeps the session SIWE made, with a kernel its embedded wallet could build. Nobody owns
    // the connected wallet now, because there is none; the session is a wallet's all the same.
    fixture.wallet.connected = false;
    fixture.wallet.address = undefined;
    fixture.smartAccountReady = true;
    await act(async () => {
      rerenderWidget();
    });
    await flush();

    expect(probe.account?.type).toBeUndefined();
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(fixture.zerodevRefreshCalls).toBe(0);
    expect(fixture.logoutCalls).toBe(0);

    // Back, the wallet is the account again, over the session that is still its own.
    fixture.wallet.connected = true;
    fixture.wallet.address = EOA;
    fixture.smartAccountReady = false;
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expectWalletUserUnchanged();
    // Over the session that is still its own: nothing was signed out, and the token minted
    // before the hop is still the wallet's cached one — no second challenge.
    await probe.getAuthToken();
    expect(fixture.logoutCalls).toBe(0);
    expect(wire.challenges).toBe(1);
    expect(wire.privyExchanges).toBe(0);
  });

  it("creates no Fluent ID on a return mount Privy restores before the wallet has reconnected", async () => {
    // The page back from X: the marker in the tab, Privy restoring the wallet's user — X on it,
    // an embedded wallet beside it, a kernel ready — a tick before Reown has reconnected the
    // wallet. The guard holds with no wallet to own, and the link completes once it is back.
    seedMarker(JSON.stringify({ started: Date.now(), subject: WALLET_PRIVY_USER }));
    privySignedInBySiwe(EOA, { hasX: true, embeddedWallet: true });
    fixture.smartAccountReady = true;
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();

    expect(probe.account?.type).toBeUndefined();
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(fixture.zerodevRefreshCalls).toBe(0);
    expectNoWork();
    expect(storedMarker()).not.toBeNull();

    fixture.wallet.connected = true;
    fixture.wallet.address = EOA;
    fixture.wallet.hasClient = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(probe.hook?.x).toEqual(X_ACCOUNT);
    expect(wire.identityPosts).toHaveLength(1);
    expect(storedMarker()).toBeNull();
    expectNoSiwe();
    expectWalletUserUnchanged();
  });
});

describe("a wallet user's Privy session is never a Fluent ID sign-in in flight", () => {
  // Criterion 18 (real use, 2026-10-09). The account model read `privyAuthenticated` with no
  // connected account as a Fluent ID whose smart account was on its way — `connecting` — which
  // a wallet's SIWE session satisfied for as long as it lived once the connector reported no
  // wallet: on the return from X before Reown had reconnected it, and after the person
  // disconnected it. The session is the wallet's; without the wallet the page is disconnected.

  it("surfaces Privy's refusal on the return, keeps the wallet as the account with no pending state, and runs no second SIWE", async () => {
    // The page back from X: the marker in the tab, Privy restoring the wallet's user — without
    // X, because Privy refused the link — while wagmi is still reconnecting the wallet.
    seedMarker(JSON.stringify({ started: Date.now(), subject: WALLET_PRIVY_USER }));
    privySignedInBySiwe(EOA);
    fixture.smartAccountReady = true;
    fixture.wallet.reconnecting = true;
    const { rerenderWidget } = renderWidget({ withHook: true });
    await flush();

    // A wallet's session restoring its wallet, not a Fluent ID on its way in.
    expect(probe.status).toBe("restoring");
    expect(probe.hook?.status).toBe("idle");
    expect(storedMarker()).not.toBeNull();
    expectNoWork();

    // The wallet is back: the hook resumes the return, and the gate waits for the X account
    // that is not coming.
    connectWallet(EOA);
    fixture.wallet.reconnecting = false;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "pending");
    expect(probe.status).toBe("connected");
    expect(probe.account?.type).toBe("eoa");
    expectNoWork();

    // Privy's answer for the return: that X account belongs to another Privy user.
    await act(async () => {
      fixture.linkAccountCallbacks?.onError?.("linked_to_another_user", { linkMethod: "twitter_oauth" });
    });
    await flushUntil(() => probe.hook?.status === "error");

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("linked_to_another_user");
    expect(storedMarker()).toBeNull();
    expectNoWork();
    expectNoSiwe();
    // The account is the wallet, the status settled, and no render in between said `connecting`.
    expect(probe.status).toBe("connected");
    expect(renderedStatuses).not.toContain("connecting");
    expect(screen.queryByText("Connecting…")).toBeNull();
    expectWalletUserUnchanged();
    // The SIWE session is kept: it owns this wallet, and the next link needs no new signature.
    expect(fixture.logoutCalls).toBe(0);

    // Link X again, with another X account: no SIWE step, no logout, straight to the hop.
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(fixture.linkTwitterCalls).toBe(1);
    expect(fixture.journal.slice(-2)).toEqual(["marker", "linkTwitter"]);
    expect(probe.status).toBe("connected");
    expect(probe.account?.type).toBe("eoa");
    expect(renderedStatuses).not.toContain("connecting");
  });

  it("is disconnected, and Connect opens the modal, when the wallet is gone and the SIWE session lives — on the same page and after a remount", async () => {
    connectWallet(EOA);
    privySignedOut();
    const first = renderWidget({ withHook: false });
    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });
    await act(async () => {
      first.rerenderWidget();
    });
    await flush();
    expect(probe.status).toBe("connected");
    expect(probe.account?.type).toBe("eoa");

    // The person disconnects the wallet in MetaMask; Privy keeps the session SIWE made.
    fixture.wallet.connected = false;
    fixture.wallet.address = undefined;
    await act(async () => {
      first.rerenderWidget();
    });
    await flush();

    expect(probe.status).toBe("disconnected");
    expect(probe.account?.type).toBeUndefined();
    expect(screen.queryByText("Connecting…")).toBeNull();
    fireEvent.click(screen.getByText("Connect Wallet"));
    await flush();
    expect(connectModalOpen()).toBe(true);
    // Only the status moved: the session is the wallet's still, and nothing of a Fluent ID ran.
    expect(fixture.logoutCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(fixture.zerodevRefreshCalls).toBe(0);
    expect(renderedStatuses).not.toContain("connecting");

    // A reload: Privy restores the wallet's session, the connector reports no wallet.
    first.unmount();
    renderedStatuses = [];
    renderWidget({ withHook: false });
    await flush();

    expect(probe.status).toBe("disconnected");
    expect(probe.account?.type).toBeUndefined();
    expect(renderedStatuses).not.toContain("connecting");
    expect(connectModalOpen()).toBe(false);
    fireEvent.click(screen.getByText("Connect Wallet"));
    await flush();
    expect(connectModalOpen()).toBe(true);
    expect(fixture.logoutCalls).toBe(0);
    expect(sessionChanges).toEqual([]);
    expect(wire.privyExchanges).toBe(0);
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("every rejection is one of linkX()'s own codes", () => {
  it("hands a direct caller link_failed when refreshUser() rejects with an ordinary error", async () => {
    seedSession();
    fixture.onRefreshUser = () => {
      throw new Error("Privy is unreachable");
    };
    renderWidget({ withHook: false });

    const error = await linkXRefusal();

    expect(error).toBeInstanceOf(FluentAuthError);
    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Privy is unreachable");
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(0);
  });

  it("reports the same code through useLinkX()", async () => {
    seedSession();
    fixture.onRefreshUser = () => {
      throw new Error("Privy is unreachable");
    };
    renderWidget({ withHook: true });

    let refusal: FluentAuthError | null = null;
    const pending = probe.hook?.linkX().catch((err: FluentAuthError) => {
      refusal = err;
    });
    await flushUntil(() => probe.hook?.status === "error");
    await pending;

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("link_failed");
    expect(refusal).toBe(probe.hook?.error);
  });
});

describe("the identity token the POST carries", () => {
  it("is the one Privy publishes after refreshUser()", async () => {
    seedSession();
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(fixture.refreshUserCalls).toBe(1);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body)).identityToken).toBe(
      fixture.identityTokens.value,
    );
    expect(fixture.linkTwitterCalls).toBe(0);
  });

  it("fails the call with link_failed when Privy never publishes one", async () => {
    seedSession();
    // `refreshUser()` resolves and the store never changes: no commit carries a new token.
    fixture.onRefreshUser = () => {};
    renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(0);
  });
});

describe("useLinkX, imported from the package root", () => {
  it("is the hook the SDK exports", () => {
    expect(typeof useLinkX).toBe("function");
  });
});

/**
 * Criterion 17 (real use, 2026-10-09): every Privy call after SIWE is the signed-in render's.
 * In 2.25.0 a link method closes over the `authenticated` and `user` of the render that made
 * it, and the one `linkX()` started with on the wallet path — nobody signed in yet — answers
 * `onError(must_be_authenticated)` and goes nowhere; the fixture's `useLinkAccount` refuses the
 * same way. So the hop has to come from a render that has published the user SIWE signed in,
 * and a refusal Privy raises before the page leaves is the call's rejection, not `redirecting`.
 */
describe("linkX(): the hop is Privy's of the render that published the signed-in user", () => {
  it("calls linkTwitter from the render that published the user SIWE signed in, and resolves redirecting once the navigation is requested", async () => {
    connectWallet(EOA);
    privySignedOut();
    let requestNavigation: () => void = () => {};
    fixture.onLinkTwitter = () =>
      new Promise<void>((resolve) => {
        requestNavigation = resolve;
      });
    renderWidget({ withHook: true });

    const call = linkXInFlight();
    await flushUntil(() => fixture.journal.at(-1) === "linkTwitter");

    // Privy's guard let the call through: it came from a render that had the user SIWE signed
    // in — never from the signed-out render the call started on — and the call waits for the
    // navigation rather than answering `redirecting` ahead of it.
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker", "linkTwitter"]);
    expect(fixture.linkTwitterRenders).toEqual([WALLET_PRIVY_USER]);
    expect(fixture.navigations).toBe(0);
    expect(call.settled()).toBeNull();
    expect(probe.hook?.status).not.toBe("redirecting");

    requestNavigation();
    await flushUntil(() => call.settled() !== null);

    expect(call.settled()).toEqual({ status: "redirecting" });
    expect(fixture.navigations).toBe(1);
    expect(JSON.parse(String(storedMarker()))).toEqual({ started: expect.any(Number), subject: WALLET_PRIVY_USER });
    expectWalletUserUnchanged();
  });

  it("fails link_failed, with no linkTwitter and no marker, when no render publishes the user SIWE signed in within the bound", async () => {
    connectWallet(EOA);
    privySignedOut();
    // Privy answers the login with the wallet's user and never commits a render of them.
    fixture.siwe.onLogin = () => ({ id: WALLET_PRIVY_USER, linkedAccounts: [walletEntry(EOA)] });
    renderWidget({ withHook: true });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const statuses: string[] = [];
    const pending = probe.linkX().then(
      () => {
        statuses.push("resolved");
      },
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.journal.at(-1) === "marker");
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIWE_STEP_TIMEOUT_MS - 1);
    });
    expect(refusals).toHaveLength(0);
    expect(storedMarker()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    await pending;

    expect(statuses).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toBeInstanceOf(FluentAuthError);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(refusals[0]?.message).toMatch(/did not publish the user it signed in/);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(fixture.navigations).toBe(0);
    expect(fixture.journal).toEqual(["generateSiweMessage", "sign", "loginWithSiwe", "signChallenge", "marker"]);
    expect(storedMarker()).toBeNull();
    expect(wire.identityPosts).toHaveLength(0);
    expectWalletUserUnchanged();
  });

  it("rejects the call with the refusal Privy raised before the page left, and clears the marker", async () => {
    connectWallet(EOA);
    privySignedOut();
    let requestNavigation: () => void = () => {};
    fixture.onLinkTwitter = () =>
      new Promise<void>((resolve) => {
        requestNavigation = resolve;
      });
    renderWidget({ withHook: true });

    const statuses: string[] = [];
    let refusal: FluentAuthError | null = null;
    const pending = (probe.hook as NonNullable<typeof probe.hook>).linkX().then(
      () => {
        statuses.push("resolved");
      },
      (err: FluentAuthError) => {
        refusal = err;
      },
    );
    await flushUntil(() => fixture.journal.at(-1) === "linkTwitter");
    expect(refusal).toBeNull();

    // What 2.25.0 does with a hop it refuses: `onError` first, then nothing — no navigation.
    await act(async () => {
      fixture.linkAccountCallbacks?.onError?.("must_be_authenticated", { linkMethod: "twitter" });
    });
    await pending;
    await flushUntil(() => probe.hook?.status === "error");

    expect(statuses).toEqual([]);
    expect(refusal).toBeInstanceOf(FluentAuthError);
    expect((refusal as unknown as FluentAuthError).code).toBe("link_failed");
    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error).toBe(refusal);
    expect(storedMarker()).toBeNull();
    expect(wire.identityPosts).toHaveLength(0);
    expectWalletUserUnchanged();

    // A navigation Privy requests after all changes nothing: the call has its answer.
    requestNavigation();
    await flush();
    expect(probe.hook?.status).toBe("error");
    expect(storedMarker()).toBeNull();
  });

  it.each([
    ["oauth_user_denied", "user_rejected"],
    ["linked_to_another_user", "linked_to_another_user"],
  ])("maps Privy's %s raised during the hop to %s on the call itself", async (privyCode, fluentCode) => {
    seedSession();
    fixture.onLinkTwitter = () => new Promise<void>(() => {});
    renderWidget({ withHook: false });

    let refusal: FluentAuthError | null = null;
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusal = err;
      },
    );
    await flushUntil(() => fixture.journal.at(-1) === "linkTwitter");
    await act(async () => {
      fixture.linkAccountCallbacks?.onError?.(privyCode, { linkMethod: "twitter_oauth" });
    });
    await pending;

    expect((refusal as unknown as FluentAuthError)?.code).toBe(fluentCode);
    expect(storedMarker()).toBeNull();
    expect(fixture.navigations).toBe(0);
  });

  it("fails link_failed, with the marker cleared, when Privy never starts the redirect within the bound", async () => {
    seedSession();
    fixture.onLinkTwitter = () => new Promise<void>(() => {});
    renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await flushUntil(() => fixture.journal.at(-1) === "linkTwitter");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIWE_STEP_TIMEOUT_MS + 1);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(refusals[0]?.message).toMatch(/did not start the redirect to X/);
    expect(storedMarker()).toBeNull();
  });
});


describe("Link X return through the real Reown wallet hook", () => {
  it.each(["linked", "linked_to_another_user"] as const)("restores the EOA on a %s return without a wallet prop", async outcome => {
    fixture.realReown = true;
    // Use a fresh adapter key for each page fixture; both configurations have the same policy.
    seedMarker(JSON.stringify({ started: Date.now(), subject: WALLET_PRIVY_USER }));
    seedWalletRefreshCredential();
    privySignedInBySiwe(EOA, { hasX: outcome === "linked" });
    fixture.smartAccountReady = false;
    fixture.embeddedWalletCount = 0;
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    const result = render(
      <FluentWidget
        config={{ ...CONFIG, disableAnalytics: outcome === "linked" }}
        onSessionChange={session => { sessionChanges.push(session); }}
        renderHome={() => <HookProbe />}
      />,
    );
    await act(async () => { await fixture.reownStartup; });
    await flushUntil(() => probe.account?.type === "eoa");
    expect(fixture.reownSavedConnection?.address?.toLowerCase()).toBe(EOA);
    expect(fixture.reownConnect).toHaveBeenCalledOnce();
    expect(fixture.wallet.connected).toBe(false);
    expect(probe.account?.address?.toLowerCase()).toBe(EOA);
    expect(probe.status).toBe("connected");
    if (outcome === "linked") {
      await waitFor(() => expect(probe.hook?.status).toBe("linked"));
      expect(probe.hook?.status).toBe("linked");
      expect(probe.hook?.x).toEqual(X_ACCOUNT);
      expect(wire.identityPosts).toHaveLength(1);
      expect(wire.refreshes).toBe(1);
    } else {
      await flushUntil(() => probe.hook?.status === "pending");
      await act(async () => {
        fixture.linkAccountCallbacks?.onError?.("linked_to_another_user", { linkMethod: "twitter_oauth" });
      });
      await flushUntil(() => probe.hook?.status === "error");
      expect(probe.hook?.error?.code).toBe("linked_to_another_user");
      expect(probe.hook?.status).toBe("error");
      expect(wire.identityPosts).toHaveLength(0);
    }
    expect(probe.status).toBe("connected");
    expect(probe.account?.type).toBe("eoa");
    expect(probe.account?.address?.toLowerCase()).toBe(EOA);
    expect(renderedStatuses).not.toContain("connecting");
    expect(storedMarker()).toBeNull();
    expectNoSiwe();
    expect(fixture.logoutCalls).toBe(0);
    expect(wire.challenges).toBe(0);
    expect(wire.privyExchanges).toBe(0);
    expect(sessionChanges).toEqual([]);
    result.unmount();
  });
});
