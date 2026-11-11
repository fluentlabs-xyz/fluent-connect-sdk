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
 * Returns the paymaster the EntryPoint charged for a settled operation: the zero address when
 * the account paid for itself, undefined only when no event can be read.
 *
 * The SDK's `paymaster` is used when set, but it is undefined for every self-paid operation: a
 * bundler's receipt omits the zero address, and the receipt's `logs` end before the event. So
 * the transaction receipt's logs are searched for the `UserOperationEvent` with this operation's
 * `userOpHash`, skipping the other operations of the bundle.
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
