import {
  decodeEventLog,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";

/**
 * The EntryPoint's `UserOperationEvent`, written out so the decoded `paymaster` keeps its
 * address type. The SDK holds the same definition but does not export it, and this demo does
 * not reach into a package's `src`.
 */
const USER_OPERATION_EVENT = {
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

const USER_OPERATION_EVENT_TOPIC = toEventSelector(USER_OPERATION_EVENT);

/** The part of an execute result this reading needs; the SDK's `FluentExecuteResult` has it. */
export type SettledOperation = {
  paymaster?: Address;
  receipt?: TransactionReceipt;
  userOpHash?: Hash;
};

/**
 * Who the EntryPoint charged for a settled operation, read off the operation itself.
 *
 * The SDK's `paymaster` is taken when it is set. It is `undefined` for every self-paid
 * operation, though: a bundler's receipt leaves the field out for the zero address and the SDK's
 * own receipt spells it the same way, and the SDK's fallback over the receipt's `logs` cannot
 * find the event because those logs are sliced to end before it. A badge that read that
 * `undefined` as "could not be read" reported a self-paid fallback as a measurement failure.
 *
 * So the transaction receipt is read next: the full one, with every log of the bundle. The
 * `UserOperationEvent` whose `userOpHash` is this operation's names the paymaster, and names
 * the zero address when the account paid for itself; that address is kept as it is, because the
 * zero address is the fact the badge exists to show. An event of another operation in the same
 * bundle is skipped by its hash. Undefined only when there is no such event to read.
 */
export function settledPaymaster(operation: SettledOperation): Address | undefined {
  if (operation.paymaster) return operation.paymaster;
  const { receipt, userOpHash } = operation;
  if (!receipt || !userOpHash) return undefined;
  const wanted = userOpHash.toLowerCase();
  for (const log of receipt.logs) {
    if (log.topics[0] !== USER_OPERATION_EVENT_TOPIC) continue;
    if (log.topics[1]?.toLowerCase() !== wanted) continue;
    const { args } = decodeEventLog({
      abi: [USER_OPERATION_EVENT],
      topics: log.topics,
      data: log.data,
    });
    return args.paymaster;
  }
  return undefined;
}
