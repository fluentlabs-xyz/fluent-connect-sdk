import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import {
  estimateUserOperationGas,
  type EstimateUserOperationGasParameters,
  type PrepareUserOperationParameters,
  type GetPaymasterStubDataReturnType,
} from "viem/account-abstraction";

/** Execution gas policy for a smart-account batch. Other UserOperation gas fields remain estimated. */
export type FluentUserOperationGas =
  | { callGasLimit: bigint; callGasBuffer?: never }
  | {
      callGasLimit?: never;
      callGasBuffer: {
        /** Extra percent of the bundler estimate, rounded up. Must be a nonnegative safe integer. */
        percentage?: number;
        /** Extra gas added after the percentage buffer. Must be nonnegative. */
        fixed?: bigint;
      };
    };

// EntryPoint 0.7 packs callGasLimit into a uint128.
const maxCallGasLimit = (1n << 128n) - 1n;

export function validateUserOperationGas(gas?: FluentUserOperationGas) {
  if (!gas) return;
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
