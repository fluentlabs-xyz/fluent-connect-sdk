import { describe, expect, it } from "vitest";
import {
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";

/** A receipt's log: one of a mined transaction, so its block fields are never null. */
type MinedLog = Log<bigint, number, false>;

import { classifyPayer } from "../components/PayerBadge";
import { settledPaymaster } from "./settledPaymaster";

/*
 * The transaction FLU-1609 was found on: block 40437264 of Fluent testnet, a sponsorship the
 * service refused and the account then paid for itself. Its `UserOperationEvent` is log 3, and
 * `topics[3]`, the paymaster, is all zero. Read from `https://rpc.testnet.fluent.xyz/` on
 * 2026-10-19 and transcribed, not shortened.
 */
const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032" as Address;
const USER_OPERATION_EVENT_TOPIC: Hex =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";
const TX_HASH: Hash = "0x69d463b1669e47471adaa8a0763642765529c21a289c440c73c20bf426f80795";
const BLOCK_HASH: Hash = "0x8f8429d65db671befa0ac6dd1b7c5237d6bed99615d07b5b09a5e44ebbe378d8";
const USER_OP_HASH: Hash = "0xd133d06033b46686e3f2043ae7eb5f09c6ed5f966f93d98cbff8451be7166cbc";
const SENDER_TOPIC: Hex = "0x0000000000000000000000009c9db8029a9c5b13b9e50458a3c556a2fa7bc3d0";
const ZERO_TOPIC: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
const USER_OPERATION_EVENT_DATA = (
  "0x0000845adb2c711129d4f3966735ed98a9f09fc4ce570000000000000000012d" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "00000000000000000000000000000000000000000000000000000025e0618558" +
  "0000000000000000000000000000000000000000000000000000000000027b74"
) as Hex;

const ERC20_PAYMASTER = "0x1111111111111111111111111111111111111111" as Address;

function log(
  index: number,
  address: Address,
  topics: Hex[],
  data: Hex,
): MinedLog {
  return {
    address,
    topics: topics as MinedLog["topics"],
    data,
    blockHash: BLOCK_HASH,
    blockNumber: 40437264n,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex: index,
    removed: false,
  };
}

function userOperationEventLog(index: number, userOpHash: Hash, paymasterTopic: Hex) {
  return log(
    index,
    ENTRY_POINT,
    [USER_OPERATION_EVENT_TOPIC, userOpHash, SENDER_TOPIC, paymasterTopic],
    USER_OPERATION_EVENT_DATA,
  );
}

function receiptWith(logs: MinedLog[]): TransactionReceipt {
  return {
    blockHash: BLOCK_HASH,
    blockNumber: 40437264n,
    contractAddress: null,
    cumulativeGasUsed: 135050n,
    effectiveGasPrice: 1n,
    from: "0x21196f1daba498d64eb31423d392ef3cce546ad7",
    gasUsed: 135050n,
    logs,
    logsBloom: "0x",
    status: "success",
    to: ENTRY_POINT,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: "eip1559",
  };
}

/** The four logs of the Issue's transaction, in order; only the last one is the event. */
const issueReceipt = receiptWith([
  log(
    0,
    ENTRY_POINT,
    ["0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4", SENDER_TOPIC],
    "0x0000000000000000000000000000000000000000000000000000002fed2555c8",
  ),
  log(1, ENTRY_POINT, ["0xbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972"], "0x"),
  log(
    2,
    "0x83fed707a8dddc2535ae591cf19fb6c91d542d8e",
    [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      SENDER_TOPIC,
      SENDER_TOPIC,
    ],
    ZERO_TOPIC,
  ),
  userOperationEventLog(3, USER_OP_HASH, ZERO_TOPIC),
]);

describe("settledPaymaster", () => {
  it("reads the zero address off the Issue's self-paid operation when the SDK gives none", () => {
    const paymaster = settledPaymaster({
      paymaster: undefined,
      receipt: issueReceipt,
      userOpHash: USER_OP_HASH,
    });
    expect(paymaster).toBe(zeroAddress);
    expect(classifyPayer(paymaster, ERC20_PAYMASTER)).toBe("user-eth");
  });

  it("takes the SDK's own paymaster when it is set", () => {
    const paymaster = settledPaymaster({
      paymaster: ERC20_PAYMASTER,
      receipt: issueReceipt,
      userOpHash: USER_OP_HASH,
    });
    expect(paymaster).toBe(ERC20_PAYMASTER);
  });

  it("answers undefined, which classifies as unreadable, when no event carries the hash", () => {
    const other: Hash = "0xabababababababababababababababababababababababababababababababab";
    const paymaster = settledPaymaster({ receipt: issueReceipt, userOpHash: other });
    expect(paymaster).toBeUndefined();
    expect(classifyPayer(paymaster, ERC20_PAYMASTER)).toBe("unreadable");
  });

  it("skips the event of another operation in the same bundle", () => {
    const other: Hash = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
    const otherPaymaster: Hex =
      "0x0000000000000000000000002222222222222222222222222222222222222222";
    const bundle = receiptWith([
      userOperationEventLog(1, other, otherPaymaster),
      userOperationEventLog(3, USER_OP_HASH, ZERO_TOPIC),
    ]);
    expect(settledPaymaster({ receipt: bundle, userOpHash: USER_OP_HASH })).toBe(zeroAddress);
    expect(settledPaymaster({ receipt: bundle, userOpHash: other })).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("answers undefined without a receipt or without an operation hash", () => {
    expect(settledPaymaster({})).toBeUndefined();
    expect(settledPaymaster({ receipt: issueReceipt })).toBeUndefined();
    expect(settledPaymaster({ userOpHash: USER_OP_HASH })).toBeUndefined();
  });
});
