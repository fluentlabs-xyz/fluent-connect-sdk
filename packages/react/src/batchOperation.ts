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
  sendCalls: (calls: FluentEncodedBatchCall[]) => Promise<Hash>;
};

export type FluentBatchOperation = {
  id?: string;
  button?: FluentBatchButtonConfig;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  canExecute: boolean;
  execute: (executor?: FluentBatchOperationExecutor) => Promise<Hash>;
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
    canExecute: Boolean(executor?.account?.executionReady ?? executor?.smartAccountReady),
    async execute(overrideExecutor) {
      const activeExecutor = overrideExecutor ?? executor;
      if (!activeExecutor) {
        throw new Error("A Fluent batch operation requires a Fluent execution executor");
      }
      const executionReady = activeExecutor.account?.executionReady ?? activeExecutor.smartAccountReady === true;
      if (!executionReady) {
        throw new Error(
          activeExecutor.account?.executionError ??
            "Fluent smart account execution is not available for this widget session",
        );
      }
      return activeExecutor.sendCalls(encodedCalls);
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
