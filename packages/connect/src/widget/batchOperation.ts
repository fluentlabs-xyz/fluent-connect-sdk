import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import type { FluentPermissionApi } from "./permissionSession";
import type { FluentGasPaymentSymbol } from "../core/gasPayment";

export type FluentBatchCallInput = {
  id?: string;
  label?: string;
  to: Address;
  value?: bigint;
  data?: Hex;
  abi?: Abi;
  method?: string;
  functionName?: string;
  args?: readonly unknown[];
};

export type FluentEncodedBatchCall = {
  id?: string;
  label?: string;
  to: Address;
  value: bigint;
  data: Hex;
};

export type FluentWidgetExecutionStatus = "disconnected" | "ready" | "unavailable" | "error";

/** How the connected account executes transactions. */
export type FluentAccountType = "smart" | "eoa";

export type FluentAccountCapabilities = {
  /** Multiple calls land in a single atomic transaction (smart account only). */
  atomicBatch: boolean;
  /**
   * Gas can be paid in an ERC-20 (BLEND / USDnr) via the paymaster instead of
   * native ETH — smart account only. This is NOT free/sponsored gas: the user
   * still pays, just in a token. Without an ERC-20 selection the smart account
   * pays gas in native ETH from its own balance.
   */
  erc20Gas: boolean;
};

export type FluentWidgetAccount = {
  address?: Address;
  signerAddress?: Address;
  connected: boolean;
  executionReady: boolean;
  executionStatus: FluentWidgetExecutionStatus;
  executionError?: string;
  /** Active account kind, or undefined when nothing is connected. */
  type?: FluentAccountType;
  /** What the active account can do — lets hosts adapt UI without branching on `type`. */
  capabilities: FluentAccountCapabilities;
};

/** Result of executing a batch operation. */
export type FluentExecuteResult = {
  /** Primary transaction hash — the final/target call (e.g. deposit/withdraw). */
  hash: Hash;
  /** All transaction hashes in order. One for a smart-account UserOp; one per call for an EOA. */
  hashes: Hash[];
  /** True when all calls landed atomically (smart account), false for sequential EOA txs. */
  atomic: boolean;
};

export type FluentWidgetGasPayment = {
  symbol: FluentGasPaymentSymbol;
  token?: Address;
  decimals: number;
};

export type FluentBatchOperationInput = {
  id?: string;
  /** Heading shown in the Fluent transaction-review modal (smart account, confirmation "always"). Defaults to "Confirm transaction". */
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
};

export type FluentBatchOperationExecutor = {
  smartAccountReady?: boolean;
  account?: FluentWidgetAccount;
  ensureReady?: (options: FluentBatchOperationExecuteOptions) => Promise<unknown>;
  defaultConfirmation?: FluentBatchConfirmationMode;
  /**
   * Gas token selected in the widget UI. Used as the default when `execute` is
   * called without an explicit `gasPayment`, so the in-widget selector actually
   * drives which token pays for gas. Native-gas selections (no `token`) fall
   * back to native gas (no ERC20 paymaster).
   */
  defaultGasPayment?: FluentWidgetGasPayment;
  confirm?: (operation: FluentBatchOperationReview) => Promise<void>;
  sendCalls: (
    calls: FluentEncodedBatchCall[],
    options: FluentBatchOperationExecuteOptions,
  ) => Promise<FluentExecuteResult>;
};

export type FluentBatchConfirmationMode = "always" | "session";

export type FluentGasPayment = {
  /**
   * Gas token symbol. The widget resolves the ERC-20 address for the active
   * network internally — callers never pass (or risk mistyping) an address.
   * `"ETH"` means native gas (no paymaster).
   */
  symbol: FluentGasPaymentSymbol;
} & (
  | {
      includeApproval: true;
      approveAmount: bigint;
    }
  | {
      includeApproval?: false;
      approveAmount?: never;
    }
);

export type FluentBatchOperationExecuteOptions = {
  confirmation?: FluentBatchConfirmationMode;
  gasPayment?: FluentGasPayment;
};

export type FluentBatchOperationReview = {
  id?: string;
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  account?: FluentWidgetAccount;
};

export type FluentBatchOperation = {
  id?: string;
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  canExecute: boolean;
  execute: (
    optionsOrExecutor?: FluentBatchOperationExecuteOptions | FluentBatchOperationExecutor,
    executor?: FluentBatchOperationExecutor,
  ) => Promise<FluentExecuteResult>;
};

export type FluentBatchApi = FluentPermissionApi & {
  account: FluentWidgetAccount;
  confirmationMode: FluentBatchConfirmationMode;
  gasPayment: FluentWidgetGasPayment;
  createBatchOp: (input: FluentBatchOperationInput) => FluentBatchOperation;
};

export function createFluentBatchOp(
  input: FluentBatchOperationInput,
  executor?: FluentBatchOperationExecutor | null,
): FluentBatchOperation {
  if (input.calls.length === 0) {
    throw new Error("A Fluent batch operation requires at least one call");
  }

  const encodedCalls = input.calls.map(encodeBatchCall);

  return {
    id: input.id,
    reviewTitle: input.reviewTitle,
    calls: input.calls,
    encodedCalls,
    canExecute: Boolean(
      executor &&
        (executor.account?.executionReady || executor.smartAccountReady || executor.ensureReady),
    ),
    async execute(optionsOrExecutor, overrideExecutor) {
      const inlineExecutor =
        optionsOrExecutor && "sendCalls" in optionsOrExecutor ? optionsOrExecutor : undefined;
      const options =
        optionsOrExecutor && "sendCalls" in optionsOrExecutor ? undefined : optionsOrExecutor;
      const activeExecutor = overrideExecutor ?? inlineExecutor ?? executor;
      if (!activeExecutor) {
        throw new Error("A Fluent batch operation requires a Fluent execution executor");
      }
      // Default the gas token to the one selected in the widget UI when the
      // caller doesn't pass an explicit `gasPayment`. Native-gas selections
      // (no token address) leave `gasPayment` undefined → native gas.
      const fallbackGasPayment: FluentGasPayment | undefined =
        activeExecutor.defaultGasPayment?.token
          ? { symbol: activeExecutor.defaultGasPayment.symbol }
          : undefined;
      const executionOptions: FluentBatchOperationExecuteOptions = {
        ...options,
        confirmation: options?.confirmation ?? activeExecutor.defaultConfirmation ?? "always",
        gasPayment: options?.gasPayment ?? fallbackGasPayment,
      };
      // The Fluent review modal explains the embedded-signer UserOp. An external
      // EOA shows its own wallet prompt, so skip our modal for that account type.
      if (executionOptions.confirmation === "always" && activeExecutor.account?.type !== "eoa") {
        await activeExecutor.confirm?.({
          id: input.id,
          reviewTitle: input.reviewTitle,
          calls: input.calls,
          encodedCalls,
          account: activeExecutor.account,
        });
      }
      const executionReady = activeExecutor.account?.executionReady ?? activeExecutor.smartAccountReady === true;
      if (!executionReady) {
        if (!activeExecutor.ensureReady) {
          throw new Error(
            activeExecutor.account?.executionError ??
              "Fluent smart account execution is not available for this widget session",
          );
        }
        await activeExecutor.ensureReady(executionOptions);
      }
      return activeExecutor.sendCalls(encodedCalls, executionOptions);
    },
  };
}

function encodeBatchCall(call: FluentBatchCallInput): FluentEncodedBatchCall {
  if (call.data) {
    return {
      id: call.id,
      label: call.label,
      to: call.to,
      value: call.value ?? 0n,
      data: call.data,
    };
  }

  const functionName = call.functionName ?? call.method;
  if (!call.abi || !functionName) {
    throw new Error("Batch call requires either raw data or abi + method");
  }

  return {
    id: call.id,
    label: call.label,
    to: call.to,
    value: call.value ?? 0n,
    data: encodeFunctionData({
      abi: call.abi,
      functionName,
      args: call.args ?? [],
    } as Parameters<typeof encodeFunctionData>[0]),
  };
}
