import type { Hash } from "viem";
import type { FluentExecuteTiming } from "../widget/batchOperation";
import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import { debugLog, debugWarn } from "./debugLogger";
import { withFluentFeeAttempt, type FluentFeeAttempt } from "./userOperationFees";
import {
  withUserOperationGas,
  type FluentUserOperationGas,
  type FluentUserOperationCallArgs,
} from "./userOperationGas";

/**
 * Returns `performance.now()`, or `undefined` when the clock cannot be read.
 *
 * A host whose `performance` is a shim, or whose clocks a test framework replaced, still gets
 * back the hash of an operation the bundler accepted: the timing path reads its clocks through
 * this function and `epochNow`, so an unreadable clock costs only the stages that needed it.
 */
export function monotonicNow(): number | undefined {
  return readClock(() => performance.now());
}

/**
 * Returns `Date.now()`, the clock `block.timestamp` is compared to, or `undefined` when the clock
 * cannot be read, as `monotonicNow` does.
 */
export function epochNow(): number | undefined {
  return readClock(() => Date.now());
}

function readClock(read: () => number): number | undefined {
  try {
    const value = read();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the duration between two instants of one clock, or `undefined` when either is missing,
 * so a missing instant gives an absent duration rather than arithmetic on `undefined`.
 */
export function span(from: number | undefined, to: number | undefined): number | undefined {
  return from === undefined || to === undefined ? undefined : to - from;
}

/**
 * Wraps a debug writer so that its throw is swallowed: the console belongs to the host, and a
 * patched one that throws would otherwise reject an operation the bundler accepted, or replace
 * the error the caller has to classify.
 */
function guarded(write: (...args: unknown[]) => void): (...args: unknown[]) => void {
  return (...args) => {
    try {
      write(...args);
    } catch {
      // A diagnostic line is worth less than the send it would break.
    }
  };
}
const timingLog = guarded(debugLog);
const timingWarn = guarded(debugWarn);

/**
 * The stages of one submission attempt, measured at the SDK's signing boundary: the account's
 * `signUserOperation` call ends preparation, and its return ends signing.
 */
export type FluentSubmissionMeasurement = {
  /** `performance.now()` when this attempt began. */
  startedAt: number;
  /** `Date.now()` at `startedAt` — the wall-clock instant the chain's clock is compared to. */
  startedAtEpochMs: number;
  /**
   * Milliseconds until the account was asked for a signature, or the whole attempt when it never
   * asked. Absent when the clock could not be read as it asked.
   */
  prepareMs?: number;
  /**
   * Milliseconds producing the signature, up to the attempt's end when signing threw. Absent when
   * no signature was asked for, or when the clock could not be read at either end.
   */
  signMs?: number;
  /** Milliseconds handing the signed operation to the bundler. Absent when signing never ended. */
  broadcastMs?: number;
  /** `performance.now()` when the attempt returned. */
  finishedAt: number;
  /** `Date.now()` at `finishedAt` — for a successful attempt, when the bundler accepted it. */
  finishedAtEpochMs: number;
};

/**
 * One submission attempt and what it cost.
 *
 * `userOpHash` is absent when the attempt failed, as when the paymaster refused it. A failed
 * attempt is recorded too, because its milliseconds are part of what the user waited for.
 */
export type FluentUserOperationAttempt = {
  userOpHash?: Hash;
  /** The attempt's stages. Absent when a clock could not be read at its start or its end. */
  measurement?: FluentSubmissionMeasurement;
};

/** An attempt that produced an operation, whether or not its stages could be measured. */
export type FluentUserOperationSubmission = FluentUserOperationAttempt & { userOpHash: Hash };

/**
 * Submits one user operation and measures it, whatever `debugLogging` is set to; the flag decides
 * only whether the measurement is also printed.
 *
 * Applies the gas policy with `withUserOperationGas` first, which throws for a policy that cannot
 * be used, and then observes the signing boundary without repeating preparation or logging
 * payloads. Once the attempt has started, `record` is called exactly once, failed or settled,
 * before this returns or rethrows, so a caller that submits twice can account for the first
 * attempt; a throw from it is swallowed. `feeAttempt` rides on the account the client receives,
 * the one channel to the client's `estimateFeesPerGas` hook. An unreadable clock leaves
 * `measurement` absent, and a failed send rethrows its own error.
 */
export async function sendUserOperationWithTiming(
  client: FluentZeroDevKernel["client"],
  args: FluentUserOperationCallArgs,
  gas?: FluentUserOperationGas,
  record?: (attempt: FluentUserOperationAttempt) => void,
  feeAttempt?: FluentFeeAttempt,
): Promise<FluentUserOperationSubmission> {
  // Resolved first, so the account the signing boundary observes is the one
  // `withUserOperationGas` wrapped; spreading it keeps that `userOperation` hook intact.
  const preparedArgs = withUserOperationGas(client, args, gas);
  const startedAt = monotonicNow();
  const startedAtEpochMs = epochNow();
  let signingAt: number | undefined;
  let signedAt: number | undefined;
  // Whether each boundary was reached, apart from whether its clock could be read: a boundary
  // reached at an unreadable instant leaves its stage absent rather than measured to `finishedAt`.
  let askedToSign = false;
  let signatureReturned = false;
  let success = false;
  const account = preparedArgs.account;
  const observedAccount: typeof account = {
    ...account,
    async signUserOperation(operation) {
      askedToSign = true;
      signingAt = monotonicNow();
      timingLog("[fluent execution stage]", {
        stage: "signing",
        preparationMs: span(startedAt, signingAt),
      });
      const signature = await account.signUserOperation(operation);
      signatureReturned = true;
      signedAt = monotonicNow();
      timingLog("[fluent execution stage]", {
        stage: "broadcasting",
        signingMs: span(signingAt, signedAt),
      });
      return signature;
    },
  };
  /**
   * The account the client is sent, with this submission's fee decision on it. One object, so
   * the signing boundary above and the fee hook below observe the same submission.
   */
  const submittedAccount = feeAttempt
    ? withFluentFeeAttempt(observedAccount, feeAttempt)
    : observedAccount;
  /** The one closing, memoised: the returned numbers and the logged ones are the same ones. */
  let closed: { measurement?: FluentSubmissionMeasurement } | undefined;
  /**
   * Closes the attempt at its first exit and returns its measurement, or `undefined` for a clock
   * it could not read: it runs when the bundler may already hold the operation, so it never throws.
   */
  const close = (): FluentSubmissionMeasurement | undefined => {
    if (closed) return closed.measurement;
    const finishedAt = monotonicNow();
    const finishedAtEpochMs = epochNow();
    closed =
      startedAt === undefined ||
      startedAtEpochMs === undefined ||
      finishedAt === undefined ||
      finishedAtEpochMs === undefined
        ? {}
        : {
            measurement: {
              startedAt,
              startedAtEpochMs,
              // The attempt's whole span counts as preparation only when preparation is where
              // it ended; once a signature was asked for, preparation is measured to that
              // request or not at all.
              prepareMs: askedToSign ? span(startedAt, signingAt) : finishedAt - startedAt,
              // Signing that never returned was still running when the attempt ended, so the
              // attempt's end is its real boundary. Signing that did return, at an unreadable
              // instant, has no measurable end — and must not borrow the broadcast's.
              signMs: span(signingAt, signatureReturned ? signedAt : finishedAt),
              broadcastMs: span(signedAt, finishedAt),
              finishedAt,
              finishedAtEpochMs,
            },
          };
    return closed.measurement;
  };
  let settledUserOpHash: Hash | undefined;
  timingLog("[fluent execution stage]", { stage: "preparing" });
  try {
    // Held before anything is measured: from this assignment on, the operation exists, and no
    // part of the timing code may lose its hash.
    settledUserOpHash = await client.sendUserOperation({
      ...preparedArgs,
      account: submittedAccount,
    });
    success = true;
    return { userOpHash: settledUserOpHash, measurement: close() };
  } finally {
    const measurement = close();
    try {
      record?.(
        settledUserOpHash === undefined
          ? { measurement }
          : { userOpHash: settledUserOpHash, measurement },
      );
    } catch {
      // Recording is bookkeeping. It never costs the send, nor the error the send is rethrowing.
    }
    timingLog("[fluent submission timing]", {
      success,
      // Which source actually quoted this attempt's fees, not which one it asked: a chain
      // quote that failed is reported as the bundler's, because that is what was paid for.
      feeSource: feeAttempt?.settledFeeSource,
      preparationMs: measurement?.prepareMs,
      signingMs: measurement?.signMs,
      broadcastMs: measurement?.broadcastMs,
      // Not `totalMs`: this is one submission, and the send's total runs on to the receipt.
      submissionMs: span(measurement?.startedAt, measurement?.finishedAt),
    });
  }
}

/**
 * Returns the timing of one send whose receipt is in hand, assembled from the attempt that
 * settled, or `undefined` when the first or the settled attempt has no measurement.
 *
 * A sponsored send can submit more than once: the settled attempt is found by its hash, not
 * assumed to be the last, and what the earlier attempts cost is `retryMs`, outside the settled
 * attempt's stages. The including block is read after `receivedAt` was taken, so the read
 * inflates no stage, and a failed read leaves only `inclusionMs` and `detectMs` absent. Nothing
 * here throws, so timing cannot fail a send.
 */
export async function closeSendTiming(params: {
  /** Every submission, settled or failed, in the order they were made. */
  attempts: readonly FluentUserOperationAttempt[];
  /** The operation the caller is returning, i.e. the one whose receipt it holds. */
  settledUserOpHash: Hash;
  /** `performance.now()` the moment the receipt was in hand. */
  receivedAt: number;
  /** `Date.now()` at `receivedAt`. */
  receivedAtEpochMs: number;
  /** The block the settled operation landed in, off its receipt. */
  blockNumber?: bigint;
  /** Reads the including block. Omit it to leave inclusion and detection unsplit. */
  getBlock?: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>;
}): Promise<FluentExecuteTiming | undefined> {
  const { attempts, settledUserOpHash, receivedAt, receivedAtEpochMs } = params;
  const first = attempts[0];
  const settled = attempts.find(
    (attempt) => attempt.userOpHash !== undefined && attempt.userOpHash === settledUserOpHash,
  );
  // Report nothing rather than attribute one operation's milliseconds to another, or guess the
  // stages of an attempt whose clock could not be read.
  if (!first?.measurement || !settled?.measurement) return undefined;
  const measurement = settled.measurement;
  const firstMeasurement = first.measurement;
  const blockTimestampEpochMs = await readBlockTimestamp(params.getBlock, params.blockNumber);
  return {
    prepareMs: measurement.prepareMs,
    signMs: measurement.signMs,
    broadcastMs: measurement.broadcastMs,
    // Signed, unclamped, and across two clocks on purpose — see `FluentExecuteTiming`.
    inclusionMs:
      blockTimestampEpochMs === undefined
        ? undefined
        : blockTimestampEpochMs - measurement.finishedAtEpochMs,
    detectMs:
      blockTimestampEpochMs === undefined ? undefined : receivedAtEpochMs - blockTimestampEpochMs,
    // Everything before the settled attempt started: the rejected submissions and the fresh
    // token exchange between them. One monotonic subtraction, so it cannot go negative.
    retryMs: measurement.startedAt - firstMeasurement.startedAt,
    totalMs: receivedAt - firstMeasurement.startedAt,
    instants: {
      submittedAtEpochMs: firstMeasurement.startedAtEpochMs,
      broadcastedAtEpochMs: measurement.finishedAtEpochMs,
      receivedAtEpochMs,
      blockTimestampEpochMs,
      attempts: attempts.length,
    },
  };
}

/**
 * Reads the including block's `timestamp` in milliseconds, or returns `undefined`.
 *
 * Swallows every failure — an unreachable RPC, a pruned block, a bundler receipt without a block
 * number — because the two stages it feeds are worth less than the send it must not break. Logs
 * the block number and nothing else: no error body goes near a timing line.
 */
async function readBlockTimestamp(
  getBlock: ((args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>) | undefined,
  blockNumber: bigint | undefined,
): Promise<number | undefined> {
  if (!getBlock || blockNumber === undefined) return undefined;
  try {
    const block = await getBlock({ blockNumber });
    if (typeof block?.timestamp !== "bigint") return undefined;
    return Number(block.timestamp) * 1000;
  } catch {
    timingWarn("[fluent inclusion timing] including block unavailable", {
      blockNumber: blockNumber.toString(),
    });
    return undefined;
  }
}
