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

export type FluentBatchConfirmationMode = "always" | "session";

export type FluentBatchGasPayment = {
  token: Address;
  symbol?: string;
  includeApproval?: boolean;
  approveAmount?: bigint;
  paymasterRpcUrl?: string;
};

export type FluentBatchExecutionOptions = {
  confirmation?: FluentBatchConfirmationMode;
  gasPayment?: FluentBatchGasPayment | null;
};

export type FluentBatchExecutionContext = {
  confirmation: FluentBatchConfirmationMode;
  gasPayment?: FluentBatchGasPayment | null;
};

export type FluentBatchOperationReview = {
  id?: string;
  button?: FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  account?: FluentWidgetAccount;
};

export type FluentBatchOperationExecutor = {
  smartAccountReady?: boolean;
  account?: FluentWidgetAccount;
  ensureReady?: (context: FluentBatchExecutionContext) => Promise<unknown>;
  defaultConfirmation?: FluentBatchConfirmationMode;
  confirm?: (operation: FluentBatchOperationReview) => Promise<void>;
  sendCalls: (calls: FluentEncodedBatchCall[], context: FluentBatchExecutionContext) => Promise<Hash>;
};

export type FluentBatchOperation = {
  id?: string;
  button?: FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  canExecute: boolean;
  execute: (
    optionsOrExecutor?: FluentBatchExecutionOptions | FluentBatchOperationExecutor,
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
      const options = isBatchExecutor(optionsOrExecutor) ? undefined : optionsOrExecutor;
      const activeExecutor = overrideExecutor ?? (isBatchExecutor(optionsOrExecutor) ? optionsOrExecutor : executor);
      if (!activeExecutor) {
        throw new Error("A Fluent batch operation requires a Fluent execution executor");
      }
      const confirmation = options?.confirmation ?? activeExecutor.defaultConfirmation ?? "always";
      const executionContext = { confirmation, gasPayment: options?.gasPayment };
      const executionReady = activeExecutor.account?.executionReady ?? activeExecutor.smartAccountReady === true;
      if (confirmation === "always") {
        await activeExecutor.confirm?.({
          id: input.id,
          button,
          calls: input.calls,
          encodedCalls,
          account: activeExecutor.account,
        });
      }
      if (!executionReady) {
        if (!activeExecutor.ensureReady) {
          throw new Error(
            activeExecutor.account?.executionError ??
              "Fluent smart account execution is not available for this widget session",
          );
        }
        await activeExecutor.ensureReady(executionContext);
      }
      return activeExecutor.sendCalls(encodedCalls, executionContext);
    },
  };
}

function isBatchExecutor(
  value: FluentBatchExecutionOptions | FluentBatchOperationExecutor | undefined,
): value is FluentBatchOperationExecutor {
  return Boolean(value && "sendCalls" in value);
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
