/**
 * A Fluent ID's Batch operation paid in a Gas token goes to the paymaster that charges Gas
 * tokens whatever the account's balance of the token before the operation, because the operation
 * may acquire the fee itself (FLU-1715, reversing FLU-1711's check before sponsorship). Only the
 * paymaster's answer decides that the fee cannot be charged: `execute()` then rejects with a
 * `FluentGasPaymentError`, never with a bare `HttpRequestError`.
 *
 * Every test enters through `createFluentBatchOp(...).execute()`, the function behind
 * `widget.createBatchOp`, with the module's real `sendCalls` behind the executor, the way
 * `useWidgetExecution` wires the two. What a test observes is what `execute()` resolves or
 * rejects with, whether the smart account was asked for a signature, which operation reached
 * the bundler, and, in the order they left, the requests for the chain (`balanceOf`) and for the
 * paymaster RPC (a quote and the sponsorship, with the Gas token they name).
 *
 * Fakes, and nothing else:
 * - the widget chain's JSON-RPC endpoint, as a `viem@2.52.0` `custom()` transport behind a real
 *   `createPublicClient`: `eth_call` answers ERC-20 `allowance(owner, spender)` with an allowance
 *   above the automatic approval's threshold (so no approval is added), and `balanceOf(owner)`
 *   with the smart account's balance a test sets for the Gas token; `eth_getBlockByNumber`
 *   answers the including block;
 * - `fetch`, where the paymaster RPC that charges Gas tokens answers, as `@zerodev/sdk@5.5.10`
 *   asks them: `zd_pm_accounts` with the chain's paymaster; `stackup_getERC20TokenQuotes` (the
 *   request `estimateGasInERC20` makes) with a fee above 0 as `{ maxGasCostToken, tokenDecimals }`
 *   hex quantities, so a check of the balance against the quote would refuse a balance of 0; and
 *   `zd_sponsorUserOperation` (the request `sponsorUserOperation` makes) with a v0.7 sponsorship,
 *   or with the refusal a test chooses, carrying either the `AA50 postOp reverted` simulation
 *   failure ZeroDev answers when `postOp` cannot charge the token, or another refusal: as an
 *   HTTP 400 whose body's `error` is a string, which `viem@2.52.0`'s `http` transport turns into
 *   the `HttpRequestError` "HTTP request failed" seen on 2026-11-03, or as a JSON-RPC error;
 * - the bundler client `createKernelAccountClient` builds for a Gas token send. It mirrors
 *   `viem@2.52.0` `prepareUserOperation` and `sendUserOperation` in order: with a paymaster that
 *   has `getPaymasterData` and no `getPaymasterStubData`, `getPaymasterData` is asked once, as the
 *   stub, before gas is estimated; with both, the stub is asked first and `getPaymasterData`
 *   after the gas fields are filled, unless the stub answered `isFinal`. Only then is the
 *   operation signed by the account it was handed, and only after the signature is it submitted;
 * - the smart account, whose `signUserOperation` records that a signature was asked for.
 *
 * Modules are loaded afresh for every test, so nothing a send keeps between operations carries
 * from one test into the next.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseError,
  HttpRequestError,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  numberToHex,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from "viem";

import { FLUENT_CONNECT_DEFAULT_EXECUTION } from "../core/config";
import { getFluentGasTokenAddress } from "../core/gasPayment";
import type { FluentBatchOperationExecuteOptions } from "./batchOperation";
import type { FluentZeroDevKernel, FluentZeroDevSendContext } from "./zerodevSession";

vi.mock("@zerodev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zerodev/sdk")>()),
  createKernelAccountClient: vi.fn(),
}));

const SMART_ACCOUNT = getAddress("0x092ae7564c6611a114c20c6df766b5b35a52334a");
const TARGET = getAddress("0x3333333333333333333333333333333333333333");
const PAYMASTER = getAddress("0x9999999999999999999999999999999999999999");
const ENTRY_POINT_07 = getAddress("0x0000000071727de22e5e9d8baf0edac6f37da032");
const USER_OP_HASH = `0x${"aa".repeat(32)}` as Hash;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as Hash;
const CHAIN: Chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.fluent.test"] } },
};
const CALLS = [{ to: TARGET, data: "0x1234" as Hex }];

const USDNR = getFluentGasTokenAddress("USDnr", "testnet")!;
const BLEND = getFluentGasTokenAddress("BLEND", "testnet")!;
const TOKENS = {
  USDnr: { address: USDNR, decimals: 6, quote: 420_000n },
  BLEND: { address: BLEND, decimals: 18, quote: 3_000_000_000_000_000n },
} as const;
type GasSymbol = keyof typeof TOKENS;

type Quote = { value: bigint; decimals: number };
type Sponsor = "sponsored" | "postOpHttp" | "postOpRpc" | "refusedHttp" | "refusedRpc";

type Boundary = {
  /** The smart account's balance of each Gas token, by lowercased address. */
  balances: Record<string, bigint>;
  quote: Quote;
  sponsor: Sponsor;
};

let boundary: Boundary;
/** Every request the paymaster RPC was sent, with its first parameter. */
let paymasterRequests: { method: string; params: Record<string, unknown> }[];
/**
 * Every request that left, in order: a paymaster RPC request as its method, and an ERC-20
 * `balanceOf` read of the chain as `balanceOf:<token address, checksummed>`.
 */
let wire: string[];

beforeAll(async () => {
  await import("./zerodevSession");
  await import("./batchOperation");
}, 120_000);

/** A JSON-RPC answer from the paymaster RPC, with `status` 200 unless given. */
function rpcResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const POST_OP_REVERT = {
  code: -32500,
  message: "UserOperation reverted during simulation with reason: AA50 postOp reverted",
  // `TransferFromFailed()`, the Gas token's `transferFrom` in `postOp`.
  data: "0x7939f424",
};
const OTHER_REFUSAL = { code: -32602, message: "gas token is not supported by this paymaster" };

function sponsorAnswer(id: unknown): Response {
  switch (boundary.sponsor) {
    case "sponsored":
      return rpcResponse({
        jsonrpc: "2.0",
        id,
        result: {
          callGasLimit: "0x10000",
          verificationGasLimit: "0x20000",
          preVerificationGas: "0x5000",
          paymaster: PAYMASTER,
          paymasterVerificationGasLimit: "0x8000",
          paymasterPostOpGasLimit: "0xc350",
          paymasterData: "0x1234",
        },
      });
    case "postOpHttp":
      return rpcResponse({ error: `${POST_OP_REVERT.message} ${POST_OP_REVERT.data}` }, 400);
    case "postOpRpc":
      return rpcResponse({ jsonrpc: "2.0", id, error: POST_OP_REVERT });
    case "refusedHttp":
      return rpcResponse({ error: OTHER_REFUSAL.message }, 400);
    case "refusedRpc":
      return rpcResponse({ jsonrpc: "2.0", id, error: OTHER_REFUSAL });
  }
}

function quoteAnswer(id: unknown): Response {
  const { quote } = boundary;
  return rpcResponse({
    jsonrpc: "2.0",
    id,
    result: {
      maxGasCostToken: numberToHex(quote.value),
      tokenDecimals: numberToHex(quote.decimals),
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  boundary = { balances: {}, quote: quoteFor("USDnr"), sponsor: "sponsored" };
  paymasterRequests = [];
  wire = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        id?: unknown;
        method?: string;
        params?: [Record<string, unknown>];
      };
      wire.push(body.method ?? "");
      paymasterRequests.push({ method: body.method ?? "", params: body.params?.[0] ?? {} });
      if (body.method === "zd_pm_accounts") {
        return rpcResponse({ jsonrpc: "2.0", id: body.id, result: [PAYMASTER] });
      }
      if (body.method === "stackup_getERC20TokenQuotes") return quoteAnswer(body.id);
      if (body.method === "zd_sponsorUserOperation") return sponsorAnswer(body.id);
      throw new Error(`unexpected request ${body.method}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function chainClient() {
  return createPublicClient({
    chain: CHAIN,
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === "eth_chainId") return numberToHex(CHAIN.id);
          if (method === "eth_call") {
            const [call] = params as [{ to: Address; data?: Hex; input?: Hex }];
            const { functionName } = decodeFunctionData({
              abi: erc20Abi,
              data: (call.data ?? call.input)!,
            });
            if (functionName === "allowance") {
              // Above either token's refresh threshold: no approval joins the operation.
              return encodeAbiParameters([{ type: "uint256" }], [10n ** 30n]);
            }
            if (functionName === "balanceOf") {
              wire.push(`balanceOf:${getAddress(call.to)}`);
              const balance = boundary.balances[call.to.toLowerCase()];
              return encodeAbiParameters([{ type: "uint256" }], [balance ?? 0n]);
            }
            throw new Error(`unexpected call ${functionName}`);
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

type PaymasterAdapter = {
  getPaymasterData?: (parameters: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getPaymasterStubData?: (parameters: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/**
 * The Gas token send's bundler client, built around the paymaster the send hands
 * `createKernelAccountClient`, in `viem@2.52.0` `prepareUserOperation`'s order.
 */
function bundlerClient(paymaster: PaymasterAdapter | undefined) {
  const submitted: Array<Record<string, unknown> & { calls: unknown[] }> = [];
  const client = {
    submitted,
    sendUserOperation: vi.fn(
      async (args: {
        account: { signUserOperation: (op: unknown) => Promise<unknown> };
        calls: unknown[];
      }) => {
        let request: Record<string, unknown> = {
          sender: SMART_ACCOUNT,
          nonce: 1n,
          callData: "0xe9ae5c53",
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 1_000_000n,
          signature: `0x${"ff".repeat(65)}`,
        };
        const both = Boolean(paymaster?.getPaymasterData && paymaster.getPaymasterStubData);
        const stub = both ? paymaster?.getPaymasterStubData : paymaster?.getPaymasterData;
        let isFinal = false;
        if (stub) {
          const { isFinal: final = false, ...fields } = await stub({
            chainId: CHAIN.id,
            entryPointAddress: ENTRY_POINT_07,
            context: undefined,
            ...request,
          });
          isFinal = Boolean(final);
          request = { ...request, ...fields };
        }
        request = {
          callGasLimit: 0x10000n,
          verificationGasLimit: 0x20000n,
          preVerificationGas: 0x5000n,
          ...request,
        };
        if (both && !isFinal && paymaster?.getPaymasterData) {
          request = {
            ...request,
            ...(await paymaster.getPaymasterData({
              chainId: CHAIN.id,
              entryPointAddress: ENTRY_POINT_07,
              context: undefined,
              ...request,
            })),
          };
        }
        await args.account.signUserOperation(request);
        submitted.push({ ...request, calls: args.calls });
        return USER_OP_HASH;
      },
    ),
    waitForUserOperationReceipt: vi.fn(async () => ({
      userOpHash: USER_OP_HASH,
      success: true,
      paymaster: PAYMASTER,
      logs: [],
      receipt: {
        transactionHash: TRANSACTION_HASH,
        blockHash: BLOCK_HASH,
        blockNumber: 100n,
        status: "success",
        logs: [],
      },
    })),
  };
  return client;
}

function ownGasClient() {
  return {
    sendUserOperation: vi.fn(async () => {
      throw new Error("a Gas token operation is not sent with the account's own gas");
    }),
    waitForUserOperationReceipt: vi.fn(),
  };
}

/** Executes one Batch operation paid in `symbol` through `createFluentBatchOp`. */
async function execute(symbol: GasSymbol) {
  const { createKernelAccountClient } = await import("@zerodev/sdk");
  const { createFluentBatchOp } = await import("./batchOperation");
  const { sendCalls } = await import("./zerodevSession");
  let bundler: ReturnType<typeof bundlerClient> | undefined;
  vi.mocked(createKernelAccountClient).mockImplementation(((params: {
    paymaster?: PaymasterAdapter;
  }) => {
    bundler = bundlerClient(params.paymaster);
    return bundler;
  }) as never);
  const account = {
    address: SMART_ACCOUNT,
    entryPoint: { address: ENTRY_POINT_07, version: "0.7" },
    signUserOperation: vi.fn(async (_operation: unknown) => `0x${"11".repeat(65)}` as Hex),
  };
  const kernel = {
    account,
    client: ownGasClient(),
    publicClient: chainClient(),
    smartAccountAddress: SMART_ACCOUNT,
    zeroDevRpcUrl: `https://rpc.zerodev.app/api/v3/project/chain/${CHAIN.id}`,
    chain: CHAIN,
    signerMode: "silent" as const,
    signerSource: "privy" as const,
  };
  // Safe: a Gas token send reaches only the members above.
  const kernels = {
    silent: kernel as unknown as FluentZeroDevKernel,
    prompt: { ...kernel, signerMode: "prompt" } as unknown as FluentZeroDevKernel,
  };
  const context: FluentZeroDevSendContext = {
    kernels,
    initialize: async ({ signerMode } = {}) => kernels[signerMode ?? "prompt"],
    error: null,
    network: "testnet",
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
  const options: FluentBatchOperationExecuteOptions = {
    gasPayment: { symbol },
    confirmation: "silent",
  };
  const op = createFluentBatchOp(
    { calls: CALLS },
    {
      smartAccountReady: true,
      confirm: vi.fn(async () => {}),
      // Safe: the widget's executor adapts this result; the tests read only what was sent.
      sendCalls: (calls, executeOptions, readyAccount) =>
        sendCalls(context, calls, executeOptions, readyAccount) as never,
    },
  );
  const settled = await op.execute(options).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return {
    settled,
    signed: account.signUserOperation.mock.calls.length,
    submitted: bundler?.submitted.length ?? 0,
    /** The calls of the first operation that reached the bundler. */
    calls: bundler?.submitted[0]?.calls,
  };
}

function setBalance(symbol: GasSymbol, balance: bigint) {
  boundary.balances[TOKENS[symbol].address.toLowerCase()] = balance;
}

function quoteFor(symbol: GasSymbol): Quote {
  return { value: TOKENS[symbol].quote, decimals: TOKENS[symbol].decimals };
}

function rejection(settled: Awaited<ReturnType<typeof execute>>["settled"]) {
  expect(settled.ok, "execute() resolved, but was expected to reject").toBe(false);
  return (settled as { error: Error & { code?: unknown; cause?: unknown } }).error;
}

/** The `HttpRequestError` or the JSON-RPC error ZeroDev's answer became, along `cause`. */
function vendorErrorIn(cause: unknown) {
  expect(cause, "the error carries no cause").toBeInstanceOf(BaseError);
  return (cause as BaseError).walk(
    (error) =>
      error instanceof HttpRequestError || (error as { code?: unknown }).code !== undefined,
  );
}

/**
 * The operation an App asked for, exactly: the caller's one call and no approval, the allowance
 * being above the threshold.
 */
const CALLER_CALLS = [{ to: TARGET, data: "0x1234", value: 0n }];

const sameAddress = (value: unknown, address: Address) =>
  typeof value === "string" && value.toLowerCase() === address.toLowerCase();

/** Whether a `zd_sponsorUserOperation` request asked the paymaster to charge `token`. */
function sponsoredIn(token: Address) {
  return paymasterRequests.some(
    (request) =>
      request.method === "zd_sponsorUserOperation" &&
      sameAddress(
        (request.params.gasTokenData as { tokenAddress?: unknown } | undefined)?.tokenAddress,
        token,
      ),
  );
}

describe("AC1: a USDnr operation from a USDnr balance of 0", () => {
  it("is sponsored in USDnr, signed and sent while the paymaster quotes a fee over 0", async () => {
    boundary.quote = quoteFor("USDnr");
    setBalance("USDnr", 0n);

    const sent = await execute("USDnr");

    expect(sponsoredIn(USDNR), "no zd_sponsorUserOperation request charging USDnr").toBe(true);
    expect(sent.settled).toMatchObject({ ok: true, value: { hash: TRANSACTION_HASH } });
    expect(sent.signed).toBe(1);
    expect(sent.submitted).toBe(1);
    expect(sent.calls).toEqual(CALLER_CALLS);
  });
});

describe("AC2: what a Gas token operation requests before its sponsorship", () => {
  it.each(["USDnr", "BLEND"] as const)(
    "asks for no %s balanceOf and no stackup_getERC20TokenQuotes before the sponsorship",
    async (symbol) => {
      const token = TOKENS[symbol].address;
      boundary.quote = quoteFor(symbol);
      // Ten times the quote: a check against the quote would pass and let the operation on.
      setBalance(symbol, TOKENS[symbol].quote * 10n);

      const sent = await execute(symbol);

      const sponsorAt = wire.indexOf("zd_sponsorUserOperation");
      expect(sponsorAt, "zd_sponsorUserOperation was never requested").toBeGreaterThanOrEqual(0);
      const before = wire.slice(0, sponsorAt);
      expect(before).not.toContain(`balanceOf:${getAddress(token)}`);
      expect(before).not.toContain("stackup_getERC20TokenQuotes");
      expect(sponsoredIn(token), `no zd_sponsorUserOperation request charging ${symbol}`).toBe(
        true,
      );
      expect(sent.settled).toMatchObject({ ok: true, value: { hash: TRANSACTION_HASH } });
    },
  );
});

describe("AC3: a paymaster refusal of a Gas token payment, from a USDnr balance of 0", () => {
  it.each([
    ["an HTTP 400", "postOpHttp"],
    ["a JSON-RPC error", "postOpRpc"],
  ] as const)(
    "rejects a postOp revert answered as %s with insufficient_gas_token carrying it in cause",
    async (_case, sponsor) => {
      boundary.quote = quoteFor("USDnr");
      setBalance("USDnr", 0n);
      boundary.sponsor = sponsor;

      const sent = await execute("USDnr");

      expect(sponsoredIn(USDNR), "no zd_sponsorUserOperation request charging USDnr").toBe(true);
      const error = rejection(sent.settled);
      expect(error).not.toBeInstanceOf(HttpRequestError);
      expect(error).toMatchObject({
        name: "FluentGasPaymentError",
        code: "insufficient_gas_token",
      });
      expect(error.message).toContain("USDnr");
      expect(vendorErrorIn(error.cause)).toBeTruthy();
      expect(sent.signed).toBe(0);
      expect(sent.submitted).toBe(0);
    },
  );

  it.each([
    ["an HTTP 400", "refusedHttp"],
    ["a JSON-RPC error", "refusedRpc"],
  ] as const)(
    "rejects any other refusal answered as %s with paymaster_rejected carrying it in cause",
    async (_case, sponsor) => {
      boundary.quote = quoteFor("USDnr");
      setBalance("USDnr", 0n);
      boundary.sponsor = sponsor;

      const sent = await execute("USDnr");

      expect(sponsoredIn(USDNR), "no zd_sponsorUserOperation request charging USDnr").toBe(true);
      const error = rejection(sent.settled);
      expect(error).not.toBeInstanceOf(HttpRequestError);
      expect(error).toMatchObject({ name: "FluentGasPaymentError", code: "paymaster_rejected" });
      expect(vendorErrorIn(error.cause)).toBeTruthy();
      expect(sent.signed).toBe(0);
      expect(sent.submitted).toBe(0);
    },
  );
});
