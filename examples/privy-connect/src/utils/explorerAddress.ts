import { fluentTestnet } from "@fluent/connect-sdk";

export function explorerAddress(address: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/address/${address}`;
}
