import { BaseError } from "viem";
import { getUserOperationGasPrice } from "@zerodev/sdk/actions";

import { debugLog, debugWarn } from "./debugLogger";

/**
 * Where one submission's `maxFeePerGas` and `maxPriorityFeePerGas` come from.
 *
 * `chain` is the widget chain's own `eth_gasPrice`, read through the widget's RPC transport;
 * `bundler` is ZeroDev's `zd_getUserOperationGasPrice`, which is what `@zerodev/sdk` installs
 * when a kernel client is built without a fee hook. The chain is asked by default because it
 * answers several times faster than the bundler.
 */
export type FluentFeeSource = "chain" | "bundler";

/** The two fee fields of a user operation, in wei. */
export type FluentUserOperationFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/**
 * The `maxFeePerGas` of a chain quote as a percent of `eth_gasPrice`, on both networks.
 *
 * A cap equal to the price is rejected by a bundler once the next block's base fee rises. EIP-4337
 * charges `min(maxFeePerGas, baseFee + maxPriorityFeePerGas)` and the priority fee is the whole
 * gas price, so an operation pays at most 10 % over `eth_gasPrice`, and all of it once the base
 * fee reaches a tenth of `eth_gasPrice`.
 */
export const FLUENT_CHAIN_FEE_MARGIN_PERCENT = 110n;

/**
 * Returns the chain quote for one operation: `eth_gasPrice` as the priority fee, and the same
 * number with the margin above as the cap, rounded down.
 */
export function quoteFluentChainFees(gasPrice: bigint): FluentUserOperationFees {
  return {
    maxPriorityFeePerGas: gasPrice,
    maxFeePerGas: (gasPrice * FLUENT_CHAIN_FEE_MARGIN_PERCENT) / 100n,
  };
}

/**
 * One submission attempt's fee decision, and the source that answered it.
 *
 * It travels on that submission's account rather than on the kernel client, which lives as long
 * as the account, so two sends through one client, or a send and its retry, cannot read each
 * other's decision.
 */
export type FluentFeeAttempt = {
  /** What this attempt asks for. Fixed when the attempt starts, so a send stays consistent. */
  readonly feeSource: FluentFeeSource;
  /**
   * The source that answered, written by the fee hook once a quote is in hand: `bundler` for a
   * `chain` attempt whose chain quote failed. Absent until then.
   */
  settledFeeSource?: FluentFeeSource;
};

/**
 * The key the attempt travels under. A symbol, so it cannot collide with a field viem or
 * `@zerodev/sdk` reads off an account, and it survives the object spreads both of them do.
 */
const FLUENT_FEE_ATTEMPT = Symbol.for("fluent.userOperation.feeAttempt");

/**
 * Returns a copy of one submission's account that carries that submission's fee decision.
 *
 * viem hands `prepareUserOperation`'s fee hook the very account object the caller passed
 * (`parseAccount` returns a non-string account unchanged, `viem@2.52.0`
 * `_esm/account-abstraction/actions/bundler/prepareUserOperation.js:53`), which makes the
 * account the one channel from a submission to its own fee quote.
 */
export function withFluentFeeAttempt<account extends object>(
  account: account,
  attempt: FluentFeeAttempt,
): account {
  return { ...account, [FLUENT_FEE_ATTEMPT]: attempt };
}

/** Returns the fee decision `withFluentFeeAttempt` put on this account, or `undefined`. */
export function readFluentFeeAttempt(account: unknown): FluentFeeAttempt | undefined {
  if (typeof account !== "object" || account === null) return undefined;
  const attempt = (account as Record<symbol, unknown>)[FLUENT_FEE_ATTEMPT];
  return typeof attempt === "object" && attempt !== null
    ? (attempt as FluentFeeAttempt)
    : undefined;
}

/** Reads ZeroDev's own quote: `zd_getUserOperationGasPrice`, its `standard` tier, unchanged. */
export async function readFluentBundlerFees(
  bundlerClient: unknown,
): Promise<FluentUserOperationFees> {
  // Safe: the client arrives from viem's fee hook, whose own type does not carry ZeroDev's RPC
  // schema, and this action makes exactly one `zd_getUserOperationGasPrice` request on it.
  return getUserOperationGasPrice(bundlerClient as Parameters<typeof getUserOperationGasPrice>[0]);
}

/** What viem passes a `userOperation.estimateFeesPerGas` hook, narrowed to what this one reads. */
type FluentFeeHookParameters = {
  account?: unknown;
  bundlerClient: unknown;
};

/**
 * Returns the `userOperation.estimateFeesPerGas` hook of the kernel client the widget sends
 * Batch operations through.
 *
 * Installing it keeps viem from falling through to the default `@zerodev/sdk@5.5.10` adds
 * (`_esm/clients/kernelAccountClient.js:38-43`), one `zd_getUserOperationGasPrice` round trip
 * on every send. The source is decided per submission: the attempt on the account wins, so a
 * send and its fee retry can differ, and a submission without one reads `readFeeSource` at call
 * time, because the kernel client outlives the configuration it was built with. A chain quote
 * that fails after the RPC transport's own retries falls back to the bundler for that
 * submission alone: the next send asks the chain first again.
 *
 * @example
 * ```ts
 * createKernelAccountClient({
 *   account,
 *   chain,
 *   bundlerTransport,
 *   client: publicClient,
 *   userOperation: {
 *     estimateFeesPerGas: createFluentUserOperationFeeHook({
 *       readGasPrice: () => publicClient.getGasPrice(),
 *       readFeeSource: () => "chain",
 *     }),
 *   },
 * });
 * ```
 */
export function createFluentUserOperationFeeHook(params: {
  /** The widget chain's `eth_gasPrice`, on the widget's own RPC transport. */
  readGasPrice: () => Promise<bigint>;
  /** The configured source, read at call time for the submissions that carry no attempt. */
  readFeeSource: () => FluentFeeSource;
}): (hookParams: FluentFeeHookParameters) => Promise<FluentUserOperationFees> {
  return async ({ account, bundlerClient }) => {
    const attempt = readFluentFeeAttempt(account);
    const requested = attempt?.feeSource ?? params.readFeeSource();
    if (requested === "chain") {
      try {
        const fees = quoteFluentChainFees(await params.readGasPrice());
        if (attempt) attempt.settledFeeSource = "chain";
        debugLog("[fluent user operation fees] chain quote", {
          maxFeePerGas: fees.maxFeePerGas.toString(),
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        });
        return fees;
      } catch (err) {
        // This send only. The chain is the faster quote and the transport has already retried
        // it; paying the bundler's latency once is better than failing an operation over a
        // fee, and better than a page session that never asks the chain again.
        debugWarn("[fluent user operation fees] chain gas price unavailable, asking the bundler", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const fees = await readFluentBundlerFees(bundlerClient);
    if (attempt) attempt.settledFeeSource = "bundler";
    return fees;
  };
}

/**
 * The sentences ZeroDev's bundler answers with when a user operation's fee is below what it
 * accepts, one per fee field (alto's `validateUserOpGasPrice`, followed by the amount in wei).
 *
 * A send retries these with the bundler's quote; any other rejection, such as a policy denial
 * or a reverted estimate, belongs to the operation or the paymaster and reaches its caller.
 */
export const FLUENT_FEE_REJECTION_MESSAGES = [
  "maxFeePerGas must be at least",
  "maxPriorityFeePerGas must be at least",
] as const;

/**
 * Reports whether `err` carries one of the fee rejections above, anywhere in its error chain.
 *
 * viem wraps a bundler's answer twice: the RPC error's text sits in `details`, and
 * `getUserOperationError` puts a `UserOperationExecutionError` around it. Matched
 * case-insensitively; a bundler that words it differently is a fee error the send does not
 * retry, which costs a retry and not an operation.
 */
export function isFluentFeeRejection(err: unknown): boolean {
  const needles = FLUENT_FEE_REJECTION_MESSAGES.map((message) => message.toLowerCase());
  for (const text of errorTexts(err)) {
    const lowered = text.toLowerCase();
    if (needles.some((needle) => lowered.includes(needle))) return true;
  }
  return false;
}

/** Returns every sentence an error chain carries, viem's `details` and `shortMessage` included. */
function errorTexts(err: unknown): string[] {
  const texts: string[] = [];
  let current: unknown = err;
  // Bounded: a `cause` cycle is a hang nobody would ever debug from a fee retry.
  for (let depth = 0; depth < 10 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof BaseError) {
      texts.push(current.shortMessage, current.details, ...(current.metaMessages ?? []));
    }
    if (current instanceof Error) {
      texts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "string") texts.push(current);
    break;
  }
  return texts.filter((text): text is string => typeof text === "string" && text.length > 0);
}
