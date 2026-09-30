import {
  getFluentChainForNetwork,
  type FluentWidgetNetwork,
} from "../core/network";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit, useAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo } from "react";
import type { Chain } from "viem";
import { WagmiProvider } from "wagmi";
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

export const REOWN_PROJECT_ID = FLUENT_CONNECT_REOWN_PROJECT_ID;

const queryClient = new QueryClient();
// Keyed on the analytics choice too: the Coinbase opt-out below is baked into the
// adapter's connector list, so an adapter built for one setting cannot be reused
// for the other.
const appKitByKey = new Map<string, WagmiAdapter>();

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

function getReownWagmiAdapter(
  chain: Chain,
  disableAnalytics: boolean,
  reconnectOnMount: boolean,
) {
  if (!REOWN_PROJECT_ID) return null;

  const key = `${chain.id}:${disableAnalytics ? "no-analytics" : "analytics"}:${reconnectOnMount ? "restore" : "manual"}`;
  const existing = appKitByKey.get(key);
  if (existing) return existing;

  const adapter = new WagmiAdapter({
    // Hydrate in a mount effect. In client-render mode Wagmi reruns hydration
    // on every render and reconnectOnMount=false clears even live connections
    // (for example, when opening the account drawer).
    ssr: true,
    networks: [chain],
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
      enableReconnect: reconnectOnMount,
      adapters: [adapter],
      networks: [chain],
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
  reconnectOnMount = false,
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

  if (!wagmiAdapter) return <>{children}</>;

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
