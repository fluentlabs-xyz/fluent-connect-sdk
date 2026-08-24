import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getERC20PaymasterApproveCall,
  type ZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint } from "@zerodev/sdk/constants";
import { http, type Address, type Chain, type Hash, type Hex } from "viem";
import type { GetPaymasterDataParameters, SmartAccount } from "viem/account-abstraction";
import { fluentTestnet } from "@fluent.xyz/connect-sdk";

import { FLUENT_CONNECT_ZERODEV_PROJECT_ID } from "./config";
import { getFluentErc20PaymasterTokenAddresses, type FluentWidgetNetwork } from "./network";

export const FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY = "selfFunded=true";
export const FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT =
  "0x000000000000000000000000000000000000dEaD" as const;

export function getFluentZeroDevErc20PaymasterTokens(network: FluentWidgetNetwork = "testnet") {
  const addresses = getFluentErc20PaymasterTokenAddresses(network);
  return {
    BLEND: {
      address: addresses.BLEND,
      decimals: 18,
      symbol: "BLEND",
    },
    USDNR: {
      address: addresses.USDnr,
      decimals: 18,
      symbol: "USDnr",
    },
  } as const;
}

export type FluentZeroDevErc20PaymasterTokenKey = keyof ReturnType<
  typeof getFluentZeroDevErc20PaymasterTokens
>;

export type FluentZeroDevErc20PaymasterToken =
  | FluentZeroDevErc20PaymasterTokenKey
  | Address
  | {
      address: Address;
      symbol?: string;
    };

export type FluentZeroDevPaymasterKernel = {
  account: SmartAccount;
  publicClient: Parameters<typeof createKernelAccountClient>[0]["client"];
  smartAccountAddress: Address;
  zeroDevRpcUrl: string;
};

export type FluentZeroDevPaymasterDemoResult = {
  approvalIncluded: boolean;
  gasToken: Address;
  gasTokenSymbol?: string;
  paymasterRpcUrl: string;
  transactionHash: Hash;
  userOpHash: Hash;
};

export function createFluentZeroDevRpcUrl(params: {
  chainId?: number;
  projectId?: string;
  selfFunded?: boolean;
} = {}) {
  const chainId = params.chainId ?? fluentTestnet.id;
  const projectId = params.projectId ?? FLUENT_CONNECT_ZERODEV_PROJECT_ID;
  const baseUrl = `https://rpc.zerodev.app/api/v3/${projectId}/chain/${chainId}`;
  return params.selfFunded ? `${baseUrl}?${FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY}` : baseUrl;
}

export function createFluentZeroDevErc20PaymasterRpcUrl(params: {
  chainId?: number;
  projectId?: string;
} = {}) {
  return createFluentZeroDevRpcUrl({ ...params, selfFunded: true });
}

/** The partner travels in the path, the user in the `Authorization` header. */
export function createFluentSponsorshipRpcUrl(params: {
  sponsorshipUrl: string;
  clientId: string;
}) {
  const base = params.sponsorshipUrl.replace(/\/+$/, "");
  return `${base}/paymaster/${encodeURIComponent(params.clientId)}`;
}

export function createFluentZeroDevSponsoredPaymaster(params: {
  chain: Chain;
  rpcUrl: string;
  accessToken: string;
}) {
  const paymasterClient = createZeroDevPaymasterClient({
    chain: params.chain,
    transport: http(params.rpcUrl, {
      fetchOptions: { headers: { Authorization: `Bearer ${params.accessToken}` } },
    }),
  });

  return {
    getPaymasterData: (userOperation: GetPaymasterDataParameters) =>
      paymasterClient.sponsorUserOperation({
        userOperation: withoutChainMetadata(userOperation),
      }),
  };
}

export function resolveFluentZeroDevErc20PaymasterToken(
  token: FluentZeroDevErc20PaymasterToken = "BLEND",
  network: FluentWidgetNetwork = "testnet",
) {
  if (typeof token === "object") return token;
  if (token.startsWith("0x")) return { address: token as Address };
  return getFluentZeroDevErc20PaymasterTokens(network)[
    token as FluentZeroDevErc20PaymasterTokenKey
  ];
}

export function createFluentZeroDevErc20PaymasterClient(params: {
  chain?: Chain;
  paymasterRpcUrl?: string;
} = {}) {
  const chain = params.chain ?? fluentTestnet;
  return createZeroDevPaymasterClient({
    chain,
    transport: http(
      params.paymasterRpcUrl ??
        createFluentZeroDevErc20PaymasterRpcUrl({ chainId: chain.id }),
    ),
  });
}

export function createFluentZeroDevErc20Paymaster(params: {
  chain?: Chain;
  gasToken?: FluentZeroDevErc20PaymasterToken;
  network?: FluentWidgetNetwork;
  paymasterClient?: ZeroDevPaymasterClient;
  paymasterRpcUrl?: string;
}) {
  const chain = params.chain ?? fluentTestnet;
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(
    params.gasToken,
    params.network,
  );
  const paymasterClient =
    params.paymasterClient ??
    createFluentZeroDevErc20PaymasterClient({
      chain,
      paymasterRpcUrl: params.paymasterRpcUrl,
    });

  return {
    getPaymasterData: (userOperation: GetPaymasterDataParameters) => {
      const contextToken = getPaymasterContextToken(userOperation.context);

      return paymasterClient.sponsorUserOperation({
        userOperation: withoutChainMetadata(userOperation),
        gasToken: contextToken ?? gasToken.address,
      });
    },
  };
}

export async function createFluentZeroDevErc20PaymasterApprovalCall(params: {
  approveAmount: bigint;
  chain?: Chain;
  gasToken?: FluentZeroDevErc20PaymasterToken;
  network?: FluentWidgetNetwork;
  paymasterClient?: ZeroDevPaymasterClient;
  paymasterRpcUrl?: string;
}) {
  const chain = params.chain ?? fluentTestnet;
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(
    params.gasToken,
    params.network,
  );
  const paymasterClient =
    params.paymasterClient ??
    createFluentZeroDevErc20PaymasterClient({
      chain,
      paymasterRpcUrl: params.paymasterRpcUrl,
    });

  return getERC20PaymasterApproveCall(paymasterClient, {
    gasToken: gasToken.address,
    approveAmount: params.approveAmount,
    entryPoint: getEntryPoint("0.7"),
  });
}

type FluentZeroDevPaymasterDemoApproval =
  | { includeApproval: true; approveAmount: bigint }
  | { includeApproval?: false; approveAmount?: never };

export async function sendFluentZeroDevErc20PaymasterDemo(params: {
  chain?: Chain;
  gasToken?: FluentZeroDevErc20PaymasterToken;
  kernel: FluentZeroDevPaymasterKernel;
  network?: FluentWidgetNetwork;
  paymasterRpcUrl?: string;
  testRecipient?: Address;
} & FluentZeroDevPaymasterDemoApproval) {
  const chain = params.chain ?? fluentTestnet;
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(
    params.gasToken,
    params.network,
  );
  const paymasterRpcUrl =
    params.paymasterRpcUrl ?? createFluentZeroDevErc20PaymasterRpcUrl({ chainId: chain.id });
  const paymasterClient = createFluentZeroDevErc20PaymasterClient({
    chain,
    paymasterRpcUrl,
  });
  const calls: Array<{ to: Address; data: Hex; value: bigint }> = [];

  if (params.includeApproval) {
    calls.push(await createFluentZeroDevErc20PaymasterApprovalCall({
      approveAmount: params.approveAmount,
      gasToken,
      paymasterClient,
    }));
  }

  calls.push({
    to: params.testRecipient ?? FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT,
    data: "0x",
    value: 0n,
  });

  const client = createKernelAccountClient({
    account: params.kernel.account,
    chain,
    bundlerTransport: http(params.kernel.zeroDevRpcUrl),
    client: params.kernel.publicClient,
    paymaster: createFluentZeroDevErc20Paymaster({
      chain,
      gasToken,
      network: params.network,
      paymasterClient,
    }),
  });

  const userOpHash = await client.sendUserOperation({
    account: params.kernel.account,
    calls,
  });
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    throw new Error(receipt.reason ?? `UserOperation ${userOpHash} execution failed`);
  }

  return {
    approvalIncluded: Boolean(params.includeApproval),
    gasToken: gasToken.address,
    gasTokenSymbol: gasToken.symbol,
    paymasterRpcUrl,
    transactionHash: receipt.receipt.transactionHash,
    userOpHash,
  } satisfies FluentZeroDevPaymasterDemoResult;
}

type SponsorUserOperation = Parameters<ZeroDevPaymasterClient["sponsorUserOperation"]>[0]["userOperation"];

function getPaymasterContextToken(context: unknown) {
  if (!context || typeof context !== "object") return undefined;
  const token = (context as { token?: unknown }).token;
  return typeof token === "string" && token.startsWith("0x") ? (token as Address) : undefined;
}

function withoutChainMetadata(userOperation: unknown): SponsorUserOperation {
  const {
    chain: _chain,
    context: _context,
    paymasterContext: _paymasterContext,
    ...cleanUserOperation
  } = userOperation as Record<string, unknown>;
  return cleanUserOperation as SponsorUserOperation;
}
