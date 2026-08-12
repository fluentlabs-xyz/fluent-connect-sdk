import {
  CallType,
  FLUENT_CONNECT_DEFAULT_ASSETS,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT,
  FluentWidget,
  createFluentZeroDevPermissionSession,
  getFluentChainForNetwork,
  getFluentDefaultGasTokens,
  readFluentTokenBalances,
  resolveFluentWidgetNetworkFromEnv,
  selectFluentGasPaymentToken,
  useFluentZeroDevAccount,
  type FluentBatchApi,
  type FluentExternalWalletState,
  type FluentWidgetRenderContext,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "@fluent.xyz/connect";
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  BLEND_TOKEN_ADDRESS,
  CHESS_BOT_BLEND_SPEND_LIMIT,
  CHESS_CONTRACT_ADDRESS,
} from "./const";
import {
  CHESS_SUBMIT_MOVE_SELECTOR,
  chessAbi,
  erc20Abi,
} from "./contracts";
import type { ChessPermissionSession } from "./components/types";

export { FluentWidget, FLUENT_CONNECT_DEFAULT_ASSETS };

const CHESS_FLUENT_NETWORK = resolveFluentWidgetNetworkFromEnv() ?? "testnet";
export const FLUENT_TESTNET_CHAIN = getFluentChainForNetwork(CHESS_FLUENT_NETWORK);

export function createChessFluentWidgetConfig(): FluentWidgetConfig {
  return {
    clientId: "fluent_chess_blitz",
    network: CHESS_FLUENT_NETWORK,
    appName: "Fluent Chess Blitz",
    authMode: "direct",
    source: "chess_builder_example",
    campaign: "chess",
  };
}

export type {
  FluentBatchApi as ChessFluentBatchApi,
  FluentExternalWalletState as ChessExternalWalletState,
  FluentWidgetRenderContext as ChessFluentWidgetRenderContext,
  FluentWidgetSession as ChessFluentWidgetSession,
};

export type ChessFluentAccount = ReturnType<typeof useFluentZeroDevAccount>;

export function useChessFluentAccount() {
  return useFluentZeroDevAccount();
}

export function getStoredFluentSession(): FluentWidgetSession | null {
  try {
    const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FluentWidgetSession) : null;
  } catch {
    return null;
  }
}

export function getFluentAccountAddress(
  account: ChessFluentAccount,
  session: FluentWidgetSession | null,
) {
  return account.smartAccountAddress ?? session?.wallet.smartAccountAddress;
}

export function getFluentAccountReadinessError(account: ChessFluentAccount) {
  if (!account.privyReady) return "Privy wallet context is still loading";
  if (!account.privyAuthenticated) {
    return "Fluent session is connected, but Privy embedded wallet is not authenticated on this page";
  }
  if (account.embeddedWalletCount === 0) {
    return "Privy is authenticated, but no embedded wallet is available";
  }
  return account.error?.message ?? "Fluent ZeroDev account is still preparing. Try again in a moment.";
}

export async function prepareFluentAccount(
  account: ChessFluentAccount,
  confirmation: "always" | "session" = "always",
) {
  if (account.smartAccountReady && account.smartAccountAddress && account.kernel) {
    return account.kernel;
  }
  const kernel = await account.ensureExecutionReady({ confirmation });
  if (!kernel) {
    throw new Error(getFluentAccountReadinessError(account));
  }
  return kernel;
}

export function assertFluentAccountReady(account: ChessFluentAccount) {
  if (!account.smartAccountReady || !account.smartAccountAddress) {
    throw new Error(getFluentAccountReadinessError(account));
  }
  return account.smartAccountAddress;
}

export async function ensureExternalWalletOnFluent(wallet: FluentExternalWalletState | null) {
  if (!wallet) return;
  if (wallet.chainId !== FLUENT_TESTNET_CHAIN.id) {
    await wallet.switchChain(FLUENT_TESTNET_CHAIN.id);
  }
}

export function createBlendApprovalData(spender = CHESS_CONTRACT_ADDRESS, amount = CHESS_BOT_BLEND_SPEND_LIMIT) {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function createChessMoveData({
  gameId,
  moveUci,
  fenAfterMove,
}: {
  gameId: bigint;
  moveUci: string;
  fenAfterMove: string;
}) {
  return encodeFunctionData({
    abi: chessAbi,
    functionName: "submitMove",
    args: [gameId, moveUci, fenAfterMove],
  });
}

export function createChessGameData(blackPlayer: Address) {
  return encodeFunctionData({
    abi: chessAbi,
    functionName: "createGame",
    args: [blackPlayer],
  });
}

export async function sendFluentAccountTransaction(
  widget: FluentBatchApi,
  call: { to: Address; data: Hex },
) {
  const op = widget.createBatchOp({
    calls: [{
      to: call.to,
      data: call.data,
    }],
  });
  return op.execute({ gasPayment: createBlendGasPayment() });
}

export async function approveBlendWithFluentAccount(widget: FluentBatchApi) {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  return sendFluentAccountTransaction(widget, {
    to: BLEND_TOKEN_ADDRESS,
    data: createBlendApprovalData(),
  });
}

function createBlendGasPayment() {
  return {
    token: BLEND_TOKEN_ADDRESS,
    symbol: "BLEND",
    includeApproval: true as const,
    approveAmount: 100n * 10n ** 18n,
  };
}

export type ChessGasRouteDemoResult = {
  gasToken: Address;
  gasTokenSymbol: string;
  transactionHash: Hex;
};

export async function runPriorityPaymasterDemo({
  widget,
  session,
}: {
  widget: FluentBatchApi;
  session: FluentWidgetSession | null;
}): Promise<ChessGasRouteDemoResult> {
  const smartAccountAddress = widget.account.address ?? session?.wallet.smartAccountAddress;
  if (!smartAccountAddress) {
    throw new Error("Connect Fluent ID before testing gas payment.");
  }

  const publicClient = createPublicClient({
    chain: FLUENT_TESTNET_CHAIN,
    ccipRead: false,
    transport: http(FLUENT_TESTNET_CHAIN.rpcUrls.default.http[0]),
  });
  const balances = await readFluentTokenBalances({
    client: publicClient as never,
    account: smartAccountAddress,
    tokens: [...getFluentDefaultGasTokens(CHESS_FLUENT_NETWORK)],
  });
  const gasToken = selectFluentGasPaymentToken({ balances });
  if (gasToken.status !== "ready") {
    throw new Error("No USDnr, BLEND, or ETH found. Bridge assets to Fluent before testing gas payment.");
  }
  if (gasToken.symbol === "ETH") {
    throw new Error("ETH fallback is selected. ERC20 paymaster test needs USDnr or BLEND.");
  }

  const op = widget.createBatchOp({
    id: "gas-route-demo",
    button: {
      label: "Test gas route",
      pendingLabel: "Testing gas route",
      successLabel: "Gas route confirmed",
    },
    calls: [
      {
        id: "gas-route-noop",
        label: "Gas route no-op",
        to: FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT,
        data: "0x",
      },
    ],
  });
  const transactionHash = await op.execute({
    confirmation: "session",
    gasPayment: {
      token: gasToken.balance.address!,
      symbol: gasToken.symbol,
      includeApproval: true,
      approveAmount: 100n * 10n ** BigInt(gasToken.balance.decimals),
    },
  });

  return {
    gasToken: gasToken.balance.address!,
    gasTokenSymbol: gasToken.symbol,
    transactionHash,
  };
}

export async function approveBlendWithExternalWallet(wallet: FluentExternalWalletState | null) {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  if (!wallet?.walletClient || !wallet.address) throw new Error("Connect external wallet to approve BLEND");
  await ensureExternalWalletOnFluent(wallet);
  return wallet.walletClient.writeContract({
    account: wallet.address as Address,
    chain: FLUENT_TESTNET_CHAIN,
    address: BLEND_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [CHESS_CONTRACT_ADDRESS, CHESS_BOT_BLEND_SPEND_LIMIT],
  });
}

export async function submitChessMoveWithExternalWallet({
  wallet,
  gameId,
  moveUci,
  fenAfterMove,
}: {
  wallet: FluentExternalWalletState | null;
  gameId: bigint;
  moveUci: string;
  fenAfterMove: string;
}) {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  if (!wallet?.walletClient || !wallet.address) throw new Error("Connect external wallet to play this turn");
  await ensureExternalWalletOnFluent(wallet);
  return wallet.walletClient.writeContract({
    account: wallet.address as Address,
    chain: FLUENT_TESTNET_CHAIN,
    address: CHESS_CONTRACT_ADDRESS,
    abi: chessAbi,
    functionName: "submitMove",
    args: [gameId, moveUci, fenAfterMove],
  });
}

export async function submitApproveAndMoveBatch({
  widget,
  moveData,
}: {
  widget: FluentBatchApi;
  moveData: Hex;
}) {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  const op = widget.createBatchOp({
    button: {
      label: "Batch approve + move",
      pendingLabel: "Submitting batch",
      successLabel: "Batch submitted",
    },
    calls: [
      {
        id: "approve-blend",
        label: "Approve BLEND",
        to: BLEND_TOKEN_ADDRESS,
        abi: erc20Abi,
        method: "approve",
        args: [CHESS_CONTRACT_ADDRESS, CHESS_BOT_BLEND_SPEND_LIMIT],
      },
      {
        id: "submit-move",
        label: "Submit chess move",
        to: CHESS_CONTRACT_ADDRESS,
        data: moveData,
      },
    ],
  });

  return op.execute({ gasPayment: createBlendGasPayment() });
}

export async function grantChessBotPermission(account: ChessFluentAccount): Promise<ChessPermissionSession> {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  const kernel = account.kernel ?? await account.refresh();
  if (!kernel) {
    throw new Error(account.error?.message ?? "ZeroDev Fluent Account is not ready");
  }

  const permission = await createFluentZeroDevPermissionSession({
    kernel,
    sessionPrivateKey: generatePrivateKey(),
    calls: [
      {
        target: CHESS_CONTRACT_ADDRESS,
        selector: CHESS_SUBMIT_MOVE_SELECTOR,
        callType: CallType.CALL,
      },
    ],
  });

  return {
    serializedPermissionAccount: permission.serializedPermissionAccount,
    sessionSignerAddress: permission.sessionSignerAddress,
    smartAccountAddress: permission.smartAccountAddress,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
