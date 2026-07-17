import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import type { FluentPermissionApi } from "./permissionSession";

export type FluentBatchButtonConfig = {
  label: string;
  pendingLabel?: string;
  successLabel?: string;
};

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

export type FluentWidgetAccount = {
  address?: Address;
  signerAddress?: Address;
  connected: boolean;
  executionReady: boolean;
  executionStatus: FluentWidgetExecutionStatus;
  executionError?: string;
};

export type FluentBatchOperationInput = {
  id?: string;
  button?: string | FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
};

export type FluentBatchOperationExecutor = {
  smartAccountReady?: boolean;
  account?: FluentWidgetAccount;
  ensureReady?: (options: FluentBatchOperationExecuteOptions) => Promise<unknown>;
  defaultConfirmation?: FluentBatchConfirmationMode;
  confirm?: (operation: FluentBatchOperationReview) => Promise<void>;
  sendCalls: (
    calls: FluentEncodedBatchCall[],
    options: FluentBatchOperationExecuteOptions,
  ) => Promise<Hash>;
};

export type FluentBatchConfirmationMode = "always" | "session";

type FluentGasPaymentBase = {
  token: Address;
  symbol?: string;
};

export type FluentGasPayment = FluentGasPaymentBase &
  (
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
  button?: FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  account?: FluentWidgetAccount;
};

export type FluentBatchOperation = {
  id?: string;
  button?: FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  canExecute: boolean;
  execute: (
    optionsOrExecutor?: FluentBatchOperationExecuteOptions | FluentBatchOperationExecutor,
    executor?: FluentBatchOperationExecutor,
  ) => Promise<Hash>;
};

export type FluentBatchApi = FluentPermissionApi & {
  account: FluentWidgetAccount;
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
  const button = typeof input.button === "string" ? { label: input.button } : input.button;

  return {
    id: input.id,
    button,
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
      const executionOptions: FluentBatchOperationExecuteOptions = {
        ...options,
        confirmation: options?.confirmation ?? activeExecutor.defaultConfirmation ?? "always",
      };
      if (executionOptions.confirmation === "always") {
        await activeExecutor.confirm?.({
          id: input.id,
          button,
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
