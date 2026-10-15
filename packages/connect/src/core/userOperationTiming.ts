import type { Hash } from "viem";
import type { FluentExecuteTiming } from "../widget/batchOperation";
import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import { debugLog, debugWarn } from "./debugLogger";
import { withUserOperationGas, type FluentUserOperationGas, type FluentUserOperationCallArgs } from "./userOperationGas";

/**
 * `performance.now()`, or nothing when the clock cannot be read.
 *
 * Measuring is subordinate to sending. A host whose `performance` is a shim, or whose clocks a
 * test framework replaced, must still get back the hash of an operation the bundler has already
 * accepted — so every clock read in the timing path goes through these two functions, and an
 * unreadable clock costs the stages that needed it and nothing else.
 */
export function monotonicNow(): number | undefined {
  return readClock(() => performance.now());
}

/** `Date.now()` — the clock `block.timestamp` is compared to. See `monotonicNow`. */
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
 * A duration between two instants of one clock, or nothing when either of them is missing.
 *
 * Exported because the widget's own timing diagnostics read the same guarded clocks and must
 * reach the same conclusion from a missing instant: an absent duration, not an arithmetic on
 * `undefined` and not a throw inside a `finally` that a settled operation would pay for.
 */
export function span(from: number | undefined, to: number | undefined): number | undefined {
  return from === undefined || to === undefined ? undefined : to - from;
}

/**
 * The debug writers, wrapped so that a diagnostic cannot cost a send either: the console belongs
 * to the host, and a patched one that throws would otherwise reject an operation the bundler
 * accepted, or replace the error the caller has to classify.
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
 * One submission attempt's own stages, measured at the SDK's signing boundary.
 *
 * The boundary is the observed account below, and it is the only one in the path: a
 * `signUserOperation` call means preparation is over, and its return means signing is. Nothing
 * downstream re-derives these three numbers, because nothing downstream can see that moment.
 */
export type FluentSubmissionMeasurement = {
  /** `performance.now()` when this attempt began. */
  startedAt: number;
  /** `Date.now()` at `startedAt` — the wall-clock instant the chain's clock is compared to. */
  startedAtEpochMs: number;
  /**
   * Up to the moment the account was asked for a signature — or the whole attempt, when it
   * failed before asking for one. Absent when the clock could not be read at that boundary:
   * an unmeasured preparation is reported as unmeasured, never widened to the attempt's span.
   */
  prepareMs?: number;
  /**
   * Producing the signature. Absent when the attempt failed before asking for one, and absent
   * when either end of the signature was taken at an instant the clock refused to name.
   */
  signMs?: number;
  /** Handing the signed operation to the bundler. Absent when signing never finished. */
  broadcastMs?: number;
  /** `performance.now()` when the attempt returned. */
  finishedAt: number;
  /** `Date.now()` at `finishedAt` — for a successful attempt, when the bundler accepted it. */
  finishedAtEpochMs: number;
};

/**
 * One submission attempt and how it spent its milliseconds.
 *
 * `userOpHash` is absent when the attempt failed: a paymaster that refused the bearer left no
 * operation to name. A failed attempt is still an attempt, and its milliseconds are still part of
 * what the user waited for — which is why it is recorded rather than discarded.
 */
export type FluentUserOperationAttempt = {
  userOpHash?: Hash;
  /**
   * How this attempt spent its milliseconds. Absent when a clock could not be read: measuring a
   * send may cost the stages, never the operation itself — see `monotonicNow`.
   */
  measurement?: FluentSubmissionMeasurement;
};

/** An attempt that produced an operation, whether or not its stages could be measured. */
export type FluentUserOperationSubmission = FluentUserOperationAttempt & { userOpHash: Hash };

/**
 * Submit one user operation and measure it, always.
 *
 * The stages are collected whatever `debugLogging` is set to; the flag decides only whether they
 * are *also* printed. This function used to begin with
 * `if (!isDebugLoggingEnabled()) return client.sendUserOperation(args)` — `core/userOperationTiming.ts:13`
 * as of `9ff61bd`, the line this change deletes — which meant a host could not learn where its
 * four seconds went without turning on a console flag it would never ship, and the numbers, once
 * logged, were dropped. They are returned now.
 *
 * `devel` carried that early return forward past the gas work, as
 * `return client.sendUserOperation(preparedArgs)` at `core/userOperationTiming.ts:12` of
 * `64d3cf8`, so the merge deletes it a second time rather than inheriting it. The gas policy it
 * guarded is kept: `withUserOperationGas` now runs unconditionally below, which is where it
 * always belonged — an explicit call gas limit is not a diagnostic and never depended on a
 * logging flag.
 *
 * Observes the SDK's signing boundary without repeating preparation and without logging payloads.
 *
 * `record` is called exactly once, for a failed attempt as well as a settled one, so a caller that
 * may submit twice can account for what the first attempt cost. It is called before this function
 * returns or rethrows, and a throw from it is swallowed: measuring a send must not be able to fail
 * one, and in the failure path it would replace the error the caller needs.
 *
 * Nothing in here can fail a send. The hash is held before any measurement is taken, the clocks
 * are read through `monotonicNow`/`epochNow` and the diagnostics through `timingLog`, so an
 * unreadable clock yields a submission whose `measurement` is absent, and a submission that
 * failed rethrows its own error rather than the measurement's.
 */
export async function sendUserOperationWithTiming(
  client: FluentZeroDevKernel["client"],
  args: FluentUserOperationCallArgs,
  gas?: FluentUserOperationGas,
  record?: (attempt: FluentUserOperationAttempt) => void,
): Promise<FluentUserOperationSubmission> {
  // The gas policy is resolved first, so that the account the signing boundary below observes is
  // the one `withUserOperationGas` has already wrapped. Spreading it keeps that `userOperation`
  // hook intact: explicit call gas and per-stage timing are two observers of one submission, and
  // neither may displace the other.
  const preparedArgs = withUserOperationGas(client, args, gas);
  const startedAt = monotonicNow();
  const startedAtEpochMs = epochNow();
  let signingAt: number | undefined;
  let signedAt: number | undefined;
  /**
   * Whether each boundary was *reached*, which is a different question from whether its clock
   * could be read — and keeping the two apart is the difference between an absent stage and an
   * invented one. An attempt that fails during preparation never asks for a signature, and its
   * whole span is preparation. An attempt that did ask, at an instant the clock refused to name,
   * has a preparation nobody can measure: standing `finishedAt` in for that boundary would
   * report preparation, signing and broadcast as one long preparation, and the demo would render
   * it as a measurement.
   */
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
  /** The one closing, memoised: the returned numbers and the logged ones are the same ones. */
  let closed: { measurement?: FluentSubmissionMeasurement } | undefined;
  /**
   * Close the attempt at its first exit, or say nothing. This runs when the bundler may already
   * hold the operation, so it answers `undefined` for a clock it could not read instead of
   * throwing: a stage is forfeit, a hash never is.
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
    settledUserOpHash = await client.sendUserOperation({ ...preparedArgs, account: observedAccount });
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
      preparationMs: measurement?.prepareMs,
      signingMs: measurement?.signMs,
      broadcastMs: measurement?.broadcastMs,
      // Not `totalMs`: this is one submission, and the send's total runs on to the receipt.
      // Two different numbers under one name is the confusion this Issue exists to end.
      submissionMs: span(measurement?.startedAt, measurement?.finishedAt),
    });
  }
}

/**
 * Close the timeline of one send: the receipt is already in hand, and the stages are assembled
 * from the attempt that settled.
 *
 * `attempts` is every submission this send made, in order — a sponsored send can submit more than
 * once, and the settled operation is found by its hash rather than assumed to be the last. What
 * the rejected attempts cost is reported as `retryMs` and is never folded into the settled
 * attempt's own stages.
 *
 * `getBlock` runs *after* `receivedAt` was taken, so reading the including block cannot inflate
 * any stage. A block read that fails costs `inclusionMs` and `detectMs` and leaves the rest of the
 * timeline intact; nothing here throws, so a timing failure can never fail a send.
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
  // No measured attempt for the hash being returned: report nothing rather than attribute one
  // operation's milliseconds to another. An attempt whose clock could not be read is no more
  // usable than a missing one — every number below would be a guess dressed as a measurement.
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
      blockTimestampEpochMs === undefined
        ? undefined
        : receivedAtEpochMs - blockTimestampEpochMs,
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
 * The including block's `timestamp` in milliseconds, or nothing.
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
