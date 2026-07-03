import { fluentTestnet } from "@fluent/connect-sdk";

export function explorerTx(hash: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/tx/${hash}`;
}
