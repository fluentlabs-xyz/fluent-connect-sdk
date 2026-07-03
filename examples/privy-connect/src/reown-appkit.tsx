import { fluentTestnet } from "@fluent/connect-sdk";
import { createAppKit, useAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import type { WalletClient } from "viem";
import { WagmiProvider } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";

export const REOWN_PROJECT_ID =
  import.meta.env.VITE_REOWN_PROJECT_ID ?? import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

const reownNetworks = [fluentTestnet] as const;
const queryClient = new QueryClient();

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

export const wagmiAdapter = reownConfigured
  ? new WagmiAdapter({
      networks: [...reownNetworks],
      projectId: REOWN_PROJECT_ID,
    })
  : null;

if (reownConfigured && wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...reownNetworks],
    defaultNetwork: fluentTestnet,
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
        image_url: `${window.location.origin}/fluent-assets/fluent-logo.svg`,
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

export function ReownProvider({ children }: { children: ReactNode }) {
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
    open: () => {
      void open();
    },
    disconnect,
    switchChain: async (nextChainId: number) => {
      await switchChainAsync({ chainId: nextChainId });
    },
  };
}
