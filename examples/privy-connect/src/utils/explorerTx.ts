import { fluentTestnet } from "@fluent/wallet-sdk";

export function explorerTx(hash: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/tx/${hash}`;
}
