import { reownConfigured, ReownWalletState } from "../reown-appkit";

export function formatExternalWallet(wallet: ReownWalletState | null, status: string | null): string {
  return JSON.stringify(
    {
      status: status ?? "Waiting for wallet connection",
      wallet: wallet
        ? {
            provider: "Reown AppKit",
            connected: wallet.connected,
            address: wallet.address,
            chainId: wallet.chainId,
          }
        : null,
      walletConnectEnabled: reownConfigured,
    },
    null,
    2,
  );
}
