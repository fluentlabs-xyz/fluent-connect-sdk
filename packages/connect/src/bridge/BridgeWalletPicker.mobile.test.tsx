/**
 * @vitest-environment jsdom
 *
 * On a phone `BridgeWalletPicker` lists wallets a person reaches by deep link. RainbowKit 2.2.8's
 * mobile list shows only connectors its own `connectorsForWallets` built, and the widget's wagmi
 * config, which Reown's adapter builds for AppKit, held none of those: a phone saw an empty list
 * and "Get a Wallet". The picker now registers its own, after the config's others.
 *
 * Fakes: `fetch` (the price and fee reads the form starts), and the user agent, an iPhone's,
 * which is what RainbowKit reads to choose its mobile list. wagmi and RainbowKit run for real, on
 * a config holding one connector of its own that stands for AppKit's WalletConnect connector: the
 * same id, first in the config, and never connected here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WagmiProvider, createConfig, createConnector, http, type Config } from "wagmi";

import { getFluentChainForNetwork } from "../core/network";
import { BridgeForm } from "./BridgeForm";
import { BridgeWalletPicker } from "./BridgeWalletPicker";
import { isBridgeWalletConnector } from "./bridgeWalletConnectors";
import { getFluentBridgeRoute } from "./route";

const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** AppKit's WalletConnect connector, as far as the lookup by id goes. */
const appKitWalletConnect = createConnector(() => ({
  id: "walletConnect",
  name: "WalletConnect",
  type: "walletConnect",
  async connect(): Promise<never> {
    throw new Error("Nothing connects in this test");
  },
  async disconnect() {},
  async getAccounts() {
    return [];
  },
  async getChainId() {
    return 1;
  },
  async getProvider() {
    return {};
  },
  async isAuthorized() {
    return false;
  },
  onAccountsChanged() {},
  onChainChanged() {},
  onDisconnect() {},
}));

function getRoute() {
  const route = getFluentBridgeRoute("mainnet");
  if (!route) throw new Error("mainnet has no bridge route");
  return route;
}

function createWidgetConfig(): Config {
  const route = getRoute();
  const fluent = getFluentChainForNetwork("mainnet");
  return createConfig({
    chains: [fluent, route.source],
    transports: { [fluent.id]: http(), [route.source.id]: http() },
    connectors: [appKitWalletConnect],
    multiInjectedProviderDiscovery: false,
  });
}

function renderPicker(config: Config) {
  const route = getRoute();
  render(
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={new QueryClient()}>
        <BridgeWalletPicker route={route}>
          <BridgeForm route={route} network="mainnet" onOpenPortal={vi.fn()} />
        </BridgeWalletPicker>
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

const bridgeConnectors = (config: Config) => config.connectors.filter(isBridgeWalletConnector);

beforeEach(() => {
  vi.spyOn(Navigator.prototype, "userAgent", "get").mockReturnValue(IPHONE_USER_AGENT);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BridgeWalletPicker on a phone", () => {
  it("lists wallets to open from the Connect a wallet button", async () => {
    renderPicker(createWidgetConfig());

    fireEvent.click(await screen.findByRole("button", { name: "Connect a wallet" }));

    expect(await screen.findByText(/MetaMask/)).toBeTruthy();
    expect(await screen.findByText(/Trust/)).toBeTruthy();
    expect(await screen.findByText(/Rainbow/)).toBeTruthy();
  });

  it("registers its wallets once, after the config's own connectors", async () => {
    const config = createWidgetConfig();
    renderPicker(config);
    await vi.waitFor(() => expect(bridgeConnectors(config)).toHaveLength(3));

    // AppKit resolves its WalletConnect connector as the first one with that id,
    // and every one of the picker's shares it: AppKit's must stay in front.
    const [first] = config.connectors;
    expect(first?.id).toBe("walletConnect");
    expect(first && isBridgeWalletConnector(first)).toBe(false);
    expect(config.connectors.find((connector) => connector.id === "walletConnect")).toBe(first);
    for (const connector of bridgeConnectors(config)) expect(connector.id).toBe("walletConnect");

    // The page comes and goes with the drawer's tabs; the config keeps one set.
    cleanup();
    renderPicker(config);
    await screen.findByRole("button", { name: "Connect a wallet" });
    expect(bridgeConnectors(config)).toHaveLength(3);
  });

  it("keeps them off a desktop, which lists its extensions as before", async () => {
    vi.spyOn(Navigator.prototype, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/130.0.0.0 Safari/537.36",
    );
    const config = createWidgetConfig();
    renderPicker(config);

    fireEvent.click(await screen.findByRole("button", { name: "Connect a wallet" }));

    await screen.findByRole("dialog");
    expect(screen.queryByText(/MetaMask/)).toBeNull();
    expect(bridgeConnectors(config)).toHaveLength(0);
  });
});
