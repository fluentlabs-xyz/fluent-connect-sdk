import { CallType, ParamCondition } from "@zerodev/permissions/policies";
import { generatePrivateKey } from "viem/accounts";
import type { Abi, AbiFunction, AbiParameter, Address, Hex } from "viem";

import {
  createFluentZeroDevPermissionSession,
  type FluentZeroDevKernel,
  type FluentZeroDevPermissionCall,
  type FluentZeroDevPermissionSession,
} from "./zerodevSession";

export type FluentPermissionArgConstraint =
  | { equals: unknown }
  | { max: unknown }
  | { min: unknown };

export type FluentPermissionArgs =
  | readonly (FluentPermissionArgConstraint | null | undefined)[]
  | Record<string, FluentPermissionArgConstraint | null | undefined>;

export type FluentPermissionCallInput = {
  id?: string;
  to: Address;
  abi: Abi;
  method?: string;
  functionName?: string;
  args?: FluentPermissionArgs;
  valueLimit?: bigint;
};

export type FluentPermissionCallPolicy = {
  kind: "call";
  id?: string;
  call: FluentPermissionCallInput;
};

export type FluentPermissionBatchPolicy = {
  kind: "batch";
  id?: string;
  calls: readonly FluentPermissionCallInput[];
};

export type FluentPermissionBatchPolicyInput = {
  id?: string;
  calls: readonly FluentPermissionCallInput[];
};

export type FluentPermissionPolicy = FluentPermissionCallPolicy | FluentPermissionBatchPolicy;

export type FluentPermissionSessionInput = {
  label?: string;
  delegate?: Address;
  expiresAt?: Date | number;
  sessionPrivateKey?: Hex;
  policies: readonly FluentPermissionPolicy[];
};

export type FluentPermissionSession = FluentZeroDevPermissionSession & {
  label?: string;
  delegate?: Address;
  expiresAt?: number;
  policies: readonly FluentPermissionPolicy[];
};

export type FluentPermissionPolicyBuilders = {
  call: (input: FluentPermissionCallInput) => FluentPermissionCallPolicy;
  batch: (input: FluentPermissionBatchPolicyInput) => FluentPermissionBatchPolicy;
};

export type FluentPermissionApi = {
  createPermissionSession: (input: FluentPermissionSessionInput) => Promise<FluentPermissionSession>;
  policies: FluentPermissionPolicyBuilders;
};

export type FluentPermissionSessionExecutor = {
  kernel: FluentZeroDevKernel | null;
  smartAccountReady?: boolean;
};

export function createFluentPermissionApi(
  executor?: FluentPermissionSessionExecutor | null,
): FluentPermissionApi {
  return {
    createPermissionSession: (input) => createFluentPermissionSession(input, executor),
    policies: createFluentPermissionPolicyBuilders(),
  };
}

export function createFluentPermissionPolicyBuilders(): FluentPermissionPolicyBuilders {
  return {
    call: (input) => ({
      kind: "call",
      id: input.id,
      call: input,
    }),
    batch: (input) => ({
      kind: "batch",
      id: input.id,
      calls: input.calls,
    }),
  };
}

export async function createFluentPermissionSession(
  input: FluentPermissionSessionInput,
  executor?: FluentPermissionSessionExecutor | null,
): Promise<FluentPermissionSession> {
  if (!executor?.kernel || executor.smartAccountReady === false) {
    throw new Error("ZeroDev smart account is not ready");
  }
  if (input.policies.length === 0) {
    throw new Error("A permission session requires at least one policy");
  }

  /// 1. Convert builder-readable policies into ZeroDev call permissions.
  /// Batch policies are scoped to batch user operations; call policies are scoped
  /// to direct user operations.
  const calls = input.policies.flatMap((policy) =>
    policy.kind === "batch"
      ? policy.calls.map((call) => toZeroDevPermissionCall(call, CallType.BATCH_CALL))
      : [toZeroDevPermissionCall(policy.call, CallType.CALL)],
  );
  const expiresAt = toUnixSeconds(input.expiresAt);
  const permission = await createFluentZeroDevPermissionSession({
    kernel: executor.kernel,
    sessionPrivateKey: input.sessionPrivateKey ?? generatePrivateKey(),
    calls,
    expiresAt,
  });

  return {
    ...permission,
    label: input.label,
    delegate: input.delegate,
    expiresAt,
    policies: input.policies,
  };
}

function toZeroDevPermissionCall(
  call: FluentPermissionCallInput,
  callType: CallType,
): FluentZeroDevPermissionCall {
  const functionName = call.functionName ?? call.method;
  if (!functionName) throw new Error("Permission policy requires method or functionName");

  return {
    target: call.to,
    abi: call.abi,
    functionName,
    args: normalizePermissionArgs(call.abi, functionName, call.args),
    callType,
    valueLimit: call.valueLimit,
  };
}

function normalizePermissionArgs(
  abi: Abi,
  functionName: string,
  args: FluentPermissionArgs | undefined,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args.map(toZeroDevCondition);

  const fn = findAbiFunction(abi, functionName);
  const namedArgs = args as Record<string, FluentPermissionArgConstraint | null | undefined>;
  return fn.inputs.map((input) => {
    if (!input.name) return null;
    return toZeroDevCondition(namedArgs[input.name]);
  });
}

function toZeroDevCondition(rule: FluentPermissionArgConstraint | null | undefined) {
  if (!rule) return null;
  if ("equals" in rule) {
    return { condition: ParamCondition.EQUAL, value: rule.equals };
  }
  if ("max" in rule) {
    return { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: rule.max };
  }
  return { condition: ParamCondition.GREATER_THAN_OR_EQUAL, value: rule.min };
}

function findAbiFunction(abi: Abi, functionName: string): AbiFunction {
  const matches = abi.filter(
    (item): item is AbiFunction => item.type === "function" && item.name === functionName,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Function "${functionName}" not found in ABI`
        : `Function "${functionName}" is overloaded; pass positional args or a filtered ABI`,
    );
  }
  return matches[0] as AbiFunction & { inputs: readonly AbiParameter[] };
}

function toUnixSeconds(value: Date | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}
