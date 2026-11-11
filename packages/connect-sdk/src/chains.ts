import { fluentChains, l1Chains } from "@fluent.xyz/registry";

import { fluentDefinitionToViemChain, l1DefinitionToViemChain } from "./chains-define.js";

/** The viem chain of Fluent testnet, chain id `20994`. */
export const fluentTestnet = fluentDefinitionToViemChain(fluentChains.testnet);

/** The viem chain of Fluent mainnet, chain id `25363`. */
export const fluentMainnet = fluentDefinitionToViemChain(fluentChains.mainnet);

/** The viem chain of Sepolia, the L1 the Fluent testnet bridge connects to. */
export const sepolia = l1DefinitionToViemChain(l1Chains.sepolia);

export const fluent = {
  testnet: fluentTestnet,
  mainnet: fluentMainnet,
} as const;

export { fluentDefinitionToViemChain, l1DefinitionToViemChain } from "./chains-define.js";
