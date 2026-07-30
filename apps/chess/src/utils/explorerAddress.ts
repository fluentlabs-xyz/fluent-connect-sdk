import { FLUENT_TESTNET_CHAIN } from "../fluentSdk";

export function explorerAddress(address: string): string {
  return `${FLUENT_TESTNET_CHAIN.blockExplorers?.default.url}/address/${address}`;
}
