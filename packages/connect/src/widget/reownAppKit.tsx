import {
  getFluentChainForNetwork,
  type FluentWidgetNetwork,
} from "../core/network";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit, useAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import type { Chain } from "viem";
import { type Connector, WagmiContext, WagmiProvider } from "wagmi";
import { hydrate } from "@wagmi/core";
import { reconnect } from "wagmi/actions";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { baseAccount, coinbaseWallet } from "wagmi/connectors";
import {
  FLUENT_CONNECT_DEFAULT_ASSETS,
  FLUENT_CONNECT_REOWN_PROJECT_ID,
} from "../core/config";

import { useFluentWidgetNetwork } from "./widgetNetworkContext";
import type { FluentExternalWalletState } from "../core/types";
import { getFluentBridgeRoute } from "../bridge/route";

export const REOWN_PROJECT_ID = FLUENT_CONNECT_REOWN_PROJECT_ID;

const queryClient = new QueryClient();
// Analytics and reconnect options are baked into the adapter/AppKit instance.
// An adapter built for one setting cannot be reused for the other.
const appKitByKey = new Map<string, WagmiAdapter>();

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

/**
 * Fluent plus the chain the bridge page deposits from.
 *
 * An injected wallet is one object per page: when the bridge moves it to
 * Ethereum, this adapter sees the move too. A chain missing from `networks` does
 * not resolve here, AppKit falls back to Fluent and then keeps calling
 * `setCaipNetwork(Fluent)` against a wallet that reports Ethereum — a loop that
 * surfaces as "Maximum update depth exceeded", or as a blocking "Switch Network"
 * modal on top of the bridge. Declaring the chain is what stops both: it
 * resolves, and AppKit simply follows the wallet.
 *
 * The widget never sends anything on this chain — its execution paths switch
 * back to Fluent right before they sign.
 */
function getReownNetworks(chain: Chain): [Chain, ...Chain[]] {
  const bridgeSource = getFluentBridgeRoute(
    chain.testnet ? "testnet" : "mainnet",
  )?.source;

  return bridgeSource && bridgeSource.id !== chain.id
    ? [chain, bridgeSource]
    : [chain];
}

function canReconnectSilently(connector: Pick<Connector, "type">): boolean {
  return connector.type === "injected" || connector.type === "walletConnect";
}

/** AppKit owns startup reconnection; wagmi only hydrates before that allowlisted pass. */
class SilentReconnectAdapter extends WagmiAdapter {
  private hydration?: Promise<void>;
  private reconnection?: Promise<void>;

  hydrate() {
    // Use wagmi's hydration, including EIP-6963 discovery, but never its unfiltered reconnect.
    return (this.hydration ??= hydrate(this.wagmiConfig, {
      reconnectOnMount: false,
    }).onMount());
  }

  override syncConnections() {
    return (this.reconnection ??= this.restoreConnections());
  }

  private async restoreConnections() {
    await this.hydrate();
    const connectors = this.wagmiConfig.connectors.filter(canReconnectSilently);
    // wagmi treats an empty list as ALL connectors, not none.
    if (connectors.length) await reconnect(this.wagmiConfig, { connectors });
  }

  override async syncConnection(params: Parameters<WagmiAdapter["syncConnection"]>[0]) {
    await this.hydrate();
    const connector = this.wagmiConfig.connectors.find(({ id }) => id === params.id);
    // AppKit also syncs the saved connector separately, before syncConnections.
    // In particular its Safe branch can call connect(), so guard this entry point too.
    if (!connector || !canReconnectSilently(connector)) {
      throw new Error("This connector requires an explicit connection.");
    }
    // Hydration with reconnect disabled clears persisted connections. Restore the
    // allowlist before AppKit reads the saved account; its later aggregate sync
    // shares this pass instead of reconnecting the same wallets again.
    await this.syncConnections();
    return super.syncConnection(params);
  }
}

function getReownWagmiAdapter(chain: Chain, disableAnalytics: boolean, reconnectOnMount: boolean | undefined) {
  if (!REOWN_PROJECT_ID) return null;

  const networks = getReownNetworks(chain);
  const key = `${networks.map((n) => n.id).join("-")}:${disableAnalytics ? "no-analytics" : "analytics"}:${reconnectOnMount}`;
  const existing = appKitByKey.get(key);
  if (existing) return existing;

  const Adapter = reconnectOnMount === undefined ? SilentReconnectAdapter : WagmiAdapter;
  const adapter = new Adapter({
    // Hydrate in a mount effect. In client-render mode Wagmi reruns hydration
    // on every render and reconnectOnMount=false clears even live connections
    // (for example, when opening the account drawer).
    ssr: true,
    networks,
    projectId: REOWN_PROJECT_ID,
    ...(disableAnalytics
      ? {
          connectors: [
            coinbaseWallet({
              preference: { options: "all", telemetry: false },
            }),
            baseAccount({ preference: { telemetry: false } }),
          ],
        }
      : {}),
  });
  appKitByKey.set(key, adapter);

  if (typeof window !== "undefined") {
    createAppKit({
      // false triggers AppKit initialDisconnect (and ends WalletConnect sessions).
      // Keep it enabled for the default policy; the adapter filters its restore calls.
      enableReconnect: reconnectOnMount !== false,
      adapters: [adapter],
      networks,
      defaultNetwork: chain,
      projectId: REOWN_PROJECT_ID,
      metadata: {
        name: "Fluent Connect Demo",
        description: "Connect a wallet or continue with Fluent Connect ID.",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`],
      },
      customWallets: [
        {
          id: "fluent-connect-id",
          name: "Fluent Connect ID",
          homepage: window.location.origin,
          image_url: FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
          webapp_link: `${window.location.origin}/#fluent-connect-id`,
        },
      ],
      enableEIP6963: true,
      enableCoinbase: !disableAnalytics,
      enableWalletConnect: true,
      features: { analytics: !disableAnalytics },
      themeMode: "dark",
      themeVariables: {
        "--w3m-accent": "#49EDED",
        "--w3m-border-radius-master": "2px",
      },
    });
  }

  return adapter;
}

export type ReownWalletState = FluentExternalWalletState & {
  reconnecting: boolean;
};

export function ReownProvider({
  children,
  network = "testnet",
  disableAnalytics = false,
  reconnectOnMount,
}: {
  children: ReactNode;
  network?: FluentWidgetNetwork;
  disableAnalytics?: boolean;
  reconnectOnMount?: boolean;
}) {
  const chain = useMemo(() => getFluentChainForNetwork(network), [network]);
  const wagmiAdapter = useMemo(
    () => getReownWagmiAdapter(chain, disableAnalytics, reconnectOnMount),
    [chain, disableAnalytics, reconnectOnMount],
  );

  useEffect(() => {
    if (wagmiAdapter instanceof SilentReconnectAdapter) void wagmiAdapter.hydrate();
  }, [wagmiAdapter]);

  if (!wagmiAdapter) return <>{children}</>;

  if (wagmiAdapter instanceof SilentReconnectAdapter) {
    // WagmiProvider would hydrate a second time and clear the restored connections.
    // This adapter owns hydration; hooks still consume the standard wagmi context.
    return (
      <WagmiContext.Provider value={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiContext.Provider>
    );
  }

  return (
    <WagmiProvider
      reconnectOnMount={reconnectOnMount}
      config={wagmiAdapter.wagmiConfig}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export function useReownWallet(): ReownWalletState {
  const { open } = useAppKit();
  const { address, chainId, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const { connectors, connectAsync } = useConnect();
  const { chain } = useFluentWidgetNetwork();
  const choices = useMemo(
    () =>
      connectors
        .filter(
          (connector) =>
            connector.id !== "AUTH" &&
            (connector.id !== "injected" ||
              (typeof window !== "undefined" &&
                "ethereum" in window &&
                !connectors.some(
                  (other) =>
                    other.type === "injected" && other.id !== "injected",
                ))),
        )
        .map((connector) => ({
          id: connector.uid,
          name: connector.id === "injected" ? "Browser wallet" : connector.name,
          icon:
            connector.icon ??
            (connector.id === "walletConnect"
              ? FLUENT_CONNECT_DEFAULT_ASSETS.walletConnectIcon
              : ["coinbaseWalletSDK", "baseAccount"].includes(connector.id)
                ? FLUENT_CONNECT_DEFAULT_ASSETS.coinbaseIcon
                : undefined),
          handoff: connector.id === "walletConnect",
        })),
    [connectors],
  );
  const connectChoice = useCallback(
    async (id: string) => {
      const connector = connectors.find((candidate) => candidate.uid === id);
      if (!connector)
        throw new Error("Wallet is no longer available. Try again.");
      if (connector.id === "walletConnect") {
        await open({ view: "ConnectingWalletConnectBasic" });
        return;
      }
      await connectAsync({ connector, chainId: chain.id });
    },
    [connectors, connectAsync, chain.id, open],
  );

  const openWallet = useCallback(() => open(), [open]);
  const switchChain = useCallback(
    async (nextChainId: number) => {
      await switchChainAsync({ chainId: nextChainId });
    },
    [switchChainAsync],
  );

  return useMemo<ReownWalletState>(
    () => ({
      configured: reownConfigured,
      connected: isConnected,
      address,
      chainId,
      walletClient,
      reconnecting: status === "reconnecting",
      open: openWallet,
      choices,
      connectChoice,
      disconnect,
      switchChain,
    }),
    [
      isConnected,
      address,
      chainId,
      walletClient,
      status,
      openWallet,
      choices,
      connectChoice,
      disconnect,
      switchChain,
    ],
  );
}
