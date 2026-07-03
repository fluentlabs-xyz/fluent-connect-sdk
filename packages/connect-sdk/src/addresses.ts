import type { FluentChainDefinition, L1ChainDefinition } from "@fluent/registry";
import { getL1ForFluentChain } from "@fluent/registry";
import type { Chain } from "viem";

export type BridgeAddresses = {
  l2?: {
    proxy: `0x${string}`;
    implementation?: `0x${string}`;
  };
  l1?: {
    proxy: `0x${string}`;
    implementation?: `0x${string}`;
  };
};

export function resolveBridgeAddresses(
  definition: FluentChainDefinition,
): BridgeAddresses {
  const l1 = getL1ForFluentChain(definition);
  const l2Bridge = definition.contracts?.fluentBridge;

  return {
    l2: l2Bridge
      ? {
          proxy: l2Bridge.address as `0x${string}`,
          implementation: l2Bridge.implementation as `0x${string}` | undefined,
        }
      : undefined,
    l1: l1?.contracts?.fluentBridge
      ? {
          proxy: l1.contracts.fluentBridge.address as `0x${string}`,
          implementation: l1.contracts.fluentBridge.implementation as
            | `0x${string}`
            | undefined,
        }
      : undefined,
  };
}

export function getContractAddressFromChain(
  chain: Chain,
  name: "fluentBridge" | "paymentGateway" | "universalTokenFactory",
): `0x${string}` | undefined {
  const contracts = chain.contracts as Record<string, { address?: string }> | undefined;
  const entry = contracts?.[name];
  return entry?.address as `0x${string}` | undefined;
}

export function resolveL1Definition(
  definition: FluentChainDefinition,
): L1ChainDefinition | undefined {
  return getL1ForFluentChain(definition);
}
