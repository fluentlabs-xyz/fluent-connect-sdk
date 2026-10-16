import {
  decodeEventLog,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type Log,
  type Transport,
  zeroAddress,
} from "viem";
import { getBlockNumber, getLogs, getTransactionReceipt } from "viem/actions";
import {
  WaitForUserOperationReceiptTimeoutError,
  type UserOperationReceipt,
} from "viem/account-abstraction";

import { debugLog, debugWarn } from "./debugLogger";

/**
 * Where the widget learns that a user operation was included.
 *
 * `chain` reads the EntryPoint's own `UserOperationEvent` with `eth_getLogs` on the widget
 * chain's RPC transport; `bundler` polls ZeroDev's `eth_getUserOperationReceipt`, which is what
 * `waitForUserOperationReceipt` does and what the widget did before FLU-1591. A poll costs about
 * 70 ms on the chain against about 345 ms through the bundler.
 */
export type FluentReceiptSource = "chain" | "bundler";

/** How long after the broadcast a receipt is waited for, whichever source answers. */
export const FLUENT_INCLUSION_TIMEOUT_MS = 120_000;

/** How often either source is asked. ZeroDev's own fast-chain default is the same 200 ms. */
export const FLUENT_INCLUSION_POLL_INTERVAL_MS = 200;

/**
 * The EntryPoint's record of a settled operation. Same signature in EntryPoint 0.6 and 0.7.
 *
 * Written out rather than parsed from a signature string so the fields stay inside this file's
 * line length and a consumer gets the decoded argument types.
 */
export const FLUENT_USER_OPERATION_EVENT = {
  type: "event",
  name: "UserOperationEvent",
  inputs: [
    { name: "userOpHash", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "paymaster", type: "address", indexed: true },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "success", type: "bool", indexed: false },
    { name: "actualGasCost", type: "uint256", indexed: false },
    { name: "actualGasUsed", type: "uint256", indexed: false },
  ],
} as const satisfies AbiEvent;

/** The EntryPoint's record of a reverted call inside an operation that was still paid for. */
export const FLUENT_USER_OPERATION_REVERT_REASON_EVENT = {
  type: "event",
  name: "UserOperationRevertReason",
  inputs: [
    { name: "userOpHash", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "revertReason", type: "bytes", indexed: false },
  ],
} as const satisfies AbiEvent;

/**
 * The EntryPoint's mark between a bundle's validation phase and its execution phase, emitted
 * once per `handleOps`. `IEntryPoint.sol`: "Any event emitted before it is part of the
 * validation", so `AccountDeployed` and a validator's installation events sit before it and
 * belong to no operation's execution. Same signature in EntryPoint 0.6 and 0.7.
 */
export const FLUENT_BEFORE_EXECUTION_EVENT = {
  type: "event",
  name: "BeforeExecution",
  inputs: [],
} as const satisfies AbiEvent;

const USER_OPERATION_EVENT_TOPIC = toEventSelector(FLUENT_USER_OPERATION_EVENT).toLowerCase();
const USER_OPERATION_REVERT_REASON_TOPIC = toEventSelector(
  FLUENT_USER_OPERATION_REVERT_REASON_EVENT,
).toLowerCase();
const BEFORE_EXECUTION_TOPIC = toEventSelector(FLUENT_BEFORE_EXECUTION_EVENT).toLowerCase();

/** The widget chain's read client — its own RPC transport, never the bundler's. */
type FluentChainClient = Client<Transport, Chain | undefined>;

/**
 * The block the inclusion wait starts one below, read before the operation is broadcast.
 *
 * Before, because after the broadcast there is no block number left that the operation cannot
 * already have landed in, and `fromBlock` has to name one: a filter anchored after inclusion
 * finds nothing and waits out its timeout. Reading it costs one `eth_blockNumber` ahead of the
 * send, which is why `cacheTime` is zero — viem would otherwise answer a later send from a
 * block number up to its polling interval old.
 *
 * Never throws: a chain that cannot be read costs this send its chain-side wait, not its
 * broadcast. The caller sees `undefined` and waits on the bundler.
 */
export async function readFluentInclusionAnchor(
  chainClient: FluentChainClient,
): Promise<bigint | undefined> {
  try {
    return await getBlockNumber(chainClient, { cacheTime: 0 });
  } catch (err) {
    debugWarn("[fluent inclusion] anchor block unavailable, waiting on the bundler", {
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** The bundler wait this module falls back to: the kernel client's own, unchanged. */
type FluentInclusionBundlerClient<receipt> = {
  waitForUserOperationReceipt: (params: {
    hash: Hash;
    pollingInterval?: number;
    timeout?: number;
  }) => Promise<receipt>;
};

/**
 * Wait for one user operation's receipt, from the chain when it can and from the bundler
 * otherwise.
 *
 * In `chain` mode the EntryPoint's `UserOperationEvent` is polled with `eth_getLogs` every
 * 200 ms, filtered on the EntryPoint address, the event selector and this operation's hash,
 * from one block below `anchorBlockNumber`. When it appears, the receipt is assembled from the
 * event and the including transaction's receipt in the shape viem's
 * `eth_getUserOperationReceipt` returns, so the rest of a send cannot tell the two apart.
 *
 * Each chain-side failure falls back to `waitForUserOperationReceipt` on the bundler — a
 * missing anchor, an `eth_getLogs` that failed after the transport's own retries, a transaction
 * receipt that could not be read — for the remainder of the one 120 s deadline this function
 * opens. The deadline is never restarted: the caller holds an operation the bundler has
 * accepted, and the fallback changes who answers, not how long the user waits.
 *
 * That deadline bounds the whole wait and not the gaps between its requests: an `eth_getLogs`
 * or an `eth_getTransactionReceipt` that answers slowly is inside it, and a chain that answers
 * after it has passed is too late to be read. Checking the clock only between polls would let a
 * transport that takes a second per answer carry the wait past 120 s one request at a time.
 *
 * Nothing here broadcasts, and nothing here retries a broadcast: by the time it runs, the
 * operation exists and `hash` is the caller's only name for it.
 *
 * @throws `WaitForUserOperationReceiptTimeoutError` when no receipt is found within 120 s —
 * the same error `waitForUserOperationReceipt` raises, so a caller's handling is unchanged.
 */
export async function waitForFluentUserOperationReceipt<receipt extends UserOperationReceipt>(
  params: {
    /** The kernel client the operation was submitted through. */
    bundlerClient: FluentInclusionBundlerClient<receipt>;
    /** The widget chain's read client. */
    chainClient: FluentChainClient;
    hash: Hash;
    /** The account's EntryPoint — the only address whose `UserOperationEvent` counts. */
    entryPoint: Address;
    /** From `readFluentInclusionAnchor`. Absent means the chain could not be anchored. */
    anchorBlockNumber: bigint | undefined;
    receiptSource: FluentReceiptSource;
    /** Called with the source that produced the receipt, for this send's diagnostics. */
    onReceiptSource?: (source: FluentReceiptSource) => void;
    /** `Date.now`, replaced only by tests that control time. */
    now?: () => number;
  },
): Promise<receipt> {
  const { bundlerClient, chainClient, hash, entryPoint, anchorBlockNumber, receiptSource } = params;
  const now = params.now ?? (() => Date.now());
  const deadlineAt = now() + FLUENT_INCLUSION_TIMEOUT_MS;
  const reportSource = (source: FluentReceiptSource) => {
    try {
      params.onReceiptSource?.(source);
    } catch {
      // The source is diagnostics. It never costs the send the receipt it is about to hold,
      // nor the wait the error it is about to raise.
    }
  };
  /**
   * `timeout` is the whole 120 s when the bundler is where this wait starts — the host asked
   * for it, or the chain was never anchored — and what is left of them when the chain was
   * polled first and failed. A fresh 120 s on a mid-flight fallback would let one send wait
   * four minutes for an operation the chain already refused to show.
   */
  const waitOnBundler = (timeout = FLUENT_INCLUSION_TIMEOUT_MS) => {
    reportSource("bundler");
    return bundlerClient.waitForUserOperationReceipt({
      hash,
      pollingInterval: FLUENT_INCLUSION_POLL_INTERVAL_MS,
      timeout,
    });
  };
  const remainingMs = () => Math.max(1, deadlineAt - now());
  if (receiptSource === "bundler") return waitOnBundler();
  if (anchorBlockNumber === undefined) return waitOnBundler();
  // One below the anchor, because the anchor was read before the broadcast and the operation
  // may still land in that same block: the block the filter starts at has to be one the
  // operation provably precedes.
  const fromBlock = anchorBlockNumber > 0n ? anchorBlockNumber - 1n : 0n;
  const pollChain = async (): Promise<receipt> => {
    for (;;) {
      if (now() >= deadlineAt) throw new WaitForUserOperationReceiptTimeoutError({ hash });
      let events: Awaited<ReturnType<typeof readUserOperationEvents>>;
      try {
        events = await readUserOperationEvents({ chainClient, entryPoint, hash, fromBlock });
      } catch (err) {
        debugWarn("[fluent inclusion] chain logs unavailable, waiting on the bundler", {
          userOpHash: hash,
          message: err instanceof Error ? err.message : String(err),
        });
        return waitOnBundler(remainingMs());
      }
      const event = events[0];
      if (event) {
        try {
          const receipt = await buildChainReceipt<receipt>({
            chainClient,
            entryPoint,
            hash,
            event,
          });
          reportSource("chain");
          debugLog("[fluent inclusion] receipt built from the chain", {
            userOpHash: hash,
            transactionHash: receipt.receipt.transactionHash,
          });
          return receipt;
        } catch (err) {
          debugWarn("[fluent inclusion] transaction receipt unavailable, waiting on the bundler", {
            userOpHash: hash,
            message: err instanceof Error ? err.message : String(err),
          });
          return waitOnBundler(remainingMs());
        }
      }
      await delay(FLUENT_INCLUSION_POLL_INTERVAL_MS);
    }
  };
  // The deadline over the whole chain-side wait, the bundler continuation it may hand over to
  // included. `pollChain` checks the clock between polls as well, which is what ends the loop
  // tidily; this is what ends it when the clock passes while a request is in flight.
  return untilDeadline(pollChain(), remainingMs(), hash);
}

/**
 * `work`, or viem's timeout error once `msLeft` has passed — whichever comes first.
 *
 * The loser is abandoned, not cancelled: a JSON-RPC request cannot be recalled, and its answer
 * after the deadline is of no use to a caller that has already been told the wait timed out.
 * `Promise.race` subscribes to both, so a late rejection from `work` is handled and no
 * `unhandledrejection` reaches the host.
 */
function untilDeadline<value>(
  work: Promise<value>,
  msLeft: number,
  hash: Hash,
): Promise<value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new WaitForUserOperationReceiptTimeoutError({ hash }));
    }, msLeft);
  });
  return Promise.race([work, expiry]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * What the chain holds for this operation: no `UserOperationEvent` until it is included, then
 * the one the EntryPoint emitted for it.
 */
async function readUserOperationEvents(params: {
  chainClient: FluentChainClient;
  entryPoint: Address;
  hash: Hash;
  fromBlock: bigint;
}) {
  return getLogs(params.chainClient, {
    address: params.entryPoint,
    event: FLUENT_USER_OPERATION_EVENT,
    args: { userOpHash: params.hash },
    fromBlock: params.fromBlock,
    // A log whose data does not decode against this event is not this event: better dropped
    // than turned into a receipt with absent fields.
    strict: true,
  });
}

type FluentUserOperationEvent = Awaited<ReturnType<typeof readUserOperationEvents>>[number];

/**
 * The receipt the rest of a send reads, assembled from the event and its transaction.
 *
 * Every field is the EntryPoint's or the transaction's own, and the transaction receipt comes
 * from the same `eth_getTransactionReceipt` formatter viem applies to a bundler's answer, so a
 * caller comparing the two sees the same values.
 */
async function buildChainReceipt<receipt extends UserOperationReceipt>(params: {
  chainClient: FluentChainClient;
  entryPoint: Address;
  hash: Hash;
  event: FluentUserOperationEvent;
}): Promise<receipt> {
  const { chainClient, entryPoint, hash, event } = params;
  const transactionReceipt = await getTransactionReceipt(chainClient, {
    hash: event.transactionHash,
  });
  const built: UserOperationReceipt = {
    userOpHash: hash,
    entryPoint,
    sender: event.args.sender,
    nonce: event.args.nonce,
    success: event.args.success,
    // The zero address is the EntryPoint's spelling of "no paymaster", and a bundler's receipt
    // leaves the field out for it (alto `parseUserOpReceipt`); so does this one, so a reader
    // of either source sees the same absence when the account paid for itself.
    paymaster: event.args.paymaster === zeroAddress ? undefined : event.args.paymaster,
    actualGasCost: event.args.actualGasCost,
    actualGasUsed: event.args.actualGasUsed,
    logs: sliceOperationLogs(transactionReceipt.logs, event.logIndex),
    reason: readRevertReason(transactionReceipt.logs, hash),
    receipt: transactionReceipt,
  };
  // Every field of `UserOperationReceipt` is filled above; the caller's own receipt type
  // differs from it only in the EntryPoint-version parameter, which neither source puts in the
  // data — there is no field here that the version would change.
  return built as unknown as receipt;
}

/**
 * The logs of one operation's execution inside a bundle, sliced as a bundler's
 * `eth_getUserOperationReceipt` slices them: after the later of `BeforeExecution` and the
 * previous operation's `UserOperationEvent`, and before this operation's own event, neither
 * boundary included.
 *
 * That is `logs.slice(startIndex + 1, userOpEventIndex)` in alto's `parseUserOpReceipt` and in
 * the reference bundler's `_filterLogs`, and it is what EIP-7769 calls "the logs generated by
 * this particular UserOperation": what precedes `BeforeExecution` is the bundle's validation
 * phase, a bundle holds one `UserOperationEvent` per operation in execution order, so the
 * previous one is where the previous operation ended, and the operation's own event is the
 * receipt's other fields rather than a log of its call. Checked against ZeroDev's receipt for a
 * live testnet operation: a transaction logging `[BeforeExecution, Transfer,
 * UserOperationEvent]` answers `[Transfer]`.
 *
 * An event this transaction's receipt does not carry — a log index the receipt lacks, which a
 * node whose logs and receipts disagree could produce — has no boundary to slice from and
 * leaves the whole transaction's logs, which still shows a reader what the transaction did.
 */
function sliceOperationLogs(
  logs: readonly Log<bigint, number, false>[],
  logIndex: number | null,
): Log<bigint, number, false>[] {
  const at = logs.findIndex((log) => log.logIndex === logIndex);
  if (at < 0) return [...logs];
  let from = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    const topic = logs[index]?.topics[0]?.toLowerCase();
    if (topic === USER_OPERATION_EVENT_TOPIC || topic === BEFORE_EXECUTION_TOPIC) {
      from = index + 1;
      break;
    }
  }
  return logs.slice(from, at);
}

/**
 * The `revertReason` of this operation's `UserOperationRevertReason` log, as the EntryPoint
 * encoded it, or nothing when the transaction holds no such log for this operation.
 *
 * The bytes are not decoded further: what a reverting call returns is the call's own ABI
 * encoding, which this module cannot read without that call's contract.
 */
function readRevertReason(
  logs: readonly Log<bigint, number, false>[],
  hash: Hash,
): Hex | undefined {
  const target = hash.toLowerCase();
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== USER_OPERATION_REVERT_REASON_TOPIC) continue;
    if (log.topics[1]?.toLowerCase() !== target) continue;
    const decoded = decodeEventLog({
      abi: [FLUENT_USER_OPERATION_REVERT_REASON_EVENT],
      data: log.data,
      topics: log.topics,
    });
    return decoded.args.revertReason;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
