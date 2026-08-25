import { getFluentChainForNetwork, type FluentWidgetNetwork } from "../core/network";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit, useAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo } from "react";
import type { Chain } from "viem";
import type { WalletClient } from "viem";
import { WagmiProvider } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { baseAccount, coinbaseWallet } from "wagmi/connectors";
import { FLUENT_CONNECT_DEFAULT_ASSETS, FLUENT_CONNECT_REOWN_PROJECT_ID } from "../core/config";

export const REOWN_PROJECT_ID = FLUENT_CONNECT_REOWN_PROJECT_ID;

const queryClient = new QueryClient();
// Keyed on the analytics choice too: the Coinbase opt-out below is baked into the
// adapter's connector list, so an adapter built for one setting cannot be reused
// for the other.
const appKitByKey = new Map<string, WagmiAdapter>();

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

function getReownWagmiAdapter(chain: Chain, disableAnalytics: boolean) {
  if (!REOWN_PROJECT_ID) return null;

  const key = `${chain.id}:${disableAnalytics ? "no-analytics" : "analytics"}`;
  const existing = appKitByKey.get(key);
  if (existing) return existing;

  const adapter = new WagmiAdapter({
    networks: [chain],
    projectId: REOWN_PROJECT_ID,
    ...(disableAnalytics
      ? {
          connectors: [
            coinbaseWallet({ preference: { options: "all", telemetry: false } }),
            baseAccount({ preference: { telemetry: false } }),
          ],
        }
      : {}),
  });
  appKitByKey.set(key, adapter);

  if (typeof window !== "undefined") {
    createAppKit({
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

export type ReownWalletState = {
  configured: boolean;
  connected: boolean;
  address?: string;
  chainId?: number;
  walletClient?: WalletClient;
  reconnecting: boolean;
  open: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
};

export function ReownProvider({
  children,
  network = "testnet",
  disableAnalytics = false,
}: {
  children: ReactNode;
  network?: FluentWidgetNetwork;
  disableAnalytics?: boolean;
}) {
  const chain = useMemo(() => getFluentChainForNetwork(network), [network]);
  const wagmiAdapter = useMemo(
    () => getReownWagmiAdapter(chain, disableAnalytics),
    [chain, disableAnalytics],
  );

  if (!wagmiAdapter) return <>{children}</>;

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
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
      disconnect,
      switchChain,
    }),
    [isConnected, address, chainId, walletClient, status, openWallet, disconnect, switchChain],
  );
}
