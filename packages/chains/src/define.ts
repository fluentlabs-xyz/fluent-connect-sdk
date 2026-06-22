import type { FluentChainDefinition, L1ChainDefinition } from "@fluent/registry";
import { defineChain, type Chain, type ChainContract } from "viem";

type ContractMap = NonNullable<FluentChainDefinition["contracts"]>;

function toContract(entry: { address: string }): ChainContract {
  return { address: entry.address as `0x${string}` };
}

export function fluentDefinitionToViemChain(
  definition: FluentChainDefinition,
): Chain {
  const contracts = definition.contracts;
  const viemContracts: Chain["contracts"] = {};

  if (contracts?.fluentBridge) {
    viemContracts.fluentBridge = toContract(contracts.fluentBridge);
  }
  if (contracts?.universalTokenFactory) {
    viemContracts.universalTokenFactory = toContract(
      contracts.universalTokenFactory,
    );
  }
  if (contracts?.paymentGateway) {
    viemContracts.paymentGateway = toContract(contracts.paymentGateway);
  }
  if (contracts?.peggedTokenPrecompile) {
    viemContracts.peggedTokenPrecompile = toContract(
      contracts.peggedTokenPrecompile,
    );
  }

  return defineChain({
    id: definition.chainId,
    name: definition.name,
    nativeCurrency: definition.nativeCurrency,
    rpcUrls: definition.rpcUrls,
    blockExplorers: definition.blockExplorers,
    testnet: definition.testnet,
    contracts: Object.keys(viemContracts).length > 0 ? viemContracts : undefined,
    sourceId: definition.parent?.chainId,
  });
}

export function l1DefinitionToViemChain(definition: L1ChainDefinition): Chain {
  const bridge = definition.contracts?.fluentBridge;
  const viemContracts: Chain["contracts"] = bridge
    ? { fluentBridge: toContract(bridge) }
    : undefined;

  return defineChain({
    id: definition.chainId,
    name: definition.name,
    nativeCurrency: definition.nativeCurrency,
    rpcUrls: definition.rpcUrls,
    blockExplorers: definition.blockExplorers,
    testnet: definition.testnet,
    contracts: viemContracts,
  });
}
