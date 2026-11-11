import {
  formatUnits,
  type Address,
  type PublicClient,
  type Transport,
  type Chain,
} from "viem";

type FluentNetworkName = "testnet" | "mainnet";

/**
 * A token as the widget's lists hold it: `native` marks the chain's own currency and
 * `gasPriority` its place among the Gas tokens (ADR 0001), and `mergeFluentDisplayTokens` keeps
 * either field only on a Default token. Not the root entry's `FluentTokenDefinition`, an
 * Integrator token, which carries neither field.
 */
export type FluentTokenDefinition = {
  chainId: number;
  address?: Address;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  native?: true;
  gasPriority?: number;
};

/** Reports whether `token` is the chain's own currency, read from `native` alone. */
export function isFluentNativeToken(token: Pick<FluentTokenDefinition, "native">) {
  return token.native === true;
}

/**
 * Returns the Token identity of `token`: `<chainId>:<address>`, the address lowercased;
 * `<chainId>:native` for the chain's own currency and `<chainId>:unknown` for a token with no
 * address.
 */
export function fluentTokenIdentity(
  token: Pick<FluentTokenDefinition, "chainId" | "address" | "native">,
) {
  const target = isFluentNativeToken(token) ? "native" : token.address?.toLowerCase() ?? "unknown";
  return `${token.chainId}:${target}`;
}

/**
 * A token with one account's balance of it, as `readFluentTokenBalances` returns it: `raw` in
 * base units and `formatted` in token units while `status` is `"ready"`, both `null` otherwise.
 */
export type FluentTokenBalance = FluentTokenDefinition & {
  raw: bigint | null;
  formatted: string | null;
  status: "ready" | "not-configured" | "error";
  error?: string;
};

/** The Default tokens of testnet, by symbol. */
export const fluentTestnetTokenDefaults = {
  ETH: {
    chainId: 20994,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    native: true,
    gasPriority: 3,
  },
  USDnr: {
    chainId: 20994,
    symbol: "USDnr",
    name: "USDnr",
    decimals: 6,
    address: "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1",
    gasPriority: 2,
  },
  BLEND: {
    chainId: 20994,
    symbol: "BLEND",
    name: "Mock Blend",
    decimals: 18,
    address: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
    gasPriority: 1,
  },
} as const satisfies Record<string, FluentTokenDefinition>;

/** The Default tokens of mainnet, by symbol. */
export const fluentMainnetTokenDefaults = {
  ETH: {
    chainId: 25363,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    native: true,
    gasPriority: 3,
  },
  USDnr: {
    chainId: 25363,
    symbol: "USDnr",
    name: "USDnr",
    // `decimals()` on 0xD48e… returns 6, as it does on the testnet USDnr.
    decimals: 6,
    address: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
    gasPriority: 2,
  },
  BLEND: {
    chainId: 25363,
    symbol: "BLEND",
    name: "Fluent",
    decimals: 18,
    address: "0x1385b8f55a84f2bda13eed4099d29eae03d553b2",
    gasPriority: 1,
  },
} as const satisfies Record<string, FluentTokenDefinition>;

/** Returns the Default tokens of a Network, by symbol: mainnet's or else testnet's. */
export function getFluentTokenDefaultsForNetwork(network: FluentNetworkName) {
  switch (network) {
    case "mainnet":
      return fluentMainnetTokenDefaults;
    default:
      return fluentTestnetTokenDefaults;
  }
}

const fluentDefaultTokenIdentities = new Set(
  [
    ...Object.values(fluentTestnetTokenDefaults),
    ...Object.values(fluentMainnetTokenDefaults),
  ].map(fluentTokenIdentity),
);

export function isFluentDefaultToken(
  token: Pick<FluentTokenDefinition, "chainId" | "address" | "native">,
) {
  return fluentDefaultTokenIdentities.has(fluentTokenIdentity(token));
}

/**
 * Returns the Gas tokens among `tokens`, those that declare a `gasPriority`, lowest
 * `gasPriority` first. The one place this filter and order are written, so no two lists of Gas
 * tokens disagree.
 */
export function sortFluentGasTokens<T extends FluentTokenDefinition>(
  tokens: readonly T[],
): readonly T[] {
  return tokens
    .filter((token) => token.gasPriority !== undefined)
    .sort((left, right) => left.gasPriority! - right.gasPriority!);
}

// Built once per network so both accessors keep a stable identity. Callers
// memoize on `network` and feed the result into effect dependencies; returning
// a fresh array per call would refetch balances on every render.
const displayTokensByNetwork: Record<FluentNetworkName, readonly FluentTokenDefinition[]> = {
  testnet: Object.freeze(Object.values(fluentTestnetTokenDefaults)),
  mainnet: Object.freeze(Object.values(fluentMainnetTokenDefaults)),
};

const gasTokensByNetwork: Record<FluentNetworkName, readonly FluentTokenDefinition[]> = {
  testnet: Object.freeze(sortFluentGasTokens(displayTokensByNetwork.testnet)),
  mainnet: Object.freeze(sortFluentGasTokens(displayTokensByNetwork.mainnet)),
};

/**
 * Returns the Default tokens of a Network in the order the widget lists them, the order their
 * defaults object declares; every call for a Network returns the same frozen array.
 */
export function getFluentDefaultWidgetDisplayTokens(
  network: FluentNetworkName,
): readonly FluentTokenDefinition[] {
  return displayTokensByNetwork[network];
}

export function getFluentDefaultWidgetGasTokens(
  network: FluentNetworkName,
): readonly FluentTokenDefinition[] {
  return gasTokensByNetwork[network];
}

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Reads `account`'s balance of each of `tokens` through `client`, all in parallel: the chain's
 * balance for a native token, `balanceOf` for the rest. A token with neither `native` nor an
 * address comes back `"not-configured"`, a read that throws comes back `"error"` with the
 * message; the call itself never rejects for one token's failure.
 *
 * @example
 * ```ts
 * import { createPublicClient, http } from "viem";
 * import { fluentTestnet } from "@fluent.xyz/connect";
 * import {
 *   getFluentDefaultWidgetDisplayTokens,
 *   readFluentTokenBalances,
 * } from "@fluent.xyz/connect/internal";
 *
 * const client = createPublicClient({ chain: fluentTestnet, transport: http() });
 * const balances = await readFluentTokenBalances({
 *   client,
 *   account: "0x0000000000000000000000000000000000000001",
 *   tokens: getFluentDefaultWidgetDisplayTokens("testnet"),
 * });
 * ```
 */
export async function readFluentTokenBalances<
  TTransport extends Transport = Transport,
  TChain extends Chain = Chain,
>(params: {
  client: PublicClient<TTransport, TChain>;
  account: Address;
  tokens: readonly FluentTokenDefinition[];
}): Promise<FluentTokenBalance[]> {
  return Promise.all(
    params.tokens.map(async (token): Promise<FluentTokenBalance> => {
      const native = isFluentNativeToken(token);

      if (!native && !token.address) {
        return {
          ...token,
          raw: null,
          formatted: null,
          status: "not-configured",
        };
      }

      try {
        const raw = native
          ? await params.client.getBalance({ address: params.account })
          : await params.client.readContract({
              address: token.address!,
              abi: balanceOfAbi,
              functionName: "balanceOf",
              args: [params.account],
            });
        return {
          ...token,
          raw,
          formatted: formatUnits(raw, token.decimals),
          status: "ready",
        };
      } catch (error) {
        return {
          ...token,
          raw: null,
          formatted: null,
          status: "error",
          error: error instanceof Error ? error.message : "Balance read failed",
        };
      }
    }),
  );
}
