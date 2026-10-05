import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createConfig,
  createStorage,
  http,
  WagmiProvider,
  Hydrate,
} from "wagmi";
import {
  connect,
  disconnect,
  getAccount,
  reconnect,
  switchChain,
} from "wagmi/actions";
import { baseAccount, mock } from "wagmi/connectors";
import ts from "typescript";

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
const getFluentBridgeRoute = (network) => ({
  source: network === "mainnet" ? ethereum : sepolia,
});
const address = "0x1111111111111111111111111111111111111111";

// Execute the installed SDK's actual provider wiring with its UI boundaries
// stubbed. This reads both defaults from the code shipped to the browser.
function providerDefaults(
  source,
  reconnectOnMount = false,
  network = "testnet",
) {
  let adapterOptions;
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
        constructor(options) {
          adapterOptions = options;
        }
      },
      createAppKit,
      window: { location: { origin: "http://localhost:5173" } },
      useMemo: (fn) => fn(),
      getFluentChainForNetwork: (network) =>
        network === "mainnet" ? mainnet : chain,
      WagmiProvider: "WagmiProvider",
      QueryClientProvider: "QueryClientProvider",
      _jsx: (type, props) => ({ type, props }),
    },
  );
  return {
    adapterOptions,
    reconnectOnMount: provider.props.reconnectOnMount,
    appKit: createAppKit.mock.calls[0][0],
  };
}

function savedBaseWallet() {
  const request = vi.fn(async ({ method }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [address];
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
  const saved = new Map([
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
        setItem: (key, value) => saved.set(key, value),
        removeItem: (key) => saved.delete(key),
      },
    }),
    connectors: [
      (config) => ({
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
          },
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
    const wallet = runInNewContext(
      installed.slice(start, end) + "\nuseReownWallet();",
      {
        useAppKit: () => ({ open }),
        useAccount: () => ({ status: "disconnected" }),
        useDisconnect: () => ({}),
        useWalletClient: () => ({}),
        useSwitchChain: () => ({}),
        useConnect: () => ({ connectors, connectAsync }),
        useFluentWidgetNetwork: () => ({ chain }),
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
        reownConfigured: true,
        FLUENT_CONNECT_DEFAULT_ASSETS: {
          walletConnectIcon: "walletconnect.svg",
        },
      },
    );
    expect(wallet.choices.map(({ name }) => name)).toEqual([
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
    await expect(wallet.connectChoice("removed")).rejects.toThrow(
      "no longer available",
    );
  });

  it("reproduces the interactive Base request in the upstream reconnect path", async () => {
    const { config, request } = savedBaseWallet();
    await reconnect(config);
    expect(
      request.mock.calls.some(([rpc]) => rpc.method === "eth_requestAccounts"),
    ).toBe(true);
  });

  it("starts silently with a saved Base account and still supports explicit connection", async () => {
    const defaults = providerDefaults(installed);
    expect(defaults.appKit.enableReconnect).toBe(false);
    expect(defaults.reconnectOnMount).toBe(false);
    for (let reload = 0; reload < 2; reload++) {
      const { config, request, saved } = savedBaseWallet();
      let hydration;
      await act(async () => {
        hydration = create(
          React.createElement(Hydrate, {
            config,
            reconnectOnMount: defaults.reconnectOnMount,
          }),
        );
      });
      act(() => hydration.unmount());
      expect(request).not.toHaveBeenCalled();
      expect(getAccount(config).status).toBe("disconnected");
      expect(saved.get("practice")).toBe("saved game");
      expect(saved.get("privy:session")).toBe("saved session");
      await connect(config, { connector: config.connectors[0] });
      expect(getAccount(config).address).toBe(address);
      expect(
        request.mock.calls.filter(
          ([rpc]) => rpc.method === "eth_requestAccounts",
        ),
      ).toHaveLength(1);
    }
  });

  it.each([
    ["testnet", chain, sepolia],
    ["mainnet", mainnet, ethereum],
  ])(
    "supports the %s bridge source without automatic reconnection",
    (network, fluent, source) => {
      const defaults = providerDefaults(installed, false, network);
      expect(defaults.adapterOptions.networks).toEqual([fluent, source]);
      expect(defaults.appKit.networks).toEqual([fluent, source]);
      expect(defaults.appKit.defaultNetwork).toEqual(fluent);
      expect(defaults.adapterOptions.ssr).toBe(true);
      expect(defaults.appKit.enableReconnect).toBe(false);
      expect(defaults.reconnectOnMount).toBe(false);
    },
  );

  it("enables both restore layers only when explicitly configured", () => {
    const defaults = providerDefaults(installed, true);
    expect(defaults.appKit.enableReconnect).toBe(true);
    expect(defaults.reconnectOnMount).toBe(true);
  });
});

function setup() {
  let config;
  const saved = new Map();
  const connectWallet = vi.fn();
  const code = installed
    .slice(
      installed.indexOf("export const REOWN_PROJECT_ID ="),
      installed.indexOf("export function useReownWallet()"),
    )
    .replace(/^export /gm, "");
  const Provider = runInNewContext(code + "\nReownProvider;", {
    FLUENT_CONNECT_REOWN_PROJECT_ID: "fixture",
    FLUENT_CONNECT_DEFAULT_ASSETS: {},
    QueryClient,
    QueryClientProvider,
    WagmiAdapter: class {
      constructor(options) {
        config = createConfig({
          ssr: options.ssr,
          chains: options.networks,
          transports: Object.fromEntries(
            options.networks.map((network) => [network.id, http()]),
          ),
          multiInjectedProviderDiscovery: false,
          storage: createStorage({
            storage: {
              getItem: (key) => saved.get(key) ?? null,
              setItem: (key, value) => saved.set(key, value),
              removeItem: (key) => saved.delete(key),
            },
          }),
          connectors: [
            (params) => {
              const connector = mock({ accounts: [address] })(params);
              return {
                ...connector,
                connect: (...args) => {
                  connectWallet();
                  return connector.connect(...args);
                },
              };
            },
          ],
        });
        this.wagmiConfig = config;
      }
    },
    createAppKit: vi.fn(),
    window: { location: { origin: "http://localhost:5173" } },
    useMemo: React.useMemo,
    getFluentBridgeRoute,
    getFluentChainForNetwork: () => chain,
    WagmiProvider,
    Fragment: React.Fragment,
    _jsx: React.createElement,
  });
  return { Provider, getConfig: () => config, connectWallet };
}

describe("Connect wallet provider lifecycle", () => {
  it.each([chain.id, sepolia.id])(
    "preserves a wallet on chain %s when the account panel opens and closes",
    async (chainId) => {
      const { Provider, getConfig, connectWallet } = setup();
      let renderer;
      const render = (open) =>
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
          await connect(config, { connector: config.connectors[0] });
        });
        expect(getAccount(config).address).toBe(address);
        await act(async () => {
          await switchChain(config, { chainId });
        });
        for (const open of [true, false, true]) {
          await act(async () => {
            renderer.update(render(open));
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
          renderer.update(render(false));
        });
        expect(getAccount(config).isConnected).toBe(false);
        expect(getAccount(config).address).toBeUndefined();
      } finally {
        act(() => renderer?.unmount());
      }
    },
  );
});
