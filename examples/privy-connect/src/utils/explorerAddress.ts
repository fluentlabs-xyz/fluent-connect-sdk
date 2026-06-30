import { fluentTestnet } from "@fluent/wallet-sdk";

export function explorerAddress(address: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/address/${address}`;
}