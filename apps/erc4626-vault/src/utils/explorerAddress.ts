import { fluentTestnet } from "@fluent.xyz/connect-sdk";

export function explorerAddress(address: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/address/${address}`;
}
