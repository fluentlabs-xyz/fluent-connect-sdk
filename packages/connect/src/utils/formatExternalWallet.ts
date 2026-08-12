import { type FluentExternalWalletState } from "../core/types";

export function formatExternalWallet(wallet: FluentExternalWalletState | null, status: string | null): string {
  return JSON.stringify(
    {
      status: status ?? "Waiting for wallet connection",
      wallet: wallet
        ? {
            provider: "Reown AppKit",
            configured: wallet.configured,
            connected: wallet.connected,
            address: wallet.address,
            chainId: wallet.chainId,
          }
        : null,
      walletConnectEnabled: Boolean(wallet?.configured),
    },
    null,
    2,
  );
}
