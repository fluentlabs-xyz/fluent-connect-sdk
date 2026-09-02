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
};

export function isFluentNativeToken(token: Pick<FluentTokenDefinition, "native">) {
  return token.native === true;
}

export function fluentTokenKey(
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
  },
  USDnr: {
    chainId: 20994,
    symbol: "USDnr",
    name: "USDnr",
    decimals: 18,
    address: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
  },
  BLEND: {
    chainId: 20994,
    symbol: "BLEND",
    name: "Mock Blend",
    decimals: 18,
    address: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
  },
  USDC: {
    chainId: 20994,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    address: "0xC8Ebbf08Cb2A87aB90cC8EeC34C721764b7755e9",
  },
  USDT: {
    chainId: 20994,
    symbol: "USDT",
    name: "USDT",
    decimals: 6,
    address: "0xD80Ca465c268e76F0d897D44a35fC97Db75AB797",
  },
} as const satisfies Record<string, FluentTokenDefinition>;

export const fluentTestnetWidgetTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.ETH,
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.USDC,
  fluentTestnetTokenDefaults.USDT,
];

export const fluentMainnetTokenDefaults = {
  ETH: {
    chainId: 25363,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    native: true,
  },
  USDnr: {
    chainId: 25363,
    symbol: "USDnr",
    name: "USDnr",
    decimals: 18,
    address: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
  },
  BLEND: {
    chainId: 25363,
    symbol: "BLEND",
    name: "Fluent",
    decimals: 18,
    address: "0x1385b8f55a84f2bda13eed4099d29eae03d553b2",
  },
} as const satisfies Record<string, FluentTokenDefinition>;

export const fluentMainnetWidgetTokens: readonly FluentTokenDefinition[] = [
  fluentMainnetTokenDefaults.USDnr,
  fluentMainnetTokenDefaults.BLEND,
  fluentMainnetTokenDefaults.ETH,
];

export function getFluentTokenDefaultsForNetwork(network: FluentNetworkName) {
  switch (network) {
    case "mainnet":
      return fluentMainnetTokenDefaults;
    default:
      return fluentTestnetTokenDefaults;
  }
}

export function getFluentDefaultWidgetDisplayTokens(
  network: FluentNetworkName,
): readonly FluentTokenDefinition[] {
  switch (network) {
    case "mainnet":
      return fluentMainnetWidgetTokens;
    default:
      return fluentTestnetWidgetTokens;
  }
}

export function getFluentDefaultWidgetGasTokens(
  network: FluentNetworkName,
): readonly FluentTokenDefinition[] {
  const defaults = getFluentTokenDefaultsForNetwork(network);
  return [defaults.USDnr, defaults.BLEND, defaults.ETH];
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
