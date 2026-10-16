/**
 * Inclusion read from the chain, and the bundler behind it.
 *
 * Fakes: the two JSON-RPC transports — the widget chain's and the ZeroDev bundler's — as
 * `viem@2.52.0` `custom()` transports answering the methods the real endpoints answer, and
 * Vitest's fake timers for the 200 ms poll and the 120 s deadline. `createKernelAccountClient`
 * (`@zerodev/sdk@5.5.10`) and `waitForUserOperationReceipt` run for real, so the bundler
 * fallback is the same call the widget made before FLU-1591.
 *
 * The logs and the transaction receipt are encoded with viem from the EntryPoint's own event
 * signatures rather than written out as hex, so a fixture cannot disagree with the ABI the code
 * decodes with.
 */
import { createKernelAccountClient } from "@zerodev/sdk";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  numberToHex,
  stringToHex,
  zeroAddress,
  type Hash,
  type Hex,
} from "viem";
import {
  WaitForUserOperationReceiptTimeoutError,
  type SmartAccount,
} from "viem/account-abstraction";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FLUENT_BEFORE_EXECUTION_EVENT,
  FLUENT_USER_OPERATION_EVENT,
  FLUENT_USER_OPERATION_REVERT_REASON_EVENT,
  readFluentInclusionAnchor,
  waitForFluentUserOperationReceipt,
  type FluentReceiptSource,
} from "./userOperationReceipt";

const ENTRY_POINT = getAddress("0x0000000071727de22e5e9d8baf0edac6f37da032");
const SENDER = getAddress("0x1111111111111111111111111111111111111111");
const PAYMASTER = getAddress("0x991e4158e338283d7efbc37eb49491a21434d964");
const OTHER_SENDER = getAddress("0x2222222222222222222222222222222222222222");
const TOKEN = getAddress("0x3333333333333333333333333333333333333333");
const USER_OP_HASH = `0x${"aa".repeat(32)}` as Hash;
const OTHER_USER_OP_HASH = `0x${"bb".repeat(32)}` as Hash;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as Hash;
const ANCHOR_BLOCK = 500n;
const INCLUDED_BLOCK = 502n;
const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.fluent.test"] } },
} as const;

type RpcCall = { method: string; params?: unknown };
type RpcLog = {
  address: Hex;
  /** `null` where an indexed parameter is left open, which is how viem spells it. */
  topics: (Hex | Hex[] | null)[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: Hex;
  logIndex: Hex;
  removed: boolean;
};

/** One `UserOperationEvent`, encoded the way the EntryPoint emits it. */
function userOperationEventLog(params: {
  userOpHash: Hash;
  sender: Hex;
  paymaster: Hex;
  nonce: bigint;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
  logIndex: number;
}): RpcLog {
  return {
    address: ENTRY_POINT,
    topics: encodeEventTopics({
      abi: [FLUENT_USER_OPERATION_EVENT],
      args: {
        userOpHash: params.userOpHash,
        sender: params.sender,
        paymaster: params.paymaster,
      },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [params.nonce, params.success, params.actualGasCost, params.actualGasUsed],
    ),
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: numberToHex(params.logIndex),
    removed: false,
  };
}

/** One `UserOperationRevertReason`, encoded the way the EntryPoint emits it. */
function revertReasonLog(params: {
  userOpHash: Hash;
  sender: Hex;
  revertReason: Hex;
  logIndex: number;
}): RpcLog {
  return {
    address: ENTRY_POINT,
    topics: encodeEventTopics({
      abi: [FLUENT_USER_OPERATION_REVERT_REASON_EVENT],
      args: { userOpHash: params.userOpHash, sender: params.sender },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes" }],
      [7n, params.revertReason],
    ),
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: numberToHex(params.logIndex),
    removed: false,
  };
}

/** The EntryPoint's `BeforeExecution`, emitted once per bundle before any operation's call. */
function beforeExecutionLog(logIndex: number): RpcLog {
  return {
    address: ENTRY_POINT,
    topics: encodeEventTopics({ abi: [FLUENT_BEFORE_EXECUTION_EVENT] }),
    data: "0x",
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: numberToHex(logIndex),
    removed: false,
  };
}

/** An ordinary contract log: a token's `Transfer`, or a validator's event during validation. */
function transferLog(logIndex: number): RpcLog {
  return {
    address: TOKEN,
    topics: [`0x${"ee".repeat(32)}`],
    data: "0x",
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: numberToHex(logIndex),
    removed: false,
  };
}

const SETTLED_EVENT = userOperationEventLog({
  userOpHash: USER_OP_HASH,
  sender: SENDER,
  paymaster: PAYMASTER,
  nonce: 9n,
  success: true,
  actualGasCost: 5_000_000_000_000n,
  actualGasUsed: 120_000n,
  logIndex: 3,
});

function transactionReceipt(logs: RpcLog[]) {
  return {
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    blockHash: BLOCK_HASH,
    blockNumber: numberToHex(INCLUDED_BLOCK),
    from: SENDER,
    to: ENTRY_POINT,
    cumulativeGasUsed: numberToHex(200_000n),
    gasUsed: numberToHex(150_000n),
    contractAddress: null,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    type: "0x2",
    effectiveGasPrice: numberToHex(1_000_000_000n),
  };
}

type ChainAnswers = {
  /** `eth_getLogs` answers, one per poll; the last one repeats once they run out. */
  logs?: RpcLog[][];
  logsError?: Error;
  /** Polls to answer empty before `logsError` is thrown. */
  logsErrorAfter?: number;
  receiptLogs?: RpcLog[];
  receiptError?: Error;
  blockNumberError?: Error;
  /** How long every answer takes to come back. A slow endpoint, answering successfully. */
  answerDelayMs?: number;
  /** How long `eth_getTransactionReceipt` alone takes, when only it is slow. */
  receiptDelayMs?: number;
};

function fakeChain(answers: ChainAnswers = {}) {
  const calls: RpcCall[] = [];
  let logPoll = 0;
  const transport = custom(
    {
      request: async ({ method, params }: RpcCall) => {
        calls.push({ method, params });
        if (answers.answerDelayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, answers.answerDelayMs));
        }
        if (method === "eth_blockNumber") {
          if (answers.blockNumberError) throw answers.blockNumberError;
          return numberToHex(ANCHOR_BLOCK);
        }
        if (method === "eth_getLogs") {
          const poll = logPoll;
          logPoll += 1;
          if (answers.logsError && poll >= (answers.logsErrorAfter ?? 0)) {
            throw answers.logsError;
          }
          const sequence = answers.logs ?? [[]];
          return sequence[Math.min(poll, sequence.length - 1)] ?? [];
        }
        if (method === "eth_getTransactionReceipt") {
          if (answers.receiptDelayMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, answers.receiptDelayMs));
          }
          if (answers.receiptError) throw answers.receiptError;
          return transactionReceipt(answers.receiptLogs ?? [SETTLED_EVENT]);
        }
        if (method === "eth_chainId") return numberToHex(chain.id);
        throw new Error(`unexpected chain method ${method}`);
      },
    },
    // `core/rpc.ts`'s retry count, with a delay of one millisecond: the fallback must be
    // reached after the transport gave up, and its 300 ms are wall-clock cost.
    { retryCount: 3, retryDelay: 1 },
  );
  return { calls, transport, client: createPublicClient({ chain, transport }) };
}

type BundlerAnswers = { receipt?: boolean };

function fakeBundler(answers: BundlerAnswers = {}) {
  const calls: RpcCall[] = [];
  const transport = custom(
    {
      request: async ({ method, params }: RpcCall) => {
        calls.push({ method, params });
        if (method === "eth_getUserOperationReceipt") {
          if (!answers.receipt) return null;
          return {
            userOpHash: USER_OP_HASH,
            entryPoint: ENTRY_POINT,
            sender: SENDER,
            nonce: numberToHex(9n),
            success: true,
            paymaster: PAYMASTER,
            actualGasCost: numberToHex(5_000_000_000_000n),
            actualGasUsed: numberToHex(120_000n),
            // The bundler's slice of a transaction whose only log is the event: nothing.
            logs: [],
            receipt: transactionReceipt([SETTLED_EVENT]),
          };
        }
        if (method === "eth_chainId") return numberToHex(chain.id);
        throw new Error(`unexpected bundler method ${method}`);
      },
    },
    { retryCount: 3, retryDelay: 1 },
  );
  const client = createKernelAccountClient({
    // Safe: nothing in the inclusion wait asks the account for anything — only
    // `waitForUserOperationReceipt` is called on this client — so the members a real
    // `SmartAccount` has beyond these are not on this path.
    account: {
      address: SENDER,
      type: "smart" as const,
      entryPoint: { address: ENTRY_POINT, version: "0.7" as const },
      getFactoryArgs: async () => ({}),
      encodeCalls: async () => "0x" as const,
      getNonce: async () => 9n,
      getStubSignature: async () => `0x${"11".repeat(65)}` as const,
      signUserOperation: async () => `0x${"11".repeat(65)}` as const,
    } as unknown as SmartAccount,
    chain,
    bundlerTransport: transport,
  });
  return { calls, client };
}

function methodsOf(calls: RpcCall[]) {
  return calls.map((call) => call.method);
}

function countOf(calls: RpcCall[], method: string) {
  return calls.filter((call) => call.method === method).length;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readFluentInclusionAnchor", () => {
  it("reads the current block number off the chain", async () => {
    const chainRpc = fakeChain();

    await expect(readFluentInclusionAnchor(chainRpc.client)).resolves.toBe(ANCHOR_BLOCK);
    expect(methodsOf(chainRpc.calls)).toEqual(["eth_blockNumber"]);
  });

  it("reads it again for the next send rather than from viem's cache", async () => {
    const chainRpc = fakeChain();

    await readFluentInclusionAnchor(chainRpc.client);
    await readFluentInclusionAnchor(chainRpc.client);

    expect(countOf(chainRpc.calls, "eth_blockNumber")).toBe(2);
  });

  it("answers nothing when the chain cannot be read", async () => {
    const chainRpc = fakeChain({ blockNumberError: new Error("fluent rpc unreachable") });

    const anchor = await vi.waitFor(() => readFluentInclusionAnchor(chainRpc.client));

    expect(anchor).toBeUndefined();
  });
});

describe("waiting for inclusion on the chain", () => {
  function waitOnChain(params: {
    chainRpc: ReturnType<typeof fakeChain>;
    bundler: ReturnType<typeof fakeBundler>;
    anchorBlockNumber?: bigint;
    receiptSource?: FluentReceiptSource;
    sources?: FluentReceiptSource[];
  }) {
    return waitForFluentUserOperationReceipt({
      bundlerClient: params.bundler.client,
      chainClient: params.chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber:
        params.anchorBlockNumber === undefined ? ANCHOR_BLOCK : params.anchorBlockNumber,
      receiptSource: params.receiptSource ?? "chain",
      onReceiptSource: (source) => params.sources?.push(source),
    });
  }

  it("polls the chain's logs every 200 ms while nothing is found", async () => {
    const chainRpc = fakeChain({ logs: [[], [], [SETTLED_EVENT]] });
    const bundler = fakeBundler();
    const wait = waitOnChain({ chainRpc, bundler });

    await vi.advanceTimersByTimeAsync(0);
    expect(countOf(chainRpc.calls, "eth_getLogs")).toBe(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(countOf(chainRpc.calls, "eth_getLogs")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(countOf(chainRpc.calls, "eth_getLogs")).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    await expect(wait).resolves.toMatchObject({ userOpHash: USER_OP_HASH });
  });

  it("filters on the EntryPoint, the event, the hash and one block below the anchor", async () => {
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]] });
    const bundler = fakeBundler();

    await waitOnChain({ chainRpc, bundler });

    const [filter] = (chainRpc.calls.find((call) => call.method === "eth_getLogs")
      ?.params ?? []) as [{ address: Hex; topics: Hex[]; fromBlock: Hex }];
    expect(filter.address).toBe(ENTRY_POINT);
    expect(filter.topics[0]).toBe(encodeEventTopics({ abi: [FLUENT_USER_OPERATION_EVENT] })[0]);
    expect(filter.topics[1]).toBe(USER_OP_HASH);
    // The event's other two indexed parameters are left open, which viem spells `null`: this
    // operation's hash names it, and its sender and paymaster are what the event is read for.
    expect(filter.topics.slice(2)).toEqual([null, null]);
    expect(filter.fromBlock).toBe(numberToHex(ANCHOR_BLOCK - 1n));
  });

  it("asks the bundler for nothing while the chain's logs come back empty", async () => {
    const chainRpc = fakeChain({ logs: [[], [], [SETTLED_EVENT]] });
    const bundler = fakeBundler();
    const wait = waitOnChain({ chainRpc, bundler });

    await vi.advanceTimersByTimeAsync(400);
    expect(bundler.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await wait;
    expect(methodsOf(bundler.calls)).not.toContain("eth_getUserOperationReceipt");
  });

  it("builds the receipt from the event's own fields", async () => {
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]] });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt).toMatchObject({
      userOpHash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      sender: SENDER,
      paymaster: PAYMASTER,
      nonce: 9n,
      success: true,
      actualGasCost: 5_000_000_000_000n,
      actualGasUsed: 120_000n,
    });
  });

  it("takes the including transaction's receipt from the chain", async () => {
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]] });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.receipt).toMatchObject({
      transactionHash: TRANSACTION_HASH,
      blockNumber: INCLUDED_BLOCK,
      blockHash: BLOCK_HASH,
      status: "success",
      gasUsed: 150_000n,
    });
    const read = chainRpc.calls.find((call) => call.method === "eth_getTransactionReceipt");
    expect(read?.params).toEqual([TRANSACTION_HASH]);
  });

  it("keeps the logs between BeforeExecution and this operation's event", async () => {
    // ZeroDev's receipt for a live testnet operation, in shape: the transaction logged
    // `[BeforeExecution, Transfer, UserOperationEvent]` and the bundler answered `[Transfer]`.
    const chainRpc = fakeChain({
      logs: [[SETTLED_EVENT]],
      receiptLogs: [beforeExecutionLog(1), transferLog(2), SETTLED_EVENT],
    });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.logs.map((log) => log.logIndex)).toEqual([2]);
  });

  it("leaves out what the bundle logged before BeforeExecution", async () => {
    // A first operation that also deploys its account logs `AccountDeployed` and its
    // validator's installation events during validation, before `BeforeExecution`.
    const chainRpc = fakeChain({
      logs: [[SETTLED_EVENT]],
      receiptLogs: [transferLog(0), beforeExecutionLog(1), transferLog(2), SETTLED_EVENT],
    });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.logs.map((log) => log.logIndex)).toEqual([2]);
  });

  it("keeps the logs of this operation alone in a bundle of two", async () => {
    // The bundler's rule: after the later of `BeforeExecution` and the previous operation's
    // `UserOperationEvent`, before this operation's own.
    const earlier = userOperationEventLog({
      userOpHash: OTHER_USER_OP_HASH,
      sender: OTHER_SENDER,
      paymaster: PAYMASTER,
      nonce: 1n,
      success: true,
      actualGasCost: 1n,
      actualGasUsed: 2n,
      logIndex: 2,
    });
    const ours = userOperationEventLog({
      userOpHash: USER_OP_HASH,
      sender: SENDER,
      paymaster: PAYMASTER,
      nonce: 9n,
      success: true,
      actualGasCost: 5_000_000_000_000n,
      actualGasUsed: 120_000n,
      logIndex: 4,
    });
    const chainRpc = fakeChain({
      logs: [[ours]],
      receiptLogs: [beforeExecutionLog(0), transferLog(1), earlier, transferLog(3), ours],
    });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.logs.map((log) => log.logIndex)).toEqual([3]);
  });

  it("leaves paymaster out when the account paid for itself", async () => {
    // The zero address is the EntryPoint's "no paymaster", and the bundler's receipt omits
    // the field for it: a reader of either source sees the same absence.
    const selfPaid = userOperationEventLog({
      userOpHash: USER_OP_HASH,
      sender: SENDER,
      paymaster: zeroAddress,
      nonce: 9n,
      success: true,
      actualGasCost: 5_000_000_000_000n,
      actualGasUsed: 120_000n,
      logIndex: 3,
    });
    const chainRpc = fakeChain({ logs: [[selfPaid]], receiptLogs: [selfPaid] });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.paymaster).toBeUndefined();
  });

  it("reports the revert reason the transaction holds for this operation", async () => {
    const reason = stringToHex("ERC20: transfer amount exceeds balance");
    const chainRpc = fakeChain({
      logs: [[SETTLED_EVENT]],
      receiptLogs: [
        revertReasonLog({
          userOpHash: USER_OP_HASH,
          sender: SENDER,
          revertReason: reason,
          logIndex: 2,
        }),
        SETTLED_EVENT,
      ],
    });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.reason).toBe(reason);
  });

  it("reports no reason when the revert log belongs to another operation", async () => {
    const chainRpc = fakeChain({
      logs: [[SETTLED_EVENT]],
      receiptLogs: [
        revertReasonLog({
          userOpHash: OTHER_USER_OP_HASH,
          sender: OTHER_SENDER,
          revertReason: stringToHex("not ours"),
          logIndex: 2,
        }),
        SETTLED_EVENT,
      ],
    });
    const bundler = fakeBundler();

    const receipt = await waitOnChain({ chainRpc, bundler });

    expect(receipt.reason).toBeUndefined();
  });

  it("reports the chain as the source that answered", async () => {
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]] });
    const bundler = fakeBundler();
    const sources: FluentReceiptSource[] = [];

    await waitOnChain({ chainRpc, bundler, sources });

    expect(sources).toEqual(["chain"]);
  });

  it("returns the chain's receipt when the host's diagnostic callback throws", async () => {
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]] });
    const bundler = fakeBundler();

    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: ANCHOR_BLOCK,
      receiptSource: "chain",
      onReceiptSource: () => {
        throw new Error("the host's diagnostics are broken");
      },
    });

    await expect(wait).resolves.toMatchObject({ userOpHash: USER_OP_HASH });
    // The operation was included, so the throw costs neither the receipt nor a bundler call.
    expect(methodsOf(bundler.calls)).not.toContain("eth_getUserOperationReceipt");
  });
});

describe("falling back to the bundler", () => {
  it("continues on the bundler when the chain's logs cannot be read", async () => {
    const chainRpc = fakeChain({ logsError: new Error("fluent rpc unreachable") });
    const bundler = fakeBundler({ receipt: true });
    const sources: FluentReceiptSource[] = [];
    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: ANCHOR_BLOCK,
      receiptSource: "chain",
      onReceiptSource: (source) => sources.push(source),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const receipt = await wait;

    expect(receipt.userOpHash).toBe(USER_OP_HASH);
    expect(receipt.receipt.transactionHash).toBe(TRANSACTION_HASH);
    expect(methodsOf(bundler.calls)).toContain("eth_getUserOperationReceipt");
    expect(sources).toEqual(["bundler"]);
  });

  it("continues on the bundler when the transaction receipt cannot be read", async () => {
    const chainRpc = fakeChain({
      logs: [[SETTLED_EVENT]],
      receiptError: new Error("fluent rpc unreachable"),
    });
    const bundler = fakeBundler({ receipt: true });
    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: ANCHOR_BLOCK,
      receiptSource: "chain",
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(wait).resolves.toMatchObject({ userOpHash: USER_OP_HASH });
  });

  it("waits on the bundler when the anchor block was never read", async () => {
    const chainRpc = fakeChain();
    const bundler = fakeBundler({ receipt: true });
    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: undefined,
      receiptSource: "chain",
    });

    await vi.advanceTimersByTimeAsync(0);

    await expect(wait).resolves.toMatchObject({ userOpHash: USER_OP_HASH });
    expect(methodsOf(chainRpc.calls)).not.toContain("eth_getLogs");
  });

  it("polls the bundler every 200 ms with the receipt source at bundler", async () => {
    const chainRpc = fakeChain();
    const bundler = fakeBundler({ receipt: false });
    const sources: FluentReceiptSource[] = [];
    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: ANCHOR_BLOCK,
      receiptSource: "bundler",
      onReceiptSource: (source) => sources.push(source),
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(countOf(bundler.calls, "eth_getUserOperationReceipt")).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(countOf(bundler.calls, "eth_getUserOperationReceipt")).toBe(2);
    expect(methodsOf(chainRpc.calls)).not.toContain("eth_getLogs");
    expect(sources).toEqual(["bundler"]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(await wait).toBeInstanceOf(WaitForUserOperationReceiptTimeoutError);
  });

  it("returns the bundler's receipt when the host's diagnostic callback throws", async () => {
    const chainRpc = fakeChain();
    const bundler = fakeBundler({ receipt: true });

    const wait = waitForFluentUserOperationReceipt({
      bundlerClient: bundler.client,
      chainClient: chainRpc.client,
      hash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      anchorBlockNumber: ANCHOR_BLOCK,
      receiptSource: "bundler",
      onReceiptSource: () => {
        throw new Error("the host's diagnostics are broken");
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    await expect(wait).resolves.toMatchObject({ userOpHash: USER_OP_HASH });
  });
});

describe("the one deadline of a send", () => {
  /** The wait's outcome and the instant it reached it, on the clock the deadline is kept on. */
  function settledAt(wait: Promise<unknown>) {
    const startedAt = Date.now();
    return wait.then(
      () => ({ outcome: "resolved" as unknown, elapsedMs: Date.now() - startedAt }),
      (error: unknown) => ({ outcome: error, elapsedMs: Date.now() - startedAt }),
    );
  }

  it("rejects with viem's timeout error when no event is found within 120 s", async () => {
    const chainRpc = fakeChain({ logs: [[]] });
    const bundler = fakeBundler();
    const settled = settledAt(
      waitForFluentUserOperationReceipt({
        bundlerClient: bundler.client,
        chainClient: chainRpc.client,
        hash: USER_OP_HASH,
        entryPoint: ENTRY_POINT,
        anchorBlockNumber: ANCHOR_BLOCK,
        receiptSource: "chain",
      }),
    );

    await vi.advanceTimersByTimeAsync(119_800);
    expect(bundler.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);

    const { outcome, elapsedMs } = await settled;
    expect(outcome).toBeInstanceOf(WaitForUserOperationReceiptTimeoutError);
    expect(elapsedMs).toBeGreaterThanOrEqual(120_000);
    expect(elapsedMs).toBeLessThanOrEqual(120_200);
  });

  it("holds the deadline when every log request answers successfully after a second", async () => {
    // Nothing fails here: a slow endpoint answers each poll with no logs after 1000 ms. A
    // deadline read only between polls would let the wait run a second past 120 s per request.
    const chainRpc = fakeChain({ logs: [[]], answerDelayMs: 1_000 });
    const bundler = fakeBundler();
    const settled = settledAt(
      waitForFluentUserOperationReceipt({
        bundlerClient: bundler.client,
        chainClient: chainRpc.client,
        hash: USER_OP_HASH,
        entryPoint: ENTRY_POINT,
        anchorBlockNumber: ANCHOR_BLOCK,
        receiptSource: "chain",
      }),
    );

    await vi.advanceTimersByTimeAsync(122_000);

    const { outcome, elapsedMs } = await settled;
    expect(outcome).toBeInstanceOf(WaitForUserOperationReceiptTimeoutError);
    expect(elapsedMs).toBeLessThanOrEqual(120_200);
    expect(bundler.calls).toEqual([]);
  });

  it("does not take a receipt the chain answered with after the deadline", async () => {
    // The event is there from the first poll, and the transaction receipt takes four minutes:
    // the wait is over before it arrives, and the late answer is not turned into a receipt.
    const chainRpc = fakeChain({ logs: [[SETTLED_EVENT]], receiptDelayMs: 240_000 });
    const bundler = fakeBundler({ receipt: true });
    const settled = settledAt(
      waitForFluentUserOperationReceipt({
        bundlerClient: bundler.client,
        chainClient: chainRpc.client,
        hash: USER_OP_HASH,
        entryPoint: ENTRY_POINT,
        anchorBlockNumber: ANCHOR_BLOCK,
        receiptSource: "chain",
      }),
    );

    await vi.advanceTimersByTimeAsync(300_000);

    const { outcome, elapsedMs } = await settled;
    expect(outcome).toBeInstanceOf(WaitForUserOperationReceiptTimeoutError);
    expect(elapsedMs).toBeLessThanOrEqual(120_200);
  });

  it("gives the bundler only what is left of the 120 s, never a fresh one", async () => {
    // Empty for a minute, then the chain's logs fail: the bundler continues the same wait.
    const chainRpc = fakeChain({
      logsError: new Error("fluent rpc unreachable"),
      logsErrorAfter: 300,
    });
    const bundler = fakeBundler({ receipt: false });
    const settled = settledAt(
      waitForFluentUserOperationReceipt({
        bundlerClient: bundler.client,
        chainClient: chainRpc.client,
        hash: USER_OP_HASH,
        entryPoint: ENTRY_POINT,
        anchorBlockNumber: ANCHOR_BLOCK,
        receiptSource: "chain",
      }),
    );

    await vi.advanceTimersByTimeAsync(180_000);

    const { outcome, elapsedMs } = await settled;
    expect(outcome).toBeInstanceOf(WaitForUserOperationReceiptTimeoutError);
    // Sixty seconds of chain polling plus sixty on the bundler, not sixty plus a fresh 120.
    expect(elapsedMs).toBeLessThanOrEqual(120_200);
  });
});
