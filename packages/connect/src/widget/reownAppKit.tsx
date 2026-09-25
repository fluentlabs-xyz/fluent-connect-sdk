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
import { getFluentBridgeRoute } from "../bridge/route";

export const REOWN_PROJECT_ID = FLUENT_CONNECT_REOWN_PROJECT_ID;

const queryClient = new QueryClient();
// Keyed on the analytics choice too: the Coinbase opt-out below is baked into the
// adapter's connector list, so an adapter built for one setting cannot be reused
// for the other.
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

function getReownWagmiAdapter(chain: Chain, disableAnalytics: boolean) {
  if (!REOWN_PROJECT_ID) return null;

  const networks = getReownNetworks(chain);
  const key = `${networks.map((n) => n.id).join("-")}:${disableAnalytics ? "no-analytics" : "analytics"}`;
  const existing = appKitByKey.get(key);
  if (existing) return existing;

  const adapter = new WagmiAdapter({
    networks,
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
    // Default `reconnectOnMount` on purpose. `reconnectOnMount={false}` looks
    // like the way to stop wagmi adopting wallets the widget never connected,
    // but wagmi's `Hydrate` calls its `onMount` on *every render* (not in an
    // effect), and in that mode `onMount` resets `connections` to an empty Map
    // while leaving `status`/`current` alone — so any re-render above this
    // provider (a tab change, the drawer opening) left `useAccount()` reporting
    // "connected" with no address. The account header is kept on the Fluent ID
    // by `useWidgetAccount` instead, which makes adoption harmless.
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
