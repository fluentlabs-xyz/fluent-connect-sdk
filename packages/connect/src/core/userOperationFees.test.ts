/**
 * Fees of a user operation, read over the wire.
 *
 * Fakes, and nothing else: the two JSON-RPC transports — the widget chain's and the ZeroDev
 * bundler's — as `viem@2.52.0` `custom()` transports that answer the methods the real endpoints
 * answer. `createKernelAccountClient` (`@zerodev/sdk@5.5.10`), `prepareUserOperation` and
 * `sendUserOperation` run for real, which is the point: the fee hook is installed the way the
 * widget installs it and is called the way viem calls it.
 *
 * The account is the one stand-in beside the transports. It mirrors what viem's
 * `prepareUserOperation` asks a `SmartAccount` for, in the order it asks: `encodeCalls`,
 * `getFactoryArgs` and `getNonce` while preparing, `getStubSignature` before the gas estimate,
 * `signUserOperation` once the request is complete.
 */
import { createKernelAccountClient } from "@zerodev/sdk";
import { BaseError, createPublicClient, custom, numberToHex, RpcRequestError } from "viem";
import type { SmartAccount } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";

import {
  createFluentUserOperationFeeHook,
  isFluentFeeRejection,
  quoteFluentChainFees,
  readFluentBundlerFees,
  readFluentFeeAttempt,
  withFluentFeeAttempt,
  type FluentFeeAttempt,
} from "./userOperationFees";

const address = "0x1111111111111111111111111111111111111111" as const;
const userOpHash = `0x${"2".repeat(64)}` as const;
const transactionHash = `0x${"3".repeat(64)}` as const;
const signature = `0x${"4".repeat(130)}` as const;
const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.fluent.test"] } },
} as const;

/** 1 gwei, the shape `eth_gasPrice` answers in. */
const CHAIN_GAS_PRICE = 1_000_000_000n;
/** One call, the same one in every send below: this file is about the fees, not the batch. */
const CALLS = [{ to: address, data: "0x" as const, value: 0n }];
/** ZeroDev's quote, deliberately nothing like the chain's, so a mix-up cannot look right. */
const BUNDLER_FEES = { maxFeePerGas: 7_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n };

type RpcCall = { method: string; params?: unknown };

/**
 * The account as `createKernelAccountClient` and `sendUserOperation` take it. Safe: the fake
 * below answers every member viem's `prepareUserOperation` reaches for on a smart account, and
 * the members it lacks — `signMessage`, `signTypedData`, `getAddress` — are not on this path.
 */
function asSmartAccount(account: ReturnType<typeof fakeAccount>): SmartAccount {
  return account as unknown as SmartAccount;
}

function fakeAccount() {
  return {
    address,
    type: "smart" as const,
    entryPoint: { address, version: "0.7" as const },
    getFactoryArgs: async () => ({}),
    encodeCalls: async () => "0x1234" as const,
    getNonce: async () => 9n,
    getStubSignature: async () => signature,
    signUserOperation: async () => signature,
  };
}

/**
 * The widget's two endpoints. `chain` answers `eth_gasPrice` unless `gasPriceError` is set;
 * `bundler` answers the three methods a send needs plus ZeroDev's own fee method.
 */
function fakeTransports(options: { gasPriceError?: Error; sendError?: Error } = {}) {
  const chainCalls: RpcCall[] = [];
  const bundlerCalls: RpcCall[] = [];
  /**
   * `core/rpc.ts` gives both endpoints three retries; the same count here, so a fallback is
   * reached the way it is reached in the widget — after the transport gave up — and a delay of
   * one millisecond instead of its 300, which is a wall-clock cost and not a behaviour.
   */
  const retry = { retryCount: 3, retryDelay: 1 } as const;
  const chainTransport = custom({
    request: async ({ method, params }: RpcCall) => {
      chainCalls.push({ method, params });
      if (method === "eth_gasPrice") {
        if (options.gasPriceError) throw options.gasPriceError;
        return numberToHex(CHAIN_GAS_PRICE);
      }
      if (method === "eth_chainId") return numberToHex(chain.id);
      throw new Error(`unexpected chain method ${method}`);
    },
  }, retry);
  const bundlerTransport = custom({
    request: async ({ method, params }: RpcCall) => {
      bundlerCalls.push({ method, params });
      if (method === "zd_getUserOperationGasPrice") {
        return {
          standard: {
            maxFeePerGas: numberToHex(BUNDLER_FEES.maxFeePerGas),
            maxPriorityFeePerGas: numberToHex(BUNDLER_FEES.maxPriorityFeePerGas),
          },
        };
      }
      if (method === "eth_estimateUserOperationGas") {
        return {
          callGasLimit: numberToHex(100_000n),
          preVerificationGas: numberToHex(50_000n),
          verificationGasLimit: numberToHex(80_000n),
        };
      }
      if (method === "eth_sendUserOperation") {
        if (options.sendError) throw options.sendError;
        return userOpHash;
      }
      if (method === "eth_getUserOperationReceipt") {
        return {
          userOpHash,
          entryPoint: address,
          sender: address,
          nonce: numberToHex(9n),
          success: true,
          actualGasCost: numberToHex(1n),
          actualGasUsed: numberToHex(2n),
          logs: [],
          receipt: { transactionHash, blockNumber: numberToHex(100n), logs: [], status: "0x1" },
        };
      }
      if (method === "eth_chainId") return numberToHex(chain.id);
      throw new Error(`unexpected bundler method ${method}`);
    },
  }, retry);
  return { chainCalls, bundlerCalls, chainTransport, bundlerTransport };
}

/** A kernel client built the way `createFluentZeroDevKernelClient` builds one. */
function setup(
  options: {
    feeSource?: "chain" | "bundler";
    gasPriceError?: Error;
    sendError?: Error;
  } = {},
) {
  const transports = fakeTransports(options);
  const publicClient = createPublicClient({ chain, transport: transports.chainTransport });
  const account = fakeAccount();
  const client = createKernelAccountClient({
    account: asSmartAccount(account),
    chain,
    bundlerTransport: transports.bundlerTransport,
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: createFluentUserOperationFeeHook({
        readGasPrice: () => publicClient.getGasPrice(),
        readFeeSource: () => options.feeSource ?? "chain",
      }),
    },
  });
  return { ...transports, account, client, publicClient };
}

function methodsOf(calls: RpcCall[]) {
  return calls.map((call) => call.method);
}

/** The operation as it reached the bundler, with its two fee fields. */
function submittedOperation(bundlerCalls: RpcCall[]) {
  const sent = bundlerCalls.find((call) => call.method === "eth_sendUserOperation");
  const params = sent?.params as
    | [{ maxFeePerGas: string; maxPriorityFeePerGas: string }]
    | undefined;
  const operation = params?.[0];
  if (!operation) throw new Error("no eth_sendUserOperation request was made");
  return {
    maxFeePerGas: BigInt(operation.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(operation.maxPriorityFeePerGas),
  };
}

describe("quoteFluentChainFees", () => {
  it("takes eth_gasPrice as the priority fee and 110 % of it as the cap", () => {
    expect(quoteFluentChainFees(CHAIN_GAS_PRICE)).toEqual({
      maxPriorityFeePerGas: CHAIN_GAS_PRICE,
      maxFeePerGas: 1_100_000_000n,
    });
  });

  it("rounds the cap down rather than up", () => {
    // 7 * 110 / 100 is 7.7 wei; a cap is a number of wei.
    expect(quoteFluentChainFees(7n).maxFeePerGas).toBe(7n);
    expect(quoteFluentChainFees(19n).maxFeePerGas).toBe(20n);
  });
});

describe("the fee hook on a send", () => {
  it("quotes the chain's eth_gasPrice as the priority fee", async () => {
    const { client, account, bundlerCalls, chainCalls } = setup({ feeSource: "chain" });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(submittedOperation(bundlerCalls).maxPriorityFeePerGas).toBe(CHAIN_GAS_PRICE);
    expect(methodsOf(chainCalls)).toContain("eth_gasPrice");
  });

  it("caps maxFeePerGas at the gas price times 110 divided by 100", async () => {
    const { client, account, bundlerCalls } = setup({ feeSource: "chain" });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(submittedOperation(bundlerCalls).maxFeePerGas).toBe(
      (CHAIN_GAS_PRICE * 110n) / 100n,
    );
  });

  it("asks the bundler for no gas price at all with fees from the chain", async () => {
    const { client, account, bundlerCalls } = setup({ feeSource: "chain" });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(methodsOf(bundlerCalls)).not.toContain("zd_getUserOperationGasPrice");
  });

  it("returns ZeroDev's quote unchanged with fees from the bundler", async () => {
    const { client, account, bundlerCalls } = setup({ feeSource: "bundler" });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(submittedOperation(bundlerCalls)).toEqual(BUNDLER_FEES);
  });

  it("asks ZeroDev for its gas price and nothing else with fees from the bundler", async () => {
    const { client, account, bundlerCalls, chainCalls } = setup({ feeSource: "bundler" });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(
      methodsOf(bundlerCalls).filter((method) => method === "zd_getUserOperationGasPrice"),
    ).toEqual(["zd_getUserOperationGasPrice"]);
    expect(methodsOf(chainCalls)).not.toContain("eth_gasPrice");
  });

  it("falls back to ZeroDev's quote when the chain's gas price cannot be read", async () => {
    const { client, account, bundlerCalls } = setup({
      feeSource: "chain",
      gasPriceError: new Error("fluent rpc unreachable"),
    });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(submittedOperation(bundlerCalls)).toEqual(BUNDLER_FEES);
  });

  it("completes a send with a receipt when the chain's gas price failed", async () => {
    const { client, account } = setup({
      feeSource: "chain",
      gasPriceError: new Error("fluent rpc unreachable"),
    });

    const hash = await client.sendUserOperation({
      account: asSmartAccount(account),
      calls: [{ to: address, data: "0x", value: 0n }],
    });
    const receipt = await client.waitForUserOperationReceipt({ hash, pollingInterval: 1 });

    expect(hash).toBe(userOpHash);
    expect(receipt.success).toBe(true);
    expect(receipt.receipt.transactionHash).toBe(transactionHash);
  });

  it("asks the chain again on the next send after a failed one", async () => {
    // One hook, two sends: the first one's fallback must not become the client's policy.
    const transports = fakeTransports();
    const publicClient = createPublicClient({ chain, transport: transports.chainTransport });
    const gasPrice = vi
      .fn<() => Promise<bigint>>()
      .mockRejectedValueOnce(new Error("fluent rpc unreachable"))
      .mockResolvedValue(CHAIN_GAS_PRICE);
    const account = fakeAccount();
    const client = createKernelAccountClient({
      account: asSmartAccount(account),
      chain,
      bundlerTransport: transports.bundlerTransport,
      client: publicClient,
      userOperation: {
        estimateFeesPerGas: createFluentUserOperationFeeHook({
          readGasPrice: gasPrice,
          readFeeSource: () => "chain",
        }),
      },
    });

    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });
    transports.bundlerCalls.length = 0;
    await client.sendUserOperation({ account: asSmartAccount(account), calls: CALLS });

    expect(gasPrice).toHaveBeenCalledTimes(2);
    expect(submittedOperation(transports.bundlerCalls).maxPriorityFeePerGas).toBe(CHAIN_GAS_PRICE);
  });

  it("obeys the attempt on the account over the configured source", async () => {
    const { client, account, bundlerCalls, chainCalls } = setup({ feeSource: "chain" });
    const attempt: FluentFeeAttempt = { feeSource: "bundler" };

    await client.sendUserOperation({
      account: withFluentFeeAttempt(asSmartAccount(account), attempt),
      calls: [{ to: address, data: "0x", value: 0n }],
    });

    expect(submittedOperation(bundlerCalls)).toEqual(BUNDLER_FEES);
    expect(methodsOf(chainCalls)).not.toContain("eth_gasPrice");
    expect(attempt.settledFeeSource).toBe("bundler");
  });

  it("reports the source that answered on the attempt, not the one it asked", async () => {
    const { client, account } = setup({
      feeSource: "chain",
      gasPriceError: new Error("fluent rpc unreachable"),
    });
    const attempt: FluentFeeAttempt = { feeSource: "chain" };

    await client.sendUserOperation({
      account: withFluentFeeAttempt(asSmartAccount(account), attempt),
      calls: [{ to: address, data: "0x", value: 0n }],
    });

    expect(attempt.settledFeeSource).toBe("bundler");
  });

  it("reports the chain as the source when the chain answered", async () => {
    const { client, account } = setup({ feeSource: "chain" });
    const attempt: FluentFeeAttempt = { feeSource: "chain" };

    await client.sendUserOperation({
      account: withFluentFeeAttempt(asSmartAccount(account), attempt),
      calls: [{ to: address, data: "0x", value: 0n }],
    });

    expect(attempt.settledFeeSource).toBe("chain");
  });
});

describe("the fee attempt on an account", () => {
  it("survives the spreads viem and ZeroDev make of an account", () => {
    const attempt: FluentFeeAttempt = { feeSource: "bundler" };
    const account = withFluentFeeAttempt(fakeAccount(), attempt);

    expect(readFluentFeeAttempt({ ...account, signUserOperation: async () => signature })).toBe(
      attempt,
    );
  });

  it("is absent from an account nobody marked", () => {
    expect(readFluentFeeAttempt(fakeAccount())).toBeUndefined();
    expect(readFluentFeeAttempt(undefined)).toBeUndefined();
  });
});

describe("readFluentBundlerFees", () => {
  it("reads the standard tier of zd_getUserOperationGasPrice", async () => {
    const { client, bundlerCalls } = setup();

    await expect(readFluentBundlerFees(client)).resolves.toEqual(BUNDLER_FEES);
    expect(methodsOf(bundlerCalls)).toEqual(["zd_getUserOperationGasPrice"]);
  });
});

describe("isFluentFeeRejection", () => {
  /** How viem wraps a bundler's `eth_sendUserOperation` rejection, outer error included. */
  function bundlerRejection(message: string) {
    return new BaseError("UserOperation failed", {
      cause: new RpcRequestError({
        body: { method: "eth_sendUserOperation", params: [] },
        error: { code: -32602, message },
        url: "https://rpc.zerodev.app/api/v3/project/chain/20994",
      }),
    });
  }

  it("recognises the bundler's fee rejection through viem's wrappers", () => {
    expect(
      isFluentFeeRejection(bundlerRejection("maxFeePerGas must be at least 1100000000")),
    ).toBe(true);
  });

  it("recognises the bundler's priority fee rejection through viem's wrappers", () => {
    expect(
      isFluentFeeRejection(bundlerRejection("maxPriorityFeePerGas must be at least 1000000")),
    ).toBe(true);
  });

  it("recognises it whatever case the bundler wrote it in", () => {
    expect(isFluentFeeRejection(bundlerRejection("MaxFeePerGas Must Be At Least 1"))).toBe(true);
  });

  it("leaves a validation failure to the caller", () => {
    expect(isFluentFeeRejection(bundlerRejection("AA23 reverted: account validation failed"))).toBe(
      false,
    );
  });

  it("leaves a policy denial to the sponsorship path", () => {
    expect(
      isFluentFeeRejection(
        bundlerRejection("userOp did not match any gas sponsoring policies"),
      ),
    ).toBe(false);
  });

  it("leaves an unrelated failure alone", () => {
    expect(isFluentFeeRejection(new Error("fetch failed"))).toBe(false);
    expect(isFluentFeeRejection(undefined)).toBe(false);
    expect(isFluentFeeRejection("maxFeePerGas must be at least 1")).toBe(true);
  });
});
