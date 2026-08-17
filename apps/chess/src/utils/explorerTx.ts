import { FLUENT_TESTNET_CHAIN } from "../fluentSdk";

export function explorerTx(hash: string): string {
  return `${FLUENT_TESTNET_CHAIN.blockExplorers?.default.url}/tx/${hash}`;
}
