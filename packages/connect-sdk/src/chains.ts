import { fluentChains, l1Chains } from "@fluent.xyz/registry";

import { fluentDefinitionToViemChain, l1DefinitionToViemChain } from "./chains-define.js";

/** Fluent public testnet (chain id 20994) */
export const fluentTestnet = fluentDefinitionToViemChain(fluentChains.testnet);

/** Fluent mainnet (chain id 25363) */
export const fluentMainnet = fluentDefinitionToViemChain(fluentChains.mainnet);

/** Sepolia — L1 paired with Fluent testnet bridge */
export const sepolia = l1DefinitionToViemChain(l1Chains.sepolia);

export const fluent = {
  testnet: fluentTestnet,
  mainnet: fluentMainnet,
} as const;

export { fluentDefinitionToViemChain, l1DefinitionToViemChain } from "./chains-define.js";
