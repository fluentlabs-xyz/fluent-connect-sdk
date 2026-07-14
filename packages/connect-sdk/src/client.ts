import {
  fluentChains,
  getFluentChainByChainId,
  type FluentChainDefinition,
  type L1ChainDefinition,
} from "@fluent/registry";
import {
  createPublicClient,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";

import { fluentBridgeAbi } from "./abis/fluent-bridge.js";
import {
  resolveBridgeAddresses,
  resolveL1Definition,
  type BridgeAddresses,
} from "./addresses.js";

export type FluentClientConfig<TTransport extends Transport = Transport> = {
  /** Viem chain (use exports from `@fluent/connect-sdk`) */
  chain: Chain;
  transport: TTransport;
};

export type FluentClient<TTransport extends Transport = Transport> = {
  chain: Chain;
  definition: FluentChainDefinition;
  public: PublicClient<TTransport, Chain>;
  addresses: {
    bridge: BridgeAddresses;
    peggedTokenPrecompile?: `0x${string}`;
    paymentGateway?: `0x${string}`;
    universalTokenFactory?: `0x${string}`;
  };
  l1: L1ChainDefinition | undefined;
  /** Read L2 bridge `otherSideChainId` when deployed */
  readOtherSideChainId: () => Promise<bigint | undefined>;
};

function definitionForChain(chain: Chain): FluentChainDefinition {
  const byId = getFluentChainByChainId(chain.id);
  if (byId) return byId;

  const known = Object.values(fluentChains).find((c) => c.chainId === chain.id);
  if (known) return known;

  throw new Error(
    `Unknown Fluent chain id ${chain.id}. Use a chain from @fluent/connect-sdk or register it in @fluent/registry.`,
  );
}

export function createFluentClient<TTransport extends Transport>(
  config: FluentClientConfig<TTransport>,
): FluentClient<TTransport> {
  const definition = definitionForChain(config.chain);
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: config.transport,
  });

  const bridge = resolveBridgeAddresses(definition);
  const l2BridgeProxy =
    bridge.l2?.proxy ?? (config.chain.contracts as { fluentBridge?: { address: `0x${string}` } })?.fluentBridge?.address;

  return {
    chain: config.chain,
    definition,
    public: publicClient,
    addresses: {
      bridge,
      peggedTokenPrecompile: definition.contracts?.peggedTokenPrecompile
        ?.address as `0x${string}` | undefined,
      paymentGateway: definition.contracts?.paymentGateway?.address as
        | `0x${string}`
        | undefined,
      universalTokenFactory: definition.contracts?.universalTokenFactory
        ?.address as `0x${string}` | undefined,
    },
    l1: resolveL1Definition(definition),
    readOtherSideChainId: async () => {
      if (!l2BridgeProxy) return undefined;
      try {
        return await publicClient.readContract({
          address: l2BridgeProxy,
          abi: fluentBridgeAbi,
          functionName: "otherSideChainId",
        });
      } catch {
        return undefined;
      }
    },
  };
}

export type { PublicClient, Transport };
