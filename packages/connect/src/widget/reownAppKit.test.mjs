import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createConfig, createStorage, http } from "wagmi";
import { connect, getAccount, reconnect } from "wagmi/actions";
import { baseAccount } from "wagmi/connectors";
import { hydrate } from "@wagmi/core";
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
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://unused.invalid"] } },
};
const address = "0x1111111111111111111111111111111111111111";

// Execute the installed SDK's actual provider wiring with its UI boundaries
// stubbed. This reads both defaults from the code shipped to the browser.
function providerDefaults(source, reconnectOnMount = false) {
  const createAppKit = vi.fn();
  const code = source
    .slice(
      source.indexOf("export const REOWN_PROJECT_ID ="),
      source.indexOf("export function useReownWallet()"),
    )
    .replace(/^export /gm, "");
  const provider = runInNewContext(
    `${code}\nReownProvider({ children: 'game', reconnectOnMount });`,
    {
      reconnectOnMount,
      FLUENT_CONNECT_REOWN_PROJECT_ID: "fixture",
      FLUENT_CONNECT_DEFAULT_ASSETS: {},
      QueryClient: class {},
      WagmiAdapter: class {
        wagmiConfig = {};
      },
      createAppKit,
      window: { location: { origin: "http://localhost:5173" } },
      useMemo: (fn) => fn(),
      getFluentChainForNetwork: () => chain,
      WagmiProvider: "WagmiProvider",
      QueryClientProvider: "QueryClientProvider",
      _jsx: (type, props) => ({ type, props }),
    },
  );
  return {
    reconnectOnMount: provider.props.reconnectOnMount,
    appKit: createAppKit.mock.calls[0][0],
  };
}

function savedBaseWallet() {
  const request = vi.fn(async ({ method }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
    if (method === "eth_chainId") return "0x5202";
    if (method === "wallet_connect") {
      return { accounts: [{ address }], chainIds: ["0x5202"] };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  });
  const provider = { request, on: vi.fn(), removeListener: vi.fn(), disconnect: vi.fn() };
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
    connectors: [(config) => ({ ...baseAccount()(config), getProvider: async () => provider })],
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
          connector: { id: "baseAccount", uid: "previous-page", type: "baseAccount" },
        },
      ],
    ]),
  }));
  return { config, request, saved };
}

describe("Fluent Connect startup", () => {
  it("reproduces the interactive Base request in the upstream reconnect path", async () => {
    const { config, request } = savedBaseWallet();
    await reconnect(config);
    expect(request.mock.calls.some(([rpc]) => rpc.method === "eth_requestAccounts")).toBe(true);
  });

  it("starts silently with a saved Base account and still supports explicit connection", async () => {
    const defaults = providerDefaults(installed);
    expect(defaults.appKit.enableReconnect).toBe(false);
    expect(defaults.reconnectOnMount).toBe(false);
    for (let reload = 0; reload < 2; reload++) {
      const { config, request, saved } = savedBaseWallet();
      await hydrate(config, { reconnectOnMount: defaults.reconnectOnMount }).onMount();
      expect(request).not.toHaveBeenCalled();
      expect(getAccount(config).status).toBe("disconnected");
      expect(saved.get("practice")).toBe("saved game");
      expect(saved.get("privy:session")).toBe("saved session");
      await connect(config, { connector: config.connectors[0] });
      expect(getAccount(config).address).toBe(address);
      expect(
        request.mock.calls.filter(([rpc]) => rpc.method === "eth_requestAccounts"),
      ).toHaveLength(1);
    }
  });

  it("enables both restore layers only when explicitly configured", () => {
    const defaults = providerDefaults(installed, true);
    expect(defaults.appKit.enableReconnect).toBe(true);
    expect(defaults.reconnectOnMount).toBe(true);
  });
});
