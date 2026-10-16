import { BaseError } from "viem";
import { getUserOperationGasPrice } from "@zerodev/sdk/actions";

import { debugLog, debugWarn } from "./debugLogger";

/**
 * Where one submission's `maxFeePerGas` and `maxPriorityFeePerGas` come from.
 *
 * `chain` is the widget chain's own `eth_gasPrice`, read through the widget's RPC transport;
 * `bundler` is ZeroDev's `zd_getUserOperationGasPrice`, which is what `@zerodev/sdk` installs
 * when a kernel client is built without a fee hook. The chain answers in about 70 ms against
 * about 590 ms for the bundler, which is the whole reason this module exists (FLU-1591).
 */
export type FluentFeeSource = "chain" | "bundler";

/** The two fee fields of a user operation, in wei. */
export type FluentUserOperationFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/**
 * What a chain quote adds to `eth_gasPrice` for `maxFeePerGas`, in percent.
 *
 * A fee cap equal to the price itself is rejected by a bundler the moment the next block's base
 * fee ticks up, and EIP-4337 charges `min(maxFeePerGas, baseFee + maxPriorityFeePerGas)`, so the
 * margin bounds what the operation can cost: at most 10 % more than `eth_gasPrice` is payable.
 * How much of it is charged is not decided here, and the margin is not conditional on the base
 * fee rising — the priority fee below is the whole gas price, so `baseFee +
 * maxPriorityFeePerGas` already exceeds the cap once the base fee reaches a tenth of
 * `eth_gasPrice`, and the full 10 % is then paid with no change in the base fee at all. What it
 * comes to is read off `actualGasCost` in the live run (FLU-1591, Open points). One constant for
 * both networks — a margin per network is not built (FLU-1591 Boundary).
 */
export const FLUENT_CHAIN_FEE_MARGIN_PERCENT = 110n;

/**
 * The chain quote for one operation: `eth_gasPrice` as the priority fee, and the same number
 * with the margin above as the cap, rounded down.
 */
export function quoteFluentChainFees(gasPrice: bigint): FluentUserOperationFees {
  return {
    maxPriorityFeePerGas: gasPrice,
    maxFeePerGas: (gasPrice * FLUENT_CHAIN_FEE_MARGIN_PERCENT) / 100n,
  };
}

/**
 * One submission attempt's fee decision, and what it settled on.
 *
 * It travels on the account object of that one submission rather than on the kernel client,
 * because a kernel client is built once and lives as long as the account: two sends through it,
 * or a send and its retry, must not be able to read each other's decision. `feeSource` is what
 * the attempt asks for, `settledFeeSource` what actually answered — the two differ when the
 * chain's RPC refused and the bundler stood in for that attempt.
 */
export type FluentFeeAttempt = {
  /** What this attempt asks for. Fixed when the attempt starts, so a send stays consistent. */
  readonly feeSource: FluentFeeSource;
  /** Written by the fee hook once a quote is in hand. Absent until then. */
  settledFeeSource?: FluentFeeSource;
};

/**
 * The key the attempt travels under. A symbol, so it cannot collide with a field viem or
 * `@zerodev/sdk` reads off an account, and it survives the object spreads both of them do.
 */
const FLUENT_FEE_ATTEMPT = Symbol.for("fluent.userOperation.feeAttempt");

/**
 * The account of one submission, carrying that submission's fee decision.
 *
 * viem hands `prepareUserOperation`'s fee hook the very account object the caller passed
 * (`parseAccount` returns a non-string account unchanged, `viem@2.52.0`
 * `_esm/account-abstraction/actions/bundler/prepareUserOperation.js:53`), which is what makes
 * the account the one channel from a submission to its own fee quote.
 */
export function withFluentFeeAttempt<account extends object>(
  account: account,
  attempt: FluentFeeAttempt,
): account {
  return { ...account, [FLUENT_FEE_ATTEMPT]: attempt };
}

/** The fee decision `withFluentFeeAttempt` put on this account, or nothing. */
export function readFluentFeeAttempt(account: unknown): FluentFeeAttempt | undefined {
  if (typeof account !== "object" || account === null) return undefined;
  const attempt = (account as Record<symbol, unknown>)[FLUENT_FEE_ATTEMPT];
  return typeof attempt === "object" && attempt !== null
    ? (attempt as FluentFeeAttempt)
    : undefined;
}

/** ZeroDev's own quote: `zd_getUserOperationGasPrice`, its `standard` tier, unchanged. */
export async function readFluentBundlerFees(
  bundlerClient: unknown,
): Promise<FluentUserOperationFees> {
  // Safe: the client arrives from viem's fee hook, whose own type does not carry ZeroDev's RPC
  // schema, and this action makes exactly one `zd_getUserOperationGasPrice` request on it.
  return getUserOperationGasPrice(
    bundlerClient as Parameters<typeof getUserOperationGasPrice>[0],
  );
}

/** What viem passes a `userOperation.estimateFeesPerGas` hook, narrowed to what this one reads. */
type FluentFeeHookParameters = {
  account?: unknown;
  bundlerClient: unknown;
};

/**
 * The `userOperation.estimateFeesPerGas` hook every kernel client the widget builds carries.
 *
 * Installing it is what keeps viem from falling through to the default `@zerodev/sdk` adds
 * (`_esm/clients/kernelAccountClient.js:38-43`), which is one `zd_getUserOperationGasPrice`
 * round trip on every send.
 *
 * Which source answers is decided per submission: the attempt on the account wins, so a send
 * and its fee retry can disagree, and `readFeeSource` is the live widget configuration for a
 * path that carries no attempt — a kernel client outlives the configuration it was built with,
 * and a host that changes `execution.feeSource` must be obeyed by the next send rather than
 * after a remount.
 *
 * A chain quote that fails after the RPC transport's own retries falls back to the bundler for
 * that submission alone: nothing is latched, so the next send asks the chain first again
 * (FLU-1591, Q3).
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
 * The bundler's fee rejections, by the words it says them in.
 *
 * ZeroDev's bundler answers a user operation whose fees are below what it will accept with one
 * of two sentences, one per fee field — alto's `validateUserOpGasPrice` has
 * `maxFeePerGas must be at least <wei>` and `maxPriorityFeePerGas must be at least <wei>` —
 * and those two answers are the only failure this send retries: every other rejection — a
 * policy denial, a reverted estimate, a rejected bearer — is the operation's or the paymaster's
 * and must reach the caller it belongs to. The second cannot fire while the chain's
 * `eth_gasPrice` is at least its `eth_maxPriorityFeePerGas`, which holds on Fluent today, but
 * a floor or a bump on the bundler's side would make it fire, and the retry that exists for
 * exactly this case has to run then too.
 */
export const FLUENT_FEE_REJECTION_MESSAGES = [
  "maxFeePerGas must be at least",
  "maxPriorityFeePerGas must be at least",
] as const;

/**
 * Whether this error is one of the fee rejections above.
 *
 * Read across the whole error chain, because viem wraps a bundler's answer twice — the RPC
 * error's text sits in `details`, and `getUserOperationError` puts a
 * `UserOperationExecutionError` around it — so the words are never on the outermost `message`
 * alone. Matched case-insensitively on the bundler's own sentences; a bundler that words it
 * differently is a fee error this send does not retry, which costs a retry and never a receipt.
 */
export function isFluentFeeRejection(err: unknown): boolean {
  const needles = FLUENT_FEE_REJECTION_MESSAGES.map((message) => message.toLowerCase());
  for (const text of errorTexts(err)) {
    const lowered = text.toLowerCase();
    if (needles.some((needle) => lowered.includes(needle))) return true;
  }
  return false;
}

/** Every sentence an error chain carries: viem's `details` and `shortMessage` included. */
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
