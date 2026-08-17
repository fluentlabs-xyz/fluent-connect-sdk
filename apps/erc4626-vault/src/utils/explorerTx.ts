import { fluentTestnet } from "@fluent.xyz/connect-sdk";

export function explorerTx(hash: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/tx/${hash}`;
}
