import {
  formatUnits,
  type Address,
  type PublicClient,
  type Transport,
  type Chain,
} from "viem";

type FluentNetworkName = "testnet" | "mainnet";

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

export function isFluentNativeToken(token: Pick<FluentTokenDefinition, "native">) {
  return token.native === true;
}

export function fluentTokenIdentity(
  token: Pick<FluentTokenDefinition, "chainId" | "address" | "native">,
) {
  const target = isFluentNativeToken(token) ? "native" : token.address?.toLowerCase() ?? "unknown";
  return `${token.chainId}:${target}`;
}

export type FluentTokenBalance = FluentTokenDefinition & {
  raw: bigint | null;
  formatted: string | null;
  status: "ready" | "not-configured" | "error";
  error?: string;
};

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
    decimals: 18,
    address: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
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
    decimals: 18,
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
 * The tokens in `tokens` that declare a `gasPriority`, cheapest priority first.
 * The single spelling of "gas tokens, in order" — do not re-implement the
 * filter and comparator elsewhere.
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
