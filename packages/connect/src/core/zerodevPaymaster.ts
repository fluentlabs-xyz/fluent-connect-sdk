import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  type ZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint } from "@zerodev/sdk/constants";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from "viem";
import type { GetPaymasterDataParameters, SmartAccount } from "viem/account-abstraction";
import {
  fluentTestnet,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
} from "@fluent.xyz/connect-sdk";

import { getFluentZeroDevProjectId } from "./config";
import { getFluentWidgetNetworkForChainId, type FluentWidgetNetwork } from "./network";
import { FLUENT_RPC_TIMEOUT_MS } from "./rpc";

export const FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY = "selfFunded=true";
export const FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT =
  "0x000000000000000000000000000000000000dEaD" as const;

export type FluentZeroDevErc20PaymasterTokenInfo = {
  address: Address;
  decimals: number;
  symbol: string;
};

export function getFluentZeroDevErc20PaymasterTokens(
  network: FluentWidgetNetwork = "testnet",
): Record<string, FluentZeroDevErc20PaymasterTokenInfo> {
  return Object.fromEntries(
    getFluentDefaultWidgetGasTokens(network)
      .filter((token) => !isFluentNativeToken(token) && token.address)
      .map((token) => [
        token.symbol.toUpperCase(),
        {
          address: token.address as Address,
          decimals: token.decimals,
          symbol: token.symbol,
        },
      ]),
  );
}

/**
 * Either a paymaster token symbol (see `getFluentZeroDevErc20PaymasterTokens`),
 * a bare token address, or an explicit token. Symbols are not a closed union:
 * which tokens are payable is data on the token definitions.
 */
export type FluentZeroDevErc20PaymasterToken =
  | string
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

/**
 * The ZeroDev bundler URL for one chain. `chainId` defaults to Fluent Testnet, and `projectId`
 * to the Fluent ZeroDev project of the network that chain id belongs to — the testnet project
 * for 20994, the production one for 25363 — so a host that passes a chain id gets that
 * network's project without naming it. Pass `projectId` to use your own ZeroDev project, and
 * `selfFunded` for the ERC-20 paymaster form.
 *
 * @example
 * const rpcUrl = createFluentZeroDevRpcUrl({ chainId: 25363 });
 */
export function createFluentZeroDevRpcUrl(params: {
  chainId?: number;
  projectId?: string;
  selfFunded?: boolean;
} = {}) {
  const chainId = params.chainId ?? fluentTestnet.id;
  // The project follows the chain: a caller naming a chain id has already named the network,
  // and each network has a ZeroDev project of its own.
  const projectId = params.projectId ?? getFluentZeroDevProjectId(
    getFluentWidgetNetworkForChainId(chainId),
  );
  const baseUrl = `https://rpc.zerodev.app/api/v3/${projectId}/chain/${chainId}`;
  return params.selfFunded ? `${baseUrl}?${FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY}` : baseUrl;
}

export function createFluentZeroDevErc20PaymasterRpcUrl(params: {
  chainId?: number;
  projectId?: string;
} = {}) {
  return createFluentZeroDevRpcUrl({ ...params, selfFunded: true });
}

/** The App travels in the path, the user's Fluent token in the `Authorization` header. */
export function createFluentSponsorshipRpcUrl(params: {
  sponsorshipUrl: string;
  appId: string;
}) {
  const base = params.sponsorshipUrl.replace(/\/+$/, "");
  return `${base}/paymaster/${encodeURIComponent(params.appId)}`;
}

/**
 * The sponsorship paymaster for one user. `bearerToken` is the Fluent token that
 * `getAuthToken()` mints: the service binds its `aud` to the App and the UserOp `sender` to an
 * address this user proved, and a Privy access token carries neither binding.
 */
export function createFluentZeroDevSponsoredPaymaster(params: {
  chain: Chain;
  rpcUrl: string;
  bearerToken: string;
}) {
  const paymasterClient = createZeroDevPaymasterClient({
    chain: params.chain,
    transport: http(params.rpcUrl, {
      timeout: FLUENT_RPC_TIMEOUT_MS,
      fetchOptions: { headers: { Authorization: `Bearer ${params.bearerToken}` } },
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
): { address: Address; symbol?: string } {
  if (typeof token === "object") return token;
  if (token.startsWith("0x")) return { address: token as Address };

  const tokens = getFluentZeroDevErc20PaymasterTokens(network);
  const resolved = tokens[token.toUpperCase()];
  // Throws rather than returning undefined: the keys are no longer a literal
  // union, so TypeScript can't catch a wrong symbol, and every caller reaches
  // straight for `.address` to sponsor a UserOp.
  if (!resolved) {
    throw new Error(
      `"${token}" cannot pay gas on ${network}. Paymaster tokens: ${
        Object.keys(tokens).join(", ") || "none"
      }`,
    );
  }
  return resolved;
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
      { timeout: FLUENT_RPC_TIMEOUT_MS },
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

/**
 * Why a `FluentGasPaymentError` was thrown. `paymaster_unavailable`: the request for the address
 * of the paymaster that charges Gas tokens on the operation's Network failed, or its answer held
 * no address, so the widget has no spender to approve the Gas token to. Keep a `default` branch
 * in a `switch` over it: a later release may add a code.
 */
export type FluentGasPaymentErrorCode = "paymaster_unavailable";

/**
 * A Gas token payment the widget could not prepare. Thrown by `execute()` of a Fluent ID's Batch
 * operation paid in a Gas token, before any signature is requested and before anything is sent,
 * so the operation can be tried again as it is. `code`, a `FluentGasPaymentErrorCode`,
 * identifies the failure; `cause` holds the error of the failed request when there was one.
 */
export class FluentGasPaymentError extends Error {
  constructor(
    readonly code: FluentGasPaymentErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FluentGasPaymentError";
  }
}

/**
 * The ERC-20 paymaster's address per paymaster RPC URL, which names the chain and the ZeroDev
 * project. Only an address ZeroDev gave is kept: a failed or empty answer is asked again by the
 * next operation. Not per subject: every account on one chain approves the same paymaster.
 */
const erc20PaymasterAddresses = new Map<string, Address>();

/**
 * The address of the ERC-20 paymaster on `chain`, as ZeroDev's `zd_pm_accounts` names it for
 * the v0.7 EntryPoint: the spender a Gas token approval has to name.
 *
 * Asked the way `@zerodev/sdk` 5.5.10 `getERC20PaymasterApproveCall` asks it, which encodes
 * `response[0]` without looking at it. This one checks it, because a spender cannot be guessed.
 *
 * @throws `FluentGasPaymentError` with `code` `paymaster_unavailable` when the request fails
 * or names no address.
 */
export async function readFluentZeroDevErc20PaymasterAddress(params: {
  chain?: Chain;
  paymasterClient?: ZeroDevPaymasterClient;
  paymasterRpcUrl?: string;
} = {}): Promise<Address> {
  const chain = params.chain ?? fluentTestnet;
  const paymasterRpcUrl =
    params.paymasterRpcUrl ?? createFluentZeroDevErc20PaymasterRpcUrl({ chainId: chain.id });
  // A client the caller built has a URL this module cannot see, so its answer is not kept.
  const cacheKey = params.paymasterClient ? undefined : paymasterRpcUrl;
  const known = cacheKey ? erc20PaymasterAddresses.get(cacheKey) : undefined;
  if (known) return known;
  const paymasterClient =
    params.paymasterClient ??
    createFluentZeroDevErc20PaymasterClient({ chain, paymasterRpcUrl });
  // `zd_pm_accounts` is not in the client's typed schema: `@zerodev/sdk` sends it the same way.
  const request = paymasterClient.request as (args: {
    method: "zd_pm_accounts";
    params: [{ chainId: number; entryPointAddress: Address }];
  }) => Promise<unknown>;
  let response: unknown;
  try {
    response = await request({
      method: "zd_pm_accounts",
      params: [{ chainId: chain.id, entryPointAddress: getEntryPoint("0.7").address }],
    });
  } catch (err) {
    throw new FluentGasPaymentError(
      "paymaster_unavailable",
      `ZeroDev could not name the ERC-20 paymaster for chain ${chain.id}`,
      { cause: err },
    );
  }
  const address = Array.isArray(response) ? response[0] : undefined;
  if (typeof address !== "string" || !isAddress(address)) {
    throw new FluentGasPaymentError(
      "paymaster_unavailable",
      `ZeroDev named no ERC-20 paymaster for chain ${chain.id}`,
    );
  }
  const paymaster = getAddress(address);
  if (cacheKey) erc20PaymasterAddresses.set(cacheKey, paymaster);
  return paymaster;
}

/** `gasToken.approve(spender, amount)`, as one call of a Batch operation. */
export function createFluentErc20ApproveCall(params: {
  gasToken: Address;
  spender: Address;
  amount: bigint;
}): { to: Address; data: Hex; value: bigint } {
  return {
    to: params.gasToken,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [params.spender, params.amount],
    }),
    value: 0n,
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
  const gasToken = resolveFluentZeroDevErc20PaymasterToken(
    params.gasToken,
    params.network,
  );
  const spender = await readFluentZeroDevErc20PaymasterAddress({
    chain: params.chain,
    paymasterClient: params.paymasterClient,
    paymasterRpcUrl: params.paymasterRpcUrl,
  });
  return createFluentErc20ApproveCall({
    gasToken: gasToken.address,
    spender,
    amount: params.approveAmount,
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
    bundlerTransport: http(params.kernel.zeroDevRpcUrl, { timeout: FLUENT_RPC_TIMEOUT_MS }),
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
