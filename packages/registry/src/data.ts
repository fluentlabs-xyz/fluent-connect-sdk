import fluentDevnet from "../data/chains/fluent-devnet.json" with { type: "json" };
import fluentMainnet from "../data/chains/fluent-mainnet.json" with { type: "json" };
import fluentTestnet from "../data/chains/fluent-testnet.json" with { type: "json" };
import sepolia from "../data/l1/sepolia.json" with { type: "json" };
import fluentBridgeApp from "../data/apps/fluent-bridge.json" with { type: "json" };
import zerodevIntegration from "../data/integrations/zerodev.json" with { type: "json" };

import {
  appSchema,
  fluentChainSchema,
  l1ChainSchema,
  zerodevIntegrationSchema,
  type AppDefinition,
  type FluentChainDefinition,
  type L1ChainDefinition,
  type ZerodevIntegration,
} from "./schema.js";

function parse<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

export const fluentChains = {
  devnet: parse(fluentChainSchema, fluentDevnet),
  testnet: parse(fluentChainSchema, fluentTestnet),
  mainnet: parse(fluentChainSchema, fluentMainnet),
} as const satisfies Record<string, FluentChainDefinition>;

export const l1Chains = {
  sepolia: parse(l1ChainSchema, sepolia),
} as const satisfies Record<string, L1ChainDefinition>;

export const apps = {
  fluentBridge: parse(appSchema, fluentBridgeApp),
} as const satisfies Record<string, AppDefinition>;

export const integrations = {
  zerodev: parse(zerodevIntegrationSchema, zerodevIntegration),
} as const satisfies Record<string, ZerodevIntegration>;

export const registryVersion = "0.1.0" as const;

/** Fluent chain IDs with ZeroDev bundler/paymaster support */
export const fluentZeroDevChainIds = integrations.zerodev.supportedFluentChains.map(
  (c) => c.chainId,
) as readonly number[];

export function getFluentChain(id: keyof typeof fluentChains): FluentChainDefinition {
  return fluentChains[id];
}

export function getFluentChainByChainId(
  chainId: number,
): FluentChainDefinition | undefined {
  return Object.values(fluentChains).find((c) => c.chainId === chainId);
}

export function getL1Chain(id: keyof typeof l1Chains): L1ChainDefinition {
  return l1Chains[id];
}

export function getL1ForFluentChain(
  fluent: FluentChainDefinition,
): L1ChainDefinition | undefined {
  if (!fluent.parent) return undefined;
  return Object.values(l1Chains).find((l1) => l1.chainId === fluent.parent!.chainId);
}

export function getApp(id: keyof typeof apps): AppDefinition {
  return apps[id];
}

export function getZerodevIntegration(): ZerodevIntegration {
  return integrations.zerodev;
}

export function getZeroDevRpcUrl(params: {
  projectId: string;
  chainId: number;
}): string {
  const { rpcUrlTemplate } = integrations.zerodev;
  return rpcUrlTemplate
    .replace("{projectId}", params.projectId)
    .replace("{chainId}", String(params.chainId));
}

export function isFluentZeroDevChain(chainId: number): boolean {
  return fluentZeroDevChainIds.includes(chainId);
}
