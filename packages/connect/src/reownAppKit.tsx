import { getFluentChainForNetwork, type FluentWidgetNetwork } from "./network";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit, useAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import type { Chain } from "viem";
import type { WalletClient } from "viem";
import { WagmiProvider } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { FLUENT_CONNECT_DEFAULT_ASSETS, FLUENT_CONNECT_REOWN_PROJECT_ID } from "./config";

export const REOWN_PROJECT_ID = FLUENT_CONNECT_REOWN_PROJECT_ID;

const queryClient = new QueryClient();
const appKitByChainId = new Map<number, WagmiAdapter>();

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

function getReownWagmiAdapter(chain: Chain) {
  if (!REOWN_PROJECT_ID) return null;

  const existing = appKitByChainId.get(chain.id);
  if (existing) return existing;

  const adapter = new WagmiAdapter({
    networks: [chain],
    projectId: REOWN_PROJECT_ID,
  });
  appKitByChainId.set(chain.id, adapter);

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
      enableCoinbase: true,
      enableWalletConnect: true,
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
  open: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
};

export function ReownProvider({
  children,
  network = "testnet",
}: {
  children: ReactNode;
  network?: FluentWidgetNetwork;
}) {
  const chain = useMemo(() => getFluentChainForNetwork(network), [network]);
  const wagmiAdapter = useMemo(() => getReownWagmiAdapter(chain), [chain]);

  if (!wagmiAdapter) return <>{children}</>;

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export function useReownWallet(): ReownWalletState {
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  return {
    configured: reownConfigured,
    connected: isConnected,
    address,
    chainId,
    walletClient,
    open: () => open(),
    disconnect,
    switchChain: async (nextChainId: number) => {
      await switchChainAsync({ chainId: nextChainId });
    },
  };
}
