/**
 * The paymaster approval a Fluent ID's Batch operation gains when it pays in a Gas token whose
 * allowance to the ERC-20 paymaster is short, so it can pay gas in a Gas token it never approved.
 * Every test enters through `createFluentBatchOp(...).execute()` with the module's real
 * `sendCalls` behind the executor, as `useWidgetExecution` wires the two.
 *
 * Fakes:
 * - the chain's JSON-RPC endpoint, a `viem@2.52.0` `custom()` transport behind a real
 *   `createPublicClient`, which records every allowance read;
 * - the ZeroDev ERC-20 paymaster's `zd_pm_accounts` behind `fetch`, as `@zerodev/sdk@5.5.10`
 *   `getERC20PaymasterApproveCall` asks it;
 * - the kernels' bundler clients, the own-gas one and the one `createKernelAccountClient` builds
 *   for a Gas token send, each having the operation signed before it answers its hash;
 * - the smart account, whose `signUserOperation` records that a signature was asked for;
 * - for the External wallet case, the wallet's client and the chain's receipt wait, as
 *   `executionReceipt.test.ts` fakes them.
 *
 * Modules are loaded afresh for every test, so nothing a send keeps between operations (a
 * paymaster address it has read, for one) carries from one test into the next.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  numberToHex,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  zeroAddress,
} from "viem";

import { FLUENT_CONNECT_DEFAULT_EXECUTION } from "../core/config";
import { getFluentGasTokenAddress } from "../core/gasPayment";
import type { FluentWidgetNetwork } from "../core/network";
import { sendCallsViaExternalWallet } from "./sendCallsViaExternalWallet";
import type {
  FluentBatchOperationExecuteOptions,
  FluentBatchOperationExecutor,
} from "./batchOperation";
import type { FluentZeroDevKernel, FluentZeroDevSendContext } from "./zerodevSession";

vi.mock("@zerodev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zerodev/sdk")>()),
  // The Gas token send's bundler client: the send builds it for itself, and `send` hands it the
  // fake below.
  createKernelAccountClient: vi.fn(),
}));

const SMART_ACCOUNT = getAddress("0x092ae7564c6611a114c20c6df766b5b35a52334a");
const TARGET = getAddress("0x3333333333333333333333333333333333333333");
const OTHER_TARGET = getAddress("0x4444444444444444444444444444444444444444");
/** The ERC-20 paymaster `zd_pm_accounts` names, per chain id: one address per chain. */
const PAYMASTERS: Record<number, Address> = {
  20994: getAddress("0x9999999999999999999999999999999999999999"),
  25363: getAddress("0x0b0137de5377721b3c73aec33cbb514de1295878"),
};
const USER_OP_HASH = `0x${"aa".repeat(32)}` as Hash;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as Hash;
const CHAINS: Record<FluentWidgetNetwork, Chain> = {
  testnet: {
    id: 20994,
    name: "Fluent Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.fluent.test"] } },
  },
  mainnet: {
    id: 25363,
    name: "Fluent",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.fluent.test"] } },
  },
};
/** The caller's calls of most tests: one call with data, as an App's `execute()` passes it. */
const CALLS = [{ to: TARGET, data: "0x1234" as Hex }];

const USDNR_THRESHOLD = 100_000n;
const USDNR_APPROVAL = 1_000_000n;
const BLEND_THRESHOLD = 1_000_000_000_000_000_000n;
const BLEND_APPROVAL = 10_000_000_000_000_000_000n;

type Allowance = bigint | "unreadable";
type PaymasterAnswer = "address" | "error" | "empty";

type Boundary = {
  /** The smart account's allowance of each Gas token (by lowercased address) to the paymaster. */
  allowances: Record<string, Allowance>;
  paymasterAnswer: PaymasterAnswer;
};

let boundary: Boundary;
/** Every `zd_pm_accounts` request that left, with its parameters. */
let paymasterRequests: { chainId?: number; entryPointAddress?: string }[];
/** Every ERC-20 `allowance(owner, spender)` read the chain was asked for, failed ones included. */
let allowanceReads: { token: Address; owner: Address; spender: Address }[];

// The first import of `./zerodevSession` loads the send's dependency graph cold, past Vitest's 5 s
// test timeout. Loaded here once, the import each test makes after `vi.resetModules()` evaluates
// only this repository's modules again, over dependencies already loaded.
beforeAll(async () => {
  await import("./zerodevSession");
  await import("./batchOperation");
}, 120_000);

beforeEach(() => {
  vi.resetModules();
  boundary = { allowances: {}, paymasterAnswer: "address" };
  paymasterRequests = [];
  allowanceReads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        id?: unknown;
        method?: string;
        params?: [{ chainId?: number; entryPointAddress?: string }];
      };
      if (body.method !== "zd_pm_accounts") {
        throw new Error(`unexpected request ${body.method}`);
      }
      const asked = body.params?.[0] ?? {};
      paymasterRequests.push(asked);
      const answer =
        boundary.paymasterAnswer === "error"
          ? { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "no paymaster" } }
          : {
              jsonrpc: "2.0",
              id: body.id,
              result:
                boundary.paymasterAnswer === "empty" ? [] : [PAYMASTERS[Number(asked.chainId)]],
            };
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The widget chain's public client, answering the reads a Gas token send makes. */
function chainClient(chain: Chain) {
  return createPublicClient({
    chain,
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === "eth_chainId") return numberToHex(chain.id);
          if (method === "eth_call") {
            const [call] = params as [{ to: Address; data?: Hex; input?: Hex }];
            const { functionName, args } = decodeFunctionData({
              abi: erc20Abi,
              data: (call.data ?? call.input)!,
            });
            if (functionName !== "allowance") throw new Error(`unexpected call ${functionName}`);
            const [owner, spender] = args as [Address, Address];
            allowanceReads.push({
              token: getAddress(call.to),
              owner: getAddress(owner),
              spender: getAddress(spender),
            });
            const allowance = boundary.allowances[call.to.toLowerCase()];
            if (allowance === "unreadable") throw new Error("execution reverted");
            const granted =
              getAddress(owner) === SMART_ACCOUNT && getAddress(spender) === PAYMASTERS[chain.id]
                ? (allowance ?? 0n)
                : 0n;
            return encodeAbiParameters([{ type: "uint256" }], [granted]);
          }
          if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") {
            return {
              number: numberToHex(100),
              hash: BLOCK_HASH,
              timestamp: numberToHex(Math.floor(Date.now() / 1000)),
              transactions: [],
            };
          }
          throw new Error(`unexpected chain request ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  });
}

/** What a bundler answers for the included operation; `paymaster` is the one that paid. */
function includedOperation(paymaster: Address) {
  return {
    userOpHash: USER_OP_HASH,
    success: true,
    paymaster,
    logs: [],
    receipt: {
      transactionHash: TRANSACTION_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 100n,
      status: "success",
      logs: [],
    },
  };
}

/** The operation a bundler client is handed: the account that signs it, and its calls. */
type SubmittedOperation = {
  account: { signUserOperation: (operation: unknown) => Promise<unknown> };
  calls: unknown[];
};

/**
 * A kernel bundler client. Like a real one, it has the operation signed by the account it was
 * handed before it answers the hash, then answers the receipt of its inclusion.
 */
function bundlerClient(paymaster: Address) {
  return {
    sendUserOperation: vi.fn(async (args: SubmittedOperation) => {
      await args.account.signUserOperation({ callData: "0x" });
      return USER_OP_HASH;
    }),
    waitForUserOperationReceipt: vi.fn(async () => includedOperation(paymaster)),
  };
}

/** One smart account per signing mode, as the widget derives a silent and a prompting one. */
function kernelFor(network: FluentWidgetNetwork, signerMode: "silent" | "prompt") {
  const chain = CHAINS[network];
  const account = {
    address: SMART_ACCOUNT,
    entryPoint: { address: getAddress("0x0000000071727de22e5e9d8baf0edac6f37da032") },
    signUserOperation: vi.fn(async (_operation: unknown) => `0x${"11".repeat(65)}`),
  };
  return {
    account,
    // The own-gas client: what an ETH-paid operation is sent through.
    client: bundlerClient(zeroAddress),
    publicClient: chainClient(chain),
    smartAccountAddress: SMART_ACCOUNT,
    zeroDevRpcUrl: `https://rpc.zerodev.app/api/v3/project/chain/${chain.id}`,
    chain,
    signerMode,
    signerSource: "privy" as const,
  };
}

/**
 * Executes one Batch operation of `calls` through `createFluentBatchOp`, with the real
 * `sendCalls` behind the executor. Returns what reached the bundler client and the two kernels.
 */
async function execute(params: {
  network?: FluentWidgetNetwork;
  calls?: { to: Address; data: Hex; value?: bigint }[];
  options?: FluentBatchOperationExecuteOptions;
  executor?: Partial<FluentBatchOperationExecutor>;
}) {
  const network = params.network ?? "testnet";
  const { createKernelAccountClient } = await import("@zerodev/sdk");
  const { createFluentBatchOp } = await import("./batchOperation");
  const { sendCalls } = await import("./zerodevSession");
  // The Gas token send's client, built with the ERC-20 paymaster that charges the token.
  const bundler = bundlerClient(PAYMASTERS[CHAINS[network].id]!);
  vi.mocked(createKernelAccountClient).mockReturnValue(bundler as never);
  const silent = kernelFor(network, "silent");
  const prompt = kernelFor(network, "prompt");
  // Safe: a Gas token send reaches only the members `kernelFor` gives.
  const kernels = {
    silent: silent as unknown as FluentZeroDevKernel,
    prompt: prompt as unknown as FluentZeroDevKernel,
  };
  const context: FluentZeroDevSendContext = {
    kernels,
    initialize: async ({ signerMode } = {}) => kernels[signerMode ?? "prompt"],
    error: null,
    network,
    readExecution: () => ({
      ...FLUENT_CONNECT_DEFAULT_EXECUTION,
      feeSource: "bundler",
      receiptSource: "bundler",
      chainCheckBeforeSign: false,
    }),
    sponsorshipUnavailable: { current: false },
    createSponsoredClient: () => () => {
      throw new Error("a Gas token send asks for no Sponsorship");
    },
  };
  const confirm = vi.fn(async () => {});
  const op = createFluentBatchOp(
    { calls: params.calls ?? CALLS },
    {
      smartAccountReady: true,
      confirm,
      // Safe: the widget's executor adapts this result; the tests read only what was sent.
      sendCalls: (calls, options, readyAccount) =>
        sendCalls(context, calls, options, readyAccount) as never,
      ...params.executor,
    },
  );
  const result = op.execute(params.options);
  return { result, bundler, silent, prompt, confirm, createKernelAccountClient };
}

/** The calls of the one operation that reached the bundler. */
function sentCalls(bundler: { sendUserOperation: { mock: { calls: unknown[][] } } }) {
  expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
  return (bundler.sendUserOperation.mock.calls[0]![0] as { calls: unknown[] }).calls;
}

function approval(token: Address, spender: Address, amount: bigint) {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    value: 0n,
  };
}

const USDNR = getFluentGasTokenAddress("USDnr", "testnet")!;
const BLEND = getFluentGasTokenAddress("BLEND", "testnet")!;
const TESTNET_PAYMASTER = PAYMASTERS[20994]!;

function allow(token: Address, allowance: Allowance) {
  boundary.allowances[token.toLowerCase()] = allowance;
}

/**
 * Asserts the one operation a Gas token send made: sent through the client built with the ERC-20
 * paymaster rather than the own-gas one, carrying exactly `expected`, after the chain was asked
 * for the smart account's allowance of `token` to the paymaster.
 */
function expectGasTokenOperation(
  sent: Awaited<ReturnType<typeof execute>>,
  token: Address,
  expected: unknown[],
) {
  expect(sent.createKernelAccountClient).toHaveBeenCalledWith(
    expect.objectContaining({ paymaster: expect.anything() }),
  );
  expect(sent.silent.client.sendUserOperation).not.toHaveBeenCalled();
  expect(sent.prompt.client.sendUserOperation).not.toHaveBeenCalled();
  expect(allowanceReads).toContainEqual({
    token,
    owner: SMART_ACCOUNT,
    spender: TESTNET_PAYMASTER,
  });
  expect(sentCalls(sent.bundler)).toEqual(expected);
}

describe("a USDnr operation from an allowance below 0.1 USDnr", () => {
  it.each([0n, USDNR_THRESHOLD - 1n])(
    "is the USDnr approval of 1 USDnr to the paymaster, then the caller's call, from %s",
    async (allowance) => {
      allow(USDNR, allowance);
      const sent = await execute({
        options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      });
      await sent.result;

      expectGasTokenOperation(sent, USDNR, [
        approval(USDNR, TESTNET_PAYMASTER, USDNR_APPROVAL),
        { to: TARGET, data: "0x1234", value: 0n },
      ]);
    },
  );
});

describe("a BLEND operation from an allowance below 1 BLEND", () => {
  it.each([0n, BLEND_THRESHOLD - 1n])(
    "is the BLEND approval of 10 BLEND to the paymaster, then the caller's call, from %s",
    async (allowance) => {
      allow(BLEND, allowance);
      const sent = await execute({
        options: { gasPayment: { symbol: "BLEND" }, confirmation: "silent" },
      });
      await sent.result;

      expectGasTokenOperation(sent, BLEND, [
        approval(BLEND, TESTNET_PAYMASTER, BLEND_APPROVAL),
        { to: TARGET, data: "0x1234", value: 0n },
      ]);
    },
  );
});

describe("the caller's calls after the approval", () => {
  it("follow the approval unchanged, element by element", async () => {
    allow(USDNR, 0n);
    const callers = [
      { to: TARGET, data: "0x1234" as Hex, value: 5n },
      { to: OTHER_TARGET, data: "0xabcdef" as Hex, value: 0n },
    ];
    const { result, bundler } = await execute({
      calls: callers,
      options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
    });
    await result;

    const sent = sentCalls(bundler);
    expect(sent).toHaveLength(callers.length + 1);
    expect(sent[0]).toEqual(approval(USDNR, TESTNET_PAYMASTER, USDNR_APPROVAL));
    expect(sent.slice(1)).toEqual(callers);
  });
});

describe("a USDnr operation from an allowance of 0.1 USDnr or more", () => {
  it.each([USDNR_THRESHOLD, USDNR_APPROVAL])(
    "carries the caller's calls alone when the allowance is %s",
    async (allowance) => {
      allow(USDNR, allowance);
      const { result, bundler } = await execute({
        options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      });
      await result;

      expect(sentCalls(bundler)).toEqual([{ to: TARGET, data: "0x1234", value: 0n }]);
    },
  );
});

describe("execute() with no gasPayment while USDnr is chosen in User settings", () => {
  it("sends an operation whose first call is the USDnr approval", async () => {
    allow(USDNR, 0n);
    const { result, bundler } = await execute({
      executor: {
        defaultGasPayment: { symbol: "USDnr", token: USDNR, decimals: 6 },
        defaultSigningMode: "silent",
      },
    });
    await result;

    const sent = sentCalls(bundler);
    expect(sent[0]).toEqual(approval(USDNR, TESTNET_PAYMASTER, USDNR_APPROVAL));
    expect(sent.slice(1)).toEqual([{ to: TARGET, data: "0x1234", value: 0n }]);
  });
});

describe("the approval's spender", () => {
  it.each(["testnet", "mainnet"] as const)(
    "is the address zd_pm_accounts returned for the operation's chain id on %s",
    async (network) => {
      const chainId = CHAINS[network].id;
      const usdnr = getFluentGasTokenAddress("USDnr", network)!;
      allow(usdnr, 0n);
      const { result, bundler } = await execute({
        network,
        options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      });
      await result;

      expect(paymasterRequests.length).toBeGreaterThan(0);
      expect(paymasterRequests.every((asked) => Number(asked.chainId) === chainId)).toBe(true);
      expect(sentCalls(bundler)[0]).toEqual(approval(usdnr, PAYMASTERS[chainId]!, USDNR_APPROVAL));
    },
  );
});

describe("an allowance that cannot be read", () => {
  it.each([
    ["USDnr", USDNR, USDNR_APPROVAL],
    ["BLEND", BLEND, BLEND_APPROVAL],
  ] as const)(
    "is taken as 0: the %s operation is the approval, then the caller's call",
    async (symbol, token, amount) => {
      allow(token, "unreadable");
      const sent = await execute({
        options: { gasPayment: { symbol }, confirmation: "silent" },
      });
      // Resolves: an unreadable allowance never rejects the operation.
      await expect(sent.result).resolves.toMatchObject({ userOpHash: USER_OP_HASH });

      // The read was asked for and failed, and the operation still carries the approval.
      expectGasTokenOperation(sent, token, [
        approval(token, TESTNET_PAYMASTER, amount),
        { to: TARGET, data: "0x1234", value: 0n },
      ]);
    },
  );
});

describe("a paymaster address zd_pm_accounts does not give", () => {
  it.each(["error", "empty"] as const)(
    "rejects execute() before any signature is requested when zd_pm_accounts answers %s",
    async (answer) => {
      boundary.paymasterAnswer = answer;
      allow(USDNR, 0n);
      const { result, bundler, silent, prompt } = await execute({
        options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      });

      await expect(result).rejects.toThrow();
      expect(bundler.sendUserOperation).not.toHaveBeenCalled();
      expect(silent.account.signUserOperation).not.toHaveBeenCalled();
      expect(prompt.account.signUserOperation).not.toHaveBeenCalled();
    },
  );
});

describe("an explicit includeApproval", () => {
  it("approves the caller's approveAmount even from an allowance of 1 USDnr", async () => {
    allow(USDNR, USDNR_APPROVAL);
    const { result, bundler } = await execute({
      options: {
        gasPayment: { symbol: "USDnr", includeApproval: true, approveAmount: 123n },
        confirmation: "silent",
      },
    });
    await result;

    const sent = sentCalls(bundler);
    expect(sent[0]).toEqual(approval(USDNR, TESTNET_PAYMASTER, 123n));
    expect(sent.slice(1)).toEqual([{ to: TARGET, data: "0x1234", value: 0n }]);
  });
});

describe("Quick sign over an operation that gained the approval", () => {
  it("signs in Silent mode when the caller's calls are all on the whitelist", async () => {
    allow(USDNR, 0n);
    const sent = await execute({
      options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      executor: { quickSignWhitelist: [TARGET] },
    });
    await sent.result;

    expect(sentCalls(sent.bundler)).toEqual([
      approval(USDNR, TESTNET_PAYMASTER, USDNR_APPROVAL),
      { to: TARGET, data: "0x1234", value: 0n },
    ]);
    // Silent mode: no Review, and the one signature is the silent account's.
    expect(sent.confirm).not.toHaveBeenCalled();
    expect(sent.silent.account.signUserOperation).toHaveBeenCalledOnce();
    expect(sent.prompt.account.signUserOperation).not.toHaveBeenCalled();
  });

  it("signs in Prompt mode, after the Review, when a call is off the whitelist", async () => {
    allow(USDNR, 0n);
    const sent = await execute({
      calls: [{ to: OTHER_TARGET, data: "0x1234" }],
      options: { gasPayment: { symbol: "USDnr" }, confirmation: "silent" },
      executor: { quickSignWhitelist: [TARGET] },
    });
    await sent.result;

    expect(sentCalls(sent.bundler)[0]).toEqual(approval(USDNR, TESTNET_PAYMASTER, USDNR_APPROVAL));
    expect(sent.confirm).toHaveBeenCalledOnce();
    expect(sent.prompt.account.signUserOperation).toHaveBeenCalledOnce();
    expect(sent.silent.account.signUserOperation).not.toHaveBeenCalled();
  });
});

describe("operations the automatic approval leaves alone", () => {
  it.each([
    ["no includeApproval", { symbol: "ETH", sponsorship: "never" }],
    [
      "includeApproval: true",
      {
        symbol: "ETH",
        sponsorship: "never",
        includeApproval: true,
        approveAmount: USDNR_APPROVAL,
      },
    ],
  ] as const)(
    "carries the caller's calls alone and reads nothing for an ETH-paid operation with %s",
    async (_case, gasPayment) => {
      allow(USDNR, 0n);
      allow(BLEND, 0n);
      const sent = await execute({ options: { gasPayment, confirmation: "silent" } });
      await sent.result;

      expect(sent.bundler.sendUserOperation).not.toHaveBeenCalled();
      expect(sentCalls(sent.silent.client)).toEqual([{ to: TARGET, data: "0x1234", value: 0n }]);
      expect(paymasterRequests).toEqual([]);
      expect(allowanceReads).toEqual([]);
    },
  );

  it("sends an External wallet's operation paid in USDnr as the caller's calls alone", async () => {
    allow(USDNR, 0n);
    const { createFluentBatchOp } = await import("./batchOperation");
    const hash = TRANSACTION_HASH;
    const wallet = {
      address: SMART_ACCOUNT,
      switchChain: vi.fn(async () => {}),
      walletClient: {
        account: SMART_ACCOUNT,
        sendTransaction: vi.fn(async (_request: Record<string, unknown>) => hash),
      },
    };
    const publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({ transactionHash: hash, status: "success" })),
    };
    const callers = [
      { to: TARGET, data: "0x1234" as Hex, value: 0n },
      { to: OTHER_TARGET, data: "0xabcdef" as Hex, value: 1n },
    ];
    const op = createFluentBatchOp(
      { calls: callers },
      {
        account: { type: "eoa", address: SMART_ACCOUNT, executionReady: true } as never,
        defaultGasPayment: { symbol: "USDnr", token: USDNR, decimals: 6 },
        // Safe: only the members `sendCallsViaExternalWallet` reads.
        sendCalls: (calls) =>
          sendCallsViaExternalWallet(calls, wallet as never, CHAINS.testnet, publicClient as never),
      },
    );
    await op.execute({ gasPayment: { symbol: "USDnr" } });

    expect(wallet.walletClient.sendTransaction.mock.calls.map(([sent]) => sent)).toEqual(
      callers.map((call) => expect.objectContaining(call)),
    );
    expect(paymasterRequests).toEqual([]);
    expect(allowanceReads).toEqual([]);
  });
});
