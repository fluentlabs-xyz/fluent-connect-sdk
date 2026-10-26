import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import {
  estimateUserOperationGas,
  getPaymasterData,
  getPaymasterStubData,
  type EstimateUserOperationGasParameters,
  type PrepareUserOperationParameters,
  type GetPaymasterDataParameters,
  type GetPaymasterStubDataReturnType,
} from "viem/account-abstraction";

/**
 * The account's own gas limits, all three fixed, for a `FluentUserOperationGas` that skips
 * estimation.
 *
 * @experimental May change or be removed in a minor release while the gas policy is measured;
 * omitting it, which lets the widget estimate, is the recommended setting.
 */
export type FluentFixedAccountGas = {
  /** Whole-batch execution budget, including any Gas token approval. Positive uint128. */
  callGasLimit: bigint;
  /** Account validation and deployment budget. Positive uint128. */
  verificationGasLimit: bigint;
  /** Calldata overhead, or its ceiling with provider-owned paymaster gas. Positive uint256. */
  preVerificationGas: bigint;
};

/**
 * The paymaster's gas limits for a `FluentUserOperationGas` that skips estimation: both, or
 * neither to use the limits the paymaster authorizes.
 *
 * @experimental May change or be removed in a minor release while the gas policy is measured;
 * omitting it, which lets the widget estimate, is the recommended setting.
 */
export type FluentFixedPaymasterGas = {
  /** Fixed validation budget, a positive uint128. Omit both paymaster limits to use its answer. */
  paymasterVerificationGasLimit?: bigint;
  /** Fixed post-operation budget, a nonnegative uint128. Supplied together with validation. */
  paymasterPostOpGasLimit?: bigint;
};

/**
 * Gas policy for a Fluent ID batch. Estimation is enabled unless `skipEstimation` is true.
 * Skipping requires account limits. Omit both paymaster limits to use provider-authorized
 * paymaster gas and calldata overhead within `preVerificationGas`; supply both to fix all gas.
 * The fixed limits are a `FluentFixedAccountGas` and a `FluentFixedPaymasterGas`.
 *
 * @experimental May change or be removed in a minor release while the gas policy is measured;
 * omitting it, which lets the widget estimate, is the recommended setting.
 */
export type FluentUserOperationGas =
  | (FluentFixedAccountGas & FluentFixedPaymasterGas & {
      /** Skip the account gas hook and bundler gas estimation. Defaults to false. */
      skipEstimation: true;
      callGasBuffer?: never;
    })
  | { skipEstimation?: false; callGasLimit: bigint; callGasBuffer?: never }
  | {
      skipEstimation?: false;
      callGasLimit?: never;
      callGasBuffer: {
        /** Extra percent of the bundler estimate, rounded up. Must be a nonnegative safe integer. */
        percentage?: number;
        /** Extra gas added after the percentage buffer. Must be nonnegative. */
        fixed?: bigint;
      };
    };

/**
 * Reasons explicit gas preparation can fail before signing.
 *
 * @experimental May change or be removed in a minor release while the gas policy is measured;
 * omitting it, which lets the widget estimate, is the recommended setting.
 */
export type FluentUserOperationGasErrorCode = "invalid_policy" | "paymaster_gas_mismatch";

/**
 * An invalid skip-estimation policy or paymaster authorization for different gas limits.
 * `code`, a `FluentUserOperationGasErrorCode`, identifies the failure; `message` names the
 * option or gas field to correct.
 *
 * @experimental May change or be removed in a minor release while the gas policy is measured;
 * omitting it, which lets the widget estimate, is the recommended setting.
 */
export class FluentUserOperationGasError extends Error {
  constructor(readonly code: FluentUserOperationGasErrorCode, message: string) {
    super(message);
    this.name = "FluentUserOperationGasError";
  }
}

// EntryPoint 0.7 packs callGasLimit into a uint128.
const maxCallGasLimit = (1n << 128n) - 1n;
const maxPreVerificationGas = (1n << 256n) - 1n;

export function validateUserOperationGas(gas?: FluentUserOperationGas) {
  if (!gas) return;
  if (gas.skipEstimation !== undefined && typeof gas.skipEstimation !== "boolean") {
    throw new FluentUserOperationGasError("invalid_policy", "skipEstimation must be a boolean");
  }
  if (gas.skipEstimation) {
    if (gas.callGasBuffer !== undefined) {
      throw new FluentUserOperationGasError(
        "invalid_policy", "skipEstimation cannot be combined with callGasBuffer",
      );
    }
    validateFixedLimit("callGasLimit", gas.callGasLimit);
    validateFixedLimit("verificationGasLimit", gas.verificationGasLimit);
    validateFixedLimit("preVerificationGas", gas.preVerificationGas, maxPreVerificationGas);
    if (gas.paymasterVerificationGasLimit !== undefined) {
      validateFixedLimit("paymasterVerificationGasLimit", gas.paymasterVerificationGasLimit);
    }
    if (gas.paymasterPostOpGasLimit !== undefined) {
      validateFixedLimit(
        "paymasterPostOpGasLimit", gas.paymasterPostOpGasLimit, maxCallGasLimit, 0n,
      );
    }
    return;
  }
  if (gas.callGasLimit !== undefined) {
    if (gas.callGasBuffer !== undefined) {
      throw new Error("Choose callGasLimit or callGasBuffer, not both");
    }
    if (typeof gas.callGasLimit !== "bigint" || gas.callGasLimit <= 0n || gas.callGasLimit > maxCallGasLimit) {
      throw new Error("callGasLimit must be a positive uint128 bigint");
    }
    return;
  }
  if (!gas.callGasBuffer) throw new Error("UserOperation gas requires callGasLimit or callGasBuffer");
  const { percentage = 0, fixed = 0n } = gas.callGasBuffer;
  if (!Number.isSafeInteger(percentage) || percentage < 0) {
    throw new Error("callGasBuffer.percentage must be a nonnegative safe integer");
  }
  if (typeof fixed !== "bigint" || fixed < 0n || fixed > maxCallGasLimit) {
    throw new Error("callGasBuffer.fixed must be a nonnegative uint128 bigint");
  }
}

export type FluentUserOperationCallArgs = {
  account: FluentZeroDevKernel["account"];
  calls: { to: `0x${string}`; data: `0x${string}`; value: bigint }[];
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  preVerificationGas?: bigint;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymaster?: PrepareUserOperationParameters["paymaster"];
};

/** Resolve execution gas before normal preparation obtains final paymaster data and signs. */
export function withUserOperationGas(
  client: FluentZeroDevKernel["client"],
  args: FluentUserOperationCallArgs,
  gas?: FluentUserOperationGas,
): FluentUserOperationCallArgs {
  validateUserOperationGas(gas);
  if (!gas) return args;
  if (gas.skipEstimation) return withoutGasEstimation(client, args, gas);
  if (gas.callGasBuffer && (gas.callGasBuffer.percentage ?? 0) === 0 && (gas.callGasBuffer.fixed ?? 0n) === 0n) {
    return args;
  }
  const paymaster = args.paymaster ?? client.paymaster;
  const policyArgs: FluentUserOperationCallArgs = {
    ...args,
    // viem treats a getPaymasterData-only adapter as a single authorization
    // before gas estimation. Expose both phases so changed limits are authorized
    // again before signing, including a stub marked final by the provider.
    ...(typeof paymaster === "object" && paymaster.getPaymasterData ? {
      paymaster: {
        async getPaymasterStubData(operation) {
          const getStub = paymaster.getPaymasterStubData ?? paymaster.getPaymasterData!;
          // Data-only adapters can omit gas fields; normal preparation fills them.
          return { ...await getStub.call(paymaster, operation), isFinal: false } as GetPaymasterStubDataReturnType;
        },
        getPaymasterData: paymaster.getPaymasterData.bind(paymaster),
      },
    } : {}),
  };
  if (gas.callGasLimit !== undefined) {
    const callGasLimit = gas.callGasLimit;
    const account = args.account;
    return {
      ...policyArgs,
      callGasLimit,
      account: {
        ...account,
        userOperation: {
          ...account.userOperation,
          async estimateGas(operation) {
            return { ...await account.userOperation?.estimateGas?.(operation), callGasLimit };
          },
        },
      },
    };
  }
  const { percentage = 0, fixed = 0n } = gas.callGasBuffer;
  const account = args.account;
  return {
    ...policyArgs,
    account: {
      ...account,
      userOperation: {
        ...account.userOperation,
        async estimateGas(operation) {
          const existing = await account.userOperation?.estimateGas?.(operation);
          const supplied = { ...operation, ...existing };
          const complete = supplied.callGasLimit !== undefined &&
            supplied.preVerificationGas !== undefined && supplied.verificationGasLimit !== undefined &&
            (!supplied.paymaster || (supplied.paymasterVerificationGasLimit !== undefined &&
              supplied.paymasterPostOpGasLimit !== undefined));
          // This hook runs after calls, factory, nonce, fees and paymaster stub
          // preparation. Estimate the already prepared request without recursively
          // preparing an account or obtaining final paymaster authorization here.
          const estimate = complete ? supplied : await estimateUserOperationGas(
            { ...client, account: undefined },
            {
              callGasLimit: 0n,
              preVerificationGas: 0n,
              verificationGasLimit: 0n,
              ...(operation.paymaster ? {
                paymasterVerificationGasLimit: 0n,
                paymasterPostOpGasLimit: 0n,
              } : {}),
              ...operation,
              ...existing,
              entryPointAddress: account.entryPoint.address,
            } as EstimateUserOperationGasParameters,
          );
          const configured = supplied.callGasLimit ?? 0n;
          const estimated = estimate.callGasLimit ?? 0n;
          const base = configured > estimated ? configured : estimated;
          const callGasLimit = (base * (100n + BigInt(percentage)) + 99n) / 100n + fixed;
          validateUserOperationGas({ callGasLimit });
          return { ...estimate, ...existing, callGasLimit };
        },
      },
    },
  };
}

function validateFixedLimit(
  field: string,
  value: unknown,
  maximum = maxCallGasLimit,
  minimum = 1n,
) {
  if (typeof value !== "bigint" || value < minimum || value > maximum) {
    throw new FluentUserOperationGasError(
      "invalid_policy",
      `skipEstimation requires ${field} as a bigint between ${minimum} and ${maximum}`,
    );
  }
}

function withoutGasEstimation(
  client: FluentZeroDevKernel["client"],
  args: FluentUserOperationCallArgs,
  gas: FluentFixedAccountGas & FluentFixedPaymasterGas,
): FluentUserOperationCallArgs {
  const paymaster = args.paymaster ?? client.paymaster;
  const fixedPaymasterGas = gas.paymasterVerificationGasLimit !== undefined;
  if (paymaster && fixedPaymasterGas !== (gas.paymasterPostOpGasLimit !== undefined)) {
    throw new FluentUserOperationGasError(
      "invalid_policy",
      "skipEstimation requires both paymasterVerificationGasLimit and paymasterPostOpGasLimit " +
        "or neither when a paymaster is used",
    );
  }
  const providerGas = Boolean(paymaster && !fixedPaymasterGas);
  let limits: FluentFixedAccountGas & FluentFixedPaymasterGas = {
    callGasLimit: gas.callGasLimit,
    verificationGasLimit: gas.verificationGasLimit,
    preVerificationGas: gas.preVerificationGas,
    ...(paymaster && fixedPaymasterGas ? {
      paymasterVerificationGasLimit: gas.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit,
    } : {}),
  };
  const adapter = paymaster === true ? {
    getPaymasterStubData: (operation: GetPaymasterDataParameters) =>
      getPaymasterStubData(client, operation),
    getPaymasterData: (operation: GetPaymasterDataParameters) =>
      getPaymasterData(client, operation),
  } : typeof paymaster === "object" ? paymaster : undefined;
  if (providerGas && !adapter) {
    throw new FluentUserOperationGasError(
      "invalid_policy", "skipEstimation needs a paymaster adapter to obtain provider gas limits",
    );
  }
  // This closure belongs to one preparation. The account hook must return the authorized
  // values, or viem would overwrite a data-only adapter's signed gas with the initial budgets.
  const acceptGas = (data: unknown, isFinal: boolean) => {
    if (providerGas) {
      if (isFinal) assertAuthorizedGas(data, {
        callGasLimit: gas.callGasLimit,
        verificationGasLimit: gas.verificationGasLimit,
      });
      limits = readProviderGas(data, limits, gas.preVerificationGas);
    } else if (isFinal) assertAuthorizedGas(data, limits);
  };
  return {
    ...args,
    ...limits,
    ...(adapter ? {
      paymaster: {
        async getPaymasterStubData(operation) {
          const getStub = adapter.getPaymasterStubData ?? adapter.getPaymasterData!;
          // Safe: changing gas fields preserves viem's EntryPoint-specific operation variant.
          const fixedOperation = { ...operation, ...limits } as typeof operation;
          const data = await getStub.call(adapter, fixedOperation);
          // A data-only adapter already returns final authorization. A nonfinal stub
          // still needs final authorization before signing.
          const isFinal = !adapter.getPaymasterStubData ||
            ("isFinal" in data && data.isFinal === true);
          acceptGas(data, isFinal);
          // Safe: all account and paymaster gas fields were validated; the adapter
          // supplies the paymaster address and data required by viem's stub contract.
          return { ...data, ...limits, isFinal } as GetPaymasterStubDataReturnType;
        },
        async getPaymasterData(operation) {
          // Safe: the prepared operation keeps its EntryPoint-specific fields unchanged.
          const fixedOperation = { ...operation, ...limits } as typeof operation;
          const data = await adapter.getPaymasterData!(fixedOperation);
          acceptGas(data, true);
          // Safe: Fluent IDs use EntryPoint 0.7; only validated gas fields are added.
          return { ...data, ...limits } as typeof data;
        },
      },
    } : {}),
    account: {
      ...args.account,
      userOperation: {
        ...args.account.userOperation,
        // Returning every required field keeps viem from invoking the bundler estimator.
        // The original account hook is deliberately bypassed for this submission alone.
        estimateGas: async () => limits,
      },
    },
  };
}

function readProviderGas(
  data: unknown,
  current: FluentFixedAccountGas & FluentFixedPaymasterGas,
  preVerificationGasCeiling: bigint,
): FluentFixedAccountGas & FluentFixedPaymasterGas {
  if (!data || typeof data !== "object") {
    throw new FluentUserOperationGasError(
      "paymaster_gas_mismatch", "skipEstimation requires a paymaster authorization object",
    );
  }
  const next = { ...current };
  for (const [field, minimum, maximum] of [
    ["preVerificationGas", 1n, preVerificationGasCeiling],
    ["paymasterVerificationGasLimit", 1n, maxCallGasLimit],
    ["paymasterPostOpGasLimit", 0n, maxCallGasLimit],
  ] as const) {
    const value: unknown = Object.hasOwn(data, field) ? Reflect.get(data, field) : current[field];
    if (typeof value !== "bigint" || value < minimum || value > maximum) {
      throw new FluentUserOperationGasError(
        "paymaster_gas_mismatch",
        `Paymaster ${field} must be a bigint between ${minimum} and ${maximum}`,
      );
    }
    next[field] = value;
  }
  return next;
}

function assertAuthorizedGas(
  data: unknown,
  limits: Partial<FluentFixedAccountGas & FluentFixedPaymasterGas>,
) {
  if (!data || typeof data !== "object") {
    throw new FluentUserOperationGasError(
      "paymaster_gas_mismatch", "skipEstimation requires a paymaster authorization object",
    );
  }
  for (const [field, value] of Object.entries(limits)) {
    const authorized = Reflect.get(data, field);
    if (authorized !== undefined && authorized !== value) {
      throw new FluentUserOperationGasError(
        "paymaster_gas_mismatch", `Paymaster changed ${field} with skipEstimation enabled`,
      );
    }
  }
}
