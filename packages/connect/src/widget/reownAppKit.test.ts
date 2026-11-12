/**
 * The External wallet wiring of `reownAppKit.tsx`: the wallets the connect modal offers, the
 * options `ReownProvider` gives the wagmi adapter and AppKit, and the saved connections a page
 * restores on startup. The module's source is transpiled and run in a `node:vm` context with its
 * imports injected; wagmi's config, hydration, reconnect and connect run for real.
 *
 * Fakes:
 * - `createAppKit` (`@reown/appkit@1.8.20`): a spy, or the startup calls it makes into its adapter,
 *   in that version's order;
 * - `WagmiAdapter` (`@reown/appkit-adapter-wagmi@1.8.20`), around a real `wagmi@2.19.5` config;
 * - the wallet connectors: `mock` of `@wagmi/core@2.22.1`, `baseAccount` of
 *   `@wagmi/connectors@5.9.9` over a fake EIP-1193 provider, and plain connectors in the shape
 *   `@wagmi/core@2.22.1` calls;
 * - the wagmi hooks `useReownWallet` reads, as `wagmi@2.19.5` returns them;
 * - browser storage, a `Map` behind wagmi's `createStorage`, and `window.location.origin`.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, type Mock, vi } from "vitest";
import React from "react";
// @ts-expect-error react-test-renderer has no declarations in this test suite.
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type Config,
  type Connector,
  type CreateConnectorFn,
  createConfig,
  createStorage,
  http,
  WagmiProvider,
  WagmiContext,
  Hydrate,
} from "wagmi";
import {
  connect,
  disconnect,
  getAccount,
  getConnections,
  reconnect,
  switchChain,
} from "wagmi/actions";
import { hydrate, version } from "@wagmi/core";
import { baseAccount, mock } from "wagmi/connectors";
import ts from "typescript";

/** The slice of a react-test-renderer instance these tests call. */
type TestRenderer = { update(element: React.ReactNode): void; unmount(): void };
/** A chain in the shape `reownAppKit.tsx` hands to wagmi and AppKit. */
type Chain = typeof chain;
/** The options `ReownProvider` gives the wagmi adapter. */
type AdapterOptions = { ssr: boolean; networks: [Chain, ...Chain[]] };
/** The startup adapter `startup()` builds, as the faked AppKit calls it. */
type StartupAdapter = {
  wagmiConfig: Config;
  syncConnections(): Promise<void>;
  syncConnection(options: { id: string; chainId?: number }): Promise<{
    address: string | undefined;
    chainId: number | undefined;
    provider: unknown;
  }>;
};

const installed = ts.transpileModule(
  readFileSync(new URL("./reownAppKit.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const chain = {
  id: 20994,
  name: "Fluent Testnet",
  testnet: true,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://unused.invalid"] } },
};
const mainnet = { ...chain, id: 25363, name: "Fluent", testnet: false };
const sepolia = { ...chain, id: 11155111, name: "Sepolia" };
const ethereum = { ...mainnet, id: 1, name: "Ethereum" };
const getFluentBridgeRoute = (network: string) => ({
  source: network === "mainnet" ? ethereum : sepolia,
});
const address = "0x1111111111111111111111111111111111111111" as const;

/** The one connector a fake config of this file registers. */
function onlyConnector(config: Config): Connector {
  const [connector] = config.connectors;
  if (!connector) throw new Error("the config registers no connector");
  return connector;
}

// Runs `ReownProvider`'s source with its UI boundaries stubbed and returns the options it gives
// the adapter and AppKit.
function providerDefaults(source: string, reconnectOnMount: boolean, network = "testnet") {
  let adapterOptions: AdapterOptions | undefined;
  const createAppKit = vi.fn();
  const code = source
    .slice(
      source.indexOf("export const REOWN_PROJECT_ID ="),
      source.indexOf("export function useReownWallet()"),
    )
    .replace(/^export /gm, "");
  const provider = runInNewContext(
    `${code}\nReownProvider({ children: 'game', reconnectOnMount, network });`,
    {
      reconnectOnMount,
      network,
      getFluentBridgeRoute,
      FLUENT_CONNECT_REOWN_PROJECT_ID: "fixture",
      FLUENT_CONNECT_DEFAULT_ASSETS: {},
      QueryClient: class {},
      WagmiAdapter: class {
        wagmiConfig = {};
        constructor(options: AdapterOptions) {
          adapterOptions = options;
        }
      },
      createAppKit,
      window: { location: { origin: "http://localhost:5173" } },
      useEffect: () => {},
      WagmiContext,
      useMemo: (fn: () => unknown) => fn(),
      getFluentChainForNetwork: (network: string) => (network === "mainnet" ? mainnet : chain),
      WagmiProvider: "WagmiProvider",
      QueryClientProvider: "QueryClientProvider",
      _jsx: (type: unknown, props: unknown) => ({ type, props }),
    },
  );
  return {
    adapterOptions,
    reconnectOnMount: provider.props.reconnectOnMount,
    appKit: createAppKit.mock.calls[0]?.[0],
  };
}

function savedBaseWallet() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
    if (method === "eth_chainId") return "0x5202";
    if (method === "wallet_connect") {
      return { accounts: [{ address }], chainIds: ["0x5202"] };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  });
  const provider = {
    request,
    on: vi.fn(),
    removeListener: vi.fn(),
    disconnect: vi.fn(),
  };
  const saved = new Map<string, string>([
    ["practice", "saved game"],
    ["privy:session", "saved session"],
  ]);
  const config = createConfig({
    chains: [chain],
    transports: { [chain.id]: http() },
    multiInjectedProviderDiscovery: false,
    storage: createStorage({
      storage: {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => {
          saved.set(key, value);
        },
        removeItem: (key) => {
          saved.delete(key);
        },
      },
    }),
    connectors: [
      (config: Parameters<CreateConnectorFn>[0]) => ({
        ...baseAccount()(config),
        getProvider: async () => provider,
      }),
    ],
  });
  // A persisted connection has an old connector uid, as on a real reload.
  config.setState((state) => ({
    ...state,
    current: "previous-page",
    connections: new Map([
      [
        "previous-page",
        {
          accounts: [address],
          chainId: chain.id,
          connector: {
            id: "baseAccount",
            uid: "previous-page",
            type: "baseAccount",
          } as Connector,
        },
      ],
    ]),
  }));
  return { config, request, saved };
}

describe("Fluent Connect startup", () => {
  it("routes a selected extension directly to its connector and WalletConnect to its QR flow", async () => {
    const open = vi.fn();
    const connectAsync = vi.fn();
    const connectors = [
      { uid: "auth", id: "AUTH", name: "Auth" },
      { uid: "injected", id: "injected", name: "Injected" },
      { uid: "mm", id: "io.metamask", name: "MetaMask" },
      { uid: "wc", id: "walletConnect", name: "WalletConnect" },
    ];
    const start = installed.indexOf("function useReownWallet() {");
    const end = installed.length;
    const wallet = runInNewContext(`${installed.slice(start, end)}\nuseReownWallet();`, {
      // `useReownWallet` reads the AppKit instance the module holds, since `useAppKit()`
      // throws before `createAppKit` has run; the slice starts past that declaration.
      appKitModal: { open },
      useAccount: () => ({ status: "disconnected" }),
      useDisconnect: () => ({}),
      useWalletClient: () => ({}),
      useSwitchChain: () => ({}),
      useConnect: () => ({ connectors, connectAsync }),
      useFluentWidgetNetwork: () => ({ chain }),
      useMemo: (fn: () => unknown) => fn(),
      useCallback: (fn: unknown) => fn,
      reownConfigured: true,
      FLUENT_CONNECT_DEFAULT_ASSETS: {
        walletConnectIcon: "walletconnect.svg",
      },
    });
    expect(wallet.choices.map(({ name }: { name: string }) => name)).toEqual([
      "MetaMask",
      "WalletConnect",
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(connectAsync).not.toHaveBeenCalled();
    await wallet.connectChoice("mm");
    expect(connectAsync).toHaveBeenCalledWith({
      connector: connectors[2],
      chainId: 20994,
    });
    expect(open).not.toHaveBeenCalled();
    await wallet.connectChoice("wc");
    expect(open).toHaveBeenCalledWith({ view: "ConnectingWalletConnectBasic" });
    await expect(wallet.connectChoice("removed")).rejects.toThrow("no longer available");
  });

  it("reproduces the interactive Base request in the upstream reconnect path", async () => {
    const { config, request } = savedBaseWallet();
    await reconnect(config);
    expect(request.mock.calls.some(([rpc]) => rpc.method === "eth_requestAccounts")).toBe(true);
  });

  it("starts silently with a saved Base account and still supports explicit connection", async () => {
    const defaults = providerDefaults(installed, false);
    expect(defaults.appKit.enableReconnect).toBe(false);
    expect(defaults.reconnectOnMount).toBe(false);
    for (let reload = 0; reload < 2; reload++) {
      const { config, request, saved } = savedBaseWallet();
      let hydration: TestRenderer | undefined;
      await act(async () => {
        hydration = create(
          React.createElement(Hydrate, {
            config,
            reconnectOnMount: defaults.reconnectOnMount,
          }),
        );
      });
      act(() => hydration?.unmount());
      expect(request).not.toHaveBeenCalled();
      expect(getAccount(config).status).toBe("disconnected");
      expect(saved.get("practice")).toBe("saved game");
      expect(saved.get("privy:session")).toBe("saved session");
      await connect(config, { connector: onlyConnector(config) });
      expect(getAccount(config).address).toBe(address);
      expect(
        request.mock.calls.filter(([rpc]) => rpc.method === "eth_requestAccounts"),
      ).toHaveLength(1);
    }
  });

  it.each<[string, Chain, Chain]>([
    ["testnet", chain, sepolia],
    ["mainnet", mainnet, ethereum],
  ])("supports the %s bridge source without automatic reconnection", (network, fluent, source) => {
    const defaults = providerDefaults(installed, false, network);
    expect(defaults.adapterOptions?.networks).toEqual([fluent, source]);
    expect(defaults.appKit.networks).toEqual([fluent, source]);
    expect(defaults.appKit.defaultNetwork).toEqual(fluent);
    expect(defaults.adapterOptions?.ssr).toBe(true);
    expect(defaults.appKit.enableReconnect).toBe(false);
    expect(defaults.reconnectOnMount).toBe(false);
  });

  it("enables both restore layers only when explicitly configured", () => {
    const defaults = providerDefaults(installed, true);
    expect(defaults.appKit.enableReconnect).toBe(true);
    expect(defaults.reconnectOnMount).toBe(true);
  });
});

function setup() {
  let config: Config | undefined;
  const saved = new Map<string, string>();
  const connectWallet = vi.fn();
  const createAppKit = vi.fn();
  const code = installed
    .slice(
      installed.indexOf("export const REOWN_PROJECT_ID ="),
      installed.indexOf("export function useReownWallet()"),
    )
    .replace(/^export /gm, "");
  const Provider = runInNewContext(`${code}\nReownProvider;`, {
    FLUENT_CONNECT_REOWN_PROJECT_ID: "fixture",
    FLUENT_CONNECT_DEFAULT_ASSETS: {},
    QueryClient,
    QueryClientProvider,
    WagmiAdapter: class {
      wagmiConfig: Config;
      constructor(options: AdapterOptions) {
        config = createConfig({
          ssr: options.ssr,
          chains: options.networks,
          transports: Object.fromEntries(options.networks.map((network) => [network.id, http()])),
          multiInjectedProviderDiscovery: false,
          storage: createStorage({
            storage: {
              getItem: (key) => saved.get(key) ?? null,
              setItem: (key, value) => {
                saved.set(key, value);
              },
              removeItem: (key) => {
                saved.delete(key);
              },
            },
          }),
          connectors: [
            (params: Parameters<CreateConnectorFn>[0]) => {
              const connector = mock({ accounts: [address] })(params);
              return {
                ...connector,
                // The wrapper keeps `connect`'s generic signature, which a spread of its parameters loses.
                connect: ((...args) => {
                  connectWallet();
                  return connector.connect(...args);
                }) as typeof connector.connect,
              };
            },
          ],
        });
        this.wagmiConfig = config;
      }
    },
    createAppKit,
    window: { location: { origin: "http://localhost:5173" } },
    useMemo: React.useMemo,
    useEffect: React.useEffect,
    WagmiContext,
    hydrate,
    reconnect,
    getFluentBridgeRoute,
    getFluentChainForNetwork: () => chain,
    WagmiProvider,
    Fragment: React.Fragment,
    _jsx: React.createElement,
  });
  const getConfig = () => {
    if (!config) throw new Error("ReownProvider has not built the wagmi adapter yet");
    return config;
  };
  return { Provider, getConfig, connectWallet, createAppKit };
}

describe("Connect wallet provider lifecycle", () => {
  // AppKit owns the page's one WalletConnect Core: the module-level cache keeps it to one
  // instance per network when an App remounts `ReownProvider`.
  it("builds AppKit once however many times the provider is rebuilt", async () => {
    const { Provider, createAppKit } = setup();
    for (let rebuild = 0; rebuild < 5; rebuild++) {
      let renderer: TestRenderer | undefined;
      await act(async () => {
        renderer = create(
          React.createElement(Provider, null, React.createElement("span", null, "Game")),
        );
      });
      act(() => renderer?.unmount());
    }
    expect(createAppKit).toHaveBeenCalledOnce();
  });

  it.each([chain.id, sepolia.id])(
    "preserves a wallet on chain %s when the account panel opens and closes",
    async (chainId) => {
      const { Provider, getConfig, connectWallet } = setup();
      let renderer: TestRenderer | undefined;
      const render = (open: boolean) =>
        React.createElement(
          Provider,
          null,
          React.createElement("span", null, open ? "Account" : "Game"),
        );
      try {
        await act(async () => {
          renderer = create(render(false));
        });
        const config = getConfig();
        expect(getAccount(config).isConnected).toBe(false);
        expect(connectWallet).not.toHaveBeenCalled();
        await act(async () => {
          await connect(config, { connector: onlyConnector(config) });
        });
        expect(getAccount(config).address).toBe(address);
        await act(async () => {
          await switchChain(config, { chainId });
        });
        for (const open of [true, false, true]) {
          await act(async () => {
            renderer?.update(render(open));
          });
          expect(getAccount(config).address).toBe(address);
          expect(getAccount(config).isConnected).toBe(true);
          expect(getAccount(config).chainId).toBe(chainId);
        }
        expect(connectWallet).toHaveBeenCalledOnce();
        await act(async () => {
          await disconnect(config);
        });
        await act(async () => {
          renderer?.update(render(false));
        });
        expect(getAccount(config).isConnected).toBe(false);
        expect(getAccount(config).address).toBeUndefined();
      } finally {
        act(() => renderer?.unmount());
      }
    },
  );
});

// Real wagmi hydration/reconnect; AppKit's network/UI work is replaced by its startup
// calls into the adapter. The saved uid deliberately belongs to a previous page.
function startup(policy: boolean | undefined, definitions: [string, string][]) {
  const [savedId, savedType] = definitions[0] ?? [];
  if (!savedId || !savedType) throw new Error("startup() needs the saved connector first");
  let adapter: StartupAdapter | undefined;
  let startupPromise: Promise<void> | undefined;
  let savedConnection: Awaited<ReturnType<StartupAdapter["syncConnection"]>> | undefined;
  let initialConnectionCount: number | undefined;
  const startupOrder: string[] = [];
  const calls = new Map<string, Record<"getProvider" | "isAuthorized" | "connect", Mock>>();
  const code = installed
    .slice(
      installed.indexOf("export const REOWN_PROJECT_ID ="),
      installed.indexOf("export function useReownWallet()"),
    )
    .replace(/^export /gm, "");
  const Provider = runInNewContext(`${code}\nReownProvider;`, {
    FLUENT_CONNECT_REOWN_PROJECT_ID: "fixture",
    FLUENT_CONNECT_DEFAULT_ASSETS: {},
    QueryClient,
    QueryClientProvider,
    WagmiContext,
    WagmiProvider,
    hydrate,
    reconnect,
    useMemo: React.useMemo,
    useEffect: React.useEffect,
    getFluentBridgeRoute,
    getFluentChainForNetwork: () => chain,
    window: { location: { origin: "http://localhost" } },
    _jsx: React.createElement,
    WagmiAdapter: class implements StartupAdapter {
      wagmiConfig: Config;
      constructor(options: AdapterOptions) {
        const saved = new Map<string, string>();
        this.wagmiConfig = createConfig({
          ssr: options.ssr,
          chains: options.networks,
          transports: Object.fromEntries(options.networks.map((c) => [c.id, http()])),
          multiInjectedProviderDiscovery: false,
          storage: createStorage({
            storage: {
              getItem: async (key) => saved.get(key) ?? null,
              setItem: (key, value) => {
                saved.set(key, value);
              },
              removeItem: (key) => {
                saved.delete(key);
              },
            },
          }),
          connectors: definitions.map(([id, type]) => () => {
            const provider = {};
            const original = {
              name: id,
              getProvider: async () => provider,
              isAuthorized: async () => true,
              connect: async () => ({ accounts: [address], chainId: chain.id }),
              disconnect: async () => {},
              getAccounts: async () => [address],
              getChainId: async () => chain.id,
              onAccountsChanged() {},
              onChainChanged() {},
              onDisconnect() {},
            };
            const spies = {
              getProvider: vi.fn(original.getProvider),
              isAuthorized: vi.fn(original.isAuthorized),
              connect: vi.fn(original.connect),
            };
            calls.set(id, spies);
            // wagmi types `connect` as generic over `withCapabilities`, which this fake ignores.
            return { ...original, id, type, ...spies } as ReturnType<CreateConnectorFn>;
          }),
        });
        // Only storage is seeded: the new page starts with no in-memory connection.
        void this.wagmiConfig.storage?.setItem("store", {
          // wagmi versions persisted state by its package major version.
          version: Number.parseInt(version, 10),
          state: {
            chainId: chain.id,
            current: "previous-page",
            connections: new Map([
              [
                "previous-page",
                {
                  accounts: [address],
                  chainId: chain.id,
                  connector: {
                    id: savedId,
                    type: savedType,
                    uid: "previous-page",
                  },
                },
              ],
            ]),
          },
        });
      }
      async syncConnections() {
        await reconnect(this.wagmiConfig);
      }
      async syncConnection({ id }: { id: string }) {
        // Match the installed adapter: read wagmi connections before getting the provider.
        const connection = getConnections(this.wagmiConfig).find((c) => c.connector.id === id);
        const provider = await this.wagmiConfig.connectors.find((c) => c.id === id)?.getProvider();
        return { address: connection?.accounts[0], chainId: connection?.chainId, provider };
      }
    },
    createAppKit: (options: { adapters: [StartupAdapter]; enableReconnect: boolean }) => {
      const [startupAdapter] = options.adapters;
      adapter = startupAdapter;
      initialConnectionCount = startupAdapter.wagmiConfig.state.connections.size;
      expect(options.enableReconnect).toBe(policy !== false);
      // Installed AppKit order: syncExistingConnection, then syncAdapterConnections.
      startupPromise = Promise.resolve().then(async () => {
        if (!options.enableReconnect) return;
        startupOrder.push("syncConnection");
        try {
          savedConnection = await startupAdapter.syncConnection({
            id: savedId,
            chainId: chain.id,
          });
        } catch {
          // AppKit catches a rejected saved connector and continues its aggregate sync.
        }
        startupOrder.push("syncConnections");
        await startupAdapter.syncConnections();
      });
    },
  });
  return {
    Provider,
    calls,
    initialConnectionCount: () => initialConnectionCount,
    startupOrder,
    savedConnection: () => savedConnection,
    adapter: () => {
      if (!adapter) throw new Error("ReownProvider has not created AppKit yet");
      return adapter;
    },
    finished: () => startupPromise,
  };
}

describe("silent restore policy", () => {
  const definitions: [string, string][] = [
    ["injected", "injected"],
    ["io.metamask", "injected"],
    ["walletConnect", "walletConnect"],
    ["baseAccount", "baseAccount"],
    ["coinbaseWalletSDK", "coinbaseWallet"],
    ["futureWallet", "unknown"],
  ];

  it.each([undefined, true, false])(
    "restores the allowed connectors for reconnectOnMount=%s",
    async (policy) => {
      const test = startup(policy, definitions);
      let renderer: TestRenderer | undefined;
      try {
        await act(async () => {
          renderer = create(React.createElement(test.Provider, { reconnectOnMount: policy }));
          await test.finished();
        });
        const expected =
          policy === true
            ? definitions.map(([id]) => id)
            : policy === false
              ? []
              : ["injected", "io.metamask", "walletConnect"];
        const config = test.adapter().wagmiConfig;
        expect([...config.state.connections.values()].map((c) => c.connector.id)).toEqual(expected);
        for (const [id, spies] of test.calls) {
          if (expected.includes(id)) {
            expect(spies.connect).toHaveBeenCalledWith({ isReconnecting: true });
          } else {
            expect(spies.getProvider).not.toHaveBeenCalled();
            expect(spies.isAuthorized).not.toHaveBeenCalled();
            expect(spies.connect).not.toHaveBeenCalled();
          }
        }
        // Rerendering the provider must not hydrate again and erase the live connection.
        await act(async () =>
          renderer?.update(
            React.createElement(test.Provider, { reconnectOnMount: policy }, "account panel"),
          ),
        );
        expect([...config.state.connections.values()].map((c) => c.connector.id)).toEqual(expected);
      } finally {
        act(() => renderer?.unmount());
      }
    },
  );

  it.each(definitions.slice(0, 3))(
    "restores saved %s before AppKit syncs all connections",
    async (id, type) => {
      const test = startup(undefined, [[id, type]]);
      let renderer: TestRenderer | undefined;
      try {
        await act(async () => {
          renderer = create(React.createElement(test.Provider));
          await test.finished();
        });
        expect(test.initialConnectionCount()).toBe(0);
        expect(test.startupOrder).toEqual(["syncConnection", "syncConnections"]);
        expect(test.savedConnection()).toMatchObject({ address, chainId: chain.id });
        expect(getAccount(test.adapter().wagmiConfig).address).toBe(address);
        expect(test.calls.get(id)?.connect).toHaveBeenCalledOnce();
      } finally {
        act(() => renderer?.unmount());
      }
    },
  );

  it("does not turn an empty allowlist into wagmi's reconnect-all fallback; explicit connection still works", async () => {
    const test = startup(undefined, definitions.slice(3));
    let renderer: TestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(test.Provider));
        await test.finished();
      });
      for (const spies of test.calls.values()) expect(spies.getProvider).not.toHaveBeenCalled();
      const adapter = test.adapter();
      await expect(adapter.syncConnection({ id: "baseAccount" })).rejects.toThrow(
        "explicit connection",
      );
      expect(test.calls.get("baseAccount")?.getProvider).not.toHaveBeenCalled();
      await connect(adapter.wagmiConfig, { connector: onlyConnector(adapter.wagmiConfig) });
      expect(getAccount(adapter.wagmiConfig).address).toBe(address);
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
