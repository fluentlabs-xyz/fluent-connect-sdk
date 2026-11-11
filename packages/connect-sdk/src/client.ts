import {
  fluentChains,
  getFluentChainByChainId,
  type FluentChainDefinition,
  type L1ChainDefinition,
} from "@fluent.xyz/registry";
import { createPublicClient, http, type Chain, type PublicClient, type Transport } from "viem";

import { fluentBridgeAbi } from "./abis/fluent-bridge.js";
import { fluent } from "./chains.js";
import { resolveBridgeAddresses, resolveL1Definition, type BridgeAddresses } from "./addresses.js";

export type FluentClientConfig = {
  /** The Network to target. Defaults to `"testnet"`; ignored when `chain` is set. */
  network?: "testnet" | "mainnet";
  /** The RPC URL to call. Defaults to the chain's own; ignored when `transport` is set. */
  rpcUrl?: string;
  /** A viem chain to use instead of `network`'s; one the registry does not know throws. */
  chain?: Chain;
  /** A viem transport to use instead of one built from `rpcUrl`. */
  transport?: Transport;
};

export type FluentClient = {
  chain: Chain;
  definition: FluentChainDefinition;
  public: PublicClient;
  addresses: {
    bridge: BridgeAddresses;
    peggedTokenPrecompile?: `0x${string}`;
    paymentGateway?: `0x${string}`;
    universalTokenFactory?: `0x${string}`;
  };
  l1: L1ChainDefinition | undefined;
  /**
   * Reads `otherSideChainId` from the Fluent chain's bridge: `undefined` when the chain has no
   * bridge address or the read fails.
   */
  readOtherSideChainId: () => Promise<bigint | undefined>;
};

function definitionForChain(chain: Chain): FluentChainDefinition {
  const byId = getFluentChainByChainId(chain.id);
  if (byId) return byId;

  const known = Object.values(fluentChains).find((c) => c.chainId === chain.id);
  if (known) return known;

  throw new Error(
    `Unknown Fluent chain id ${chain.id}. Use a chain from @fluent.xyz/connect-sdk or register it in @fluent.xyz/registry.`,
  );
}

export function createFluentClient(config: FluentClientConfig = {}): FluentClient {
  const chain = config.chain ?? fluent[config.network ?? "testnet"];
  const transport = config.transport ?? http(config.rpcUrl);
  const definition = definitionForChain(chain);
  const publicClient = createPublicClient({ chain, transport });

  const bridge = resolveBridgeAddresses(definition);
  const l2BridgeProxy =
    bridge.l2?.proxy ??
    (chain.contracts as { fluentBridge?: { address: `0x${string}` } })?.fluentBridge?.address;

  return {
    chain,
    definition,
    public: publicClient,
    addresses: {
      bridge,
      peggedTokenPrecompile: definition.contracts?.peggedTokenPrecompile?.address as
        | `0x${string}`
        | undefined,
      paymentGateway: definition.contracts?.paymentGateway?.address as `0x${string}` | undefined,
      universalTokenFactory: definition.contracts?.universalTokenFactory?.address as
        | `0x${string}`
        | undefined,
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
