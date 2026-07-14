import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getERC20PaymasterApproveCall,
  type ZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint } from "@zerodev/sdk/constants";
import { http, type Address, type Hash, type Hex } from "viem";
import type { GetPaymasterDataParameters, SmartAccount } from "viem/account-abstraction";
import { fluentTestnet } from "viem/chains";

import {
  FLUENT_CONNECT_ZERODEV_PROJECT_ID,
  FLUENT_TESTNET_BLEND_TOKEN_ADDRESS,
  FLUENT_TESTNET_USDNR_TOKEN_ADDRESS,
} from "./config";

export const FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY = "selfFunded=true";
export const FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT =
  "0x000000000000000000000000000000000000dEaD" as const;

export const FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS = {
  BLEND: {
    address: FLUENT_TESTNET_BLEND_TOKEN_ADDRESS,
    decimals: 18,
    symbol: "BLEND",
  },
  USDNR: {
    address: FLUENT_TESTNET_USDNR_TOKEN_ADDRESS,
    decimals: 6,
    symbol: "USDnr",
  },
} as const;

export type FluentZeroDevErc20PaymasterTokenKey = keyof typeof FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS;

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

export function resolveFluentZeroDevErc20PaymasterToken(
  token: FluentZeroDevErc20PaymasterToken = "BLEND",
) {
  if (typeof token === "object") return token;
  if (token.startsWith("0x")) return { address: token as Address };
  return FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS[token as FluentZeroDevErc20PaymasterTokenKey];
}

export function createFluentZeroDevErc20PaymasterClient(params: {
  paymasterRpcUrl?: string;
} = {}) {
  return createZeroDevPaymasterClient({
    chain: fluentTestnet,
    transport: http(params.paymasterRpcUrl ?? createFluentZeroDevErc20PaymasterRpcUrl()),
  });
}

export function createFluentZeroDevErc20Paymaster(params: {
  gasToken?: FluentZeroDevErc20PaymasterToken;
  paymasterClient?: ZeroDevPaymasterClient;
  paymasterRpcUrl?: string;
}) {
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(params.gasToken);
  const paymasterClient =
    params.paymasterClient ??
    createFluentZeroDevErc20PaymasterClient({ paymasterRpcUrl: params.paymasterRpcUrl });

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
  approveAmount?: bigint;
  gasToken?: FluentZeroDevErc20PaymasterToken;
  paymasterClient?: ZeroDevPaymasterClient;
  paymasterRpcUrl?: string;
}) {
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(params.gasToken);
  const paymasterClient =
    params.paymasterClient ??
    createFluentZeroDevErc20PaymasterClient({ paymasterRpcUrl: params.paymasterRpcUrl });

  return getERC20PaymasterApproveCall(paymasterClient, {
    gasToken: gasToken.address,
    approveAmount: params.approveAmount ?? getDefaultErc20PaymasterApproveAmount(gasToken),
    entryPoint: getEntryPoint("0.7"),
  });
}

export async function sendFluentZeroDevErc20PaymasterDemo(params: {
  approveAmount?: bigint;
  gasToken?: FluentZeroDevErc20PaymasterToken;
  includeApproval?: boolean;
  kernel: FluentZeroDevPaymasterKernel;
  paymasterRpcUrl?: string;
  testRecipient?: Address;
}) {
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(params.gasToken);
  const paymasterRpcUrl = params.paymasterRpcUrl ?? createFluentZeroDevErc20PaymasterRpcUrl();
  const paymasterClient = createFluentZeroDevErc20PaymasterClient({ paymasterRpcUrl });
  const calls: Array<{ to: Address; data: Hex; value: bigint }> = [];

  if (params.includeApproval) {
    calls.push(await createFluentZeroDevErc20PaymasterApprovalCall({
      approveAmount: params.approveAmount ?? getDefaultErc20PaymasterApproveAmount(gasToken),
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
    chain: fluentTestnet,
    bundlerTransport: http(params.kernel.zeroDevRpcUrl),
    client: params.kernel.publicClient,
    paymaster: createFluentZeroDevErc20Paymaster({
      gasToken,
      paymasterClient,
    }),
  });

  const userOpHash = await client.sendUserOperation({
    account: params.kernel.account,
    calls,
  });
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });

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

function getDefaultErc20PaymasterApproveAmount(token: { address: Address; decimals?: number }) {
  return 100n * 10n ** BigInt(token.decimals ?? 18);
}

function getPaymasterContextToken(context: unknown) {
  if (!context || typeof context !== "object") return undefined;
  const token = (context as { token?: unknown }).token;
  return typeof token === "string" && token.startsWith("0x") ? (token as Address) : undefined;
}

function withoutChainMetadata(userOperation: unknown): SponsorUserOperation {
  const { chain: _chain, ...cleanUserOperation } = userOperation as Record<string, unknown>;
  return cleanUserOperation as SponsorUserOperation;
}
