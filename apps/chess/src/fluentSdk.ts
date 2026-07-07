import {
  CallType,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  FluentWidget,
  createFluentWidgetConfigFromEnv,
  createFluentZeroDevPermissionSession,
  useFluentZeroDevAccount,
  type FluentBatchApi,
  type FluentExternalWalletState,
  type FluentWidgetRenderContext,
  type FluentWidgetSession,
} from "@fluent/react";
import { fluentTestnet } from "@fluent/wallet-sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";
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
} from "./contracts/abis";
import type { ChessPermissionSession } from "./components/chess/types";

export {
  FluentWidget,
  createFluentWidgetConfigFromEnv as createChessFluentWidgetConfig,
};

export const FLUENT_TESTNET_CHAIN = fluentTestnet;

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
  return account.smartAccountAddress ?? session?.wallet.smartAccountAddress ?? session?.wallet.signerAddress;
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

export async function prepareFluentAccount(account: ChessFluentAccount) {
  if (account.smartAccountReady && account.smartAccountAddress && account.kernel) {
    return account.kernel;
  }
  const kernel = await account.refresh();
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
  account: ChessFluentAccount,
  call: { to: Address; data: Hex },
) {
  return account.sendTransaction(call);
}

export async function approveBlendWithFluentAccount(account: ChessFluentAccount) {
  if (!CHESS_CONTRACT_ADDRESS) throw new Error("Chess contract address is not configured");
  return sendFluentAccountTransaction(account, {
    to: BLEND_TOKEN_ADDRESS,
    data: createBlendApprovalData(),
  });
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

  return op.execute();
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
