import type { WalletClient } from "viem";

export type FluentExternalWalletState = {
  configured: boolean;
  connected: boolean;
  address?: string;
  chainId?: number;
  walletClient?: WalletClient;
  open: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
};
