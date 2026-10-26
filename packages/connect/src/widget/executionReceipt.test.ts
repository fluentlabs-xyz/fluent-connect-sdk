/**
 * What a send hands back once its operation is included, through the smart account, the widget
 * API and an External wallet.
 *
 * `sendCalls` and `sendCallsViaExternalWallet` are imported and called directly. Fakes, and
 * nothing else:
 * - the kernel's bundler clients (own gas, sponsored, and the ERC-20 gas client
 *   `createKernelAccountClient` would build), each answering `sendUserOperation` and
 *   `waitForUserOperationReceipt`;
 * - `fetch`, where the ZeroDev ERC-20 paymaster answers `zd_pm_accounts` with its address, the one
 *   request the approval call of a token-paid send makes;
 * - the Fluent token source of a sponsored send;
 * - the External wallet's client and the widget chain's public client.
 *
 * `useWidgetExecution`'s send is still read out of its source and run with its free variables
 * supplied, because it lives inside that hook.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, zeroAddress, type Address } from "viem";
import { createKernelAccountClient } from "@zerodev/sdk";
import ts from "typescript";

import { FLUENT_CONNECT_DEFAULT_EXECUTION } from "../core/config";
import { setDebugLogging } from "../core/debugLogger";
import { getFluentGasTokenAddress } from "../core/gasPayment";
import type { FluentBatchOperationExecuteOptions } from "./batchOperation";
import { sendCallsViaExternalWallet } from "./sendCallsViaExternalWallet";
import {
  sendCalls,
  type FluentZeroDevKernel,
  type FluentZeroDevSendContext,
} from "./zerodevSession";

vi.mock("@zerodev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zerodev/sdk")>()),
  // The ERC-20 gas client: a token-paid send builds it for itself, and `setup` hands it the fake.
  createKernelAccountClient: vi.fn(),
}));

/** `useWidgetExecution.ts`, compiled, for the one callback below that lives inside that hook. */
const widgetExecutionSource = ts.transpileModule(
  readFileSync(new URL("./hooks/useWidgetExecution.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const hash = `0x${"1".repeat(64)}`;
const userOpHash = `0x${"2".repeat(64)}`;
const receipt = {
  transactionHash: hash,
  blockHash: hash,
  blockNumber: 100n,
  status: "success",
  logs: [],
};
const calls = [{ to: zeroAddress, data: "0x" as const, value: 0n }];

/** `useWidgetExecution`'s `sendCalls`, verbatim, as a script whose value is the callback. */
function widgetExecutionCallback() {
  const begin = widgetExecutionSource.indexOf(
    "const sendCalls = useCallback(",
    widgetExecutionSource.indexOf("function useWidgetExecution("),
  );
  const end = widgetExecutionSource.indexOf("\n    const ", begin + 1);
  return widgetExecutionSource.slice(begin, end) + "\nsendCalls;";
}

/** The ERC-20 paymaster's account, the address its `zd_pm_accounts` answers with. */
const ERC20_PAYMASTER = "0x9999999999999999999999999999999999999999" as Address;

/**
 * The network as a token-paid send reaches it before its submission: the ZeroDev ERC-20
 * paymaster, asked which account the approval names. Any other request is a test defect.
 */
function stubPaymasterNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { id?: unknown; method?: string };
      if (body.method !== "zd_pm_accounts") {
        throw new Error(`unexpected request ${body.method}`);
      }
      const answer = { jsonrpc: "2.0", id: body.id, result: [ERC20_PAYMASTER] };
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDebugLogging(false);
});

function setup(mode: string) {
  // A bundler's user-operation receipt, as `viem@2.52.0` returns it: the paymaster is the zero
  // address, the answer for every mode here, since the fakes below settle no paymaster on chain.
  const operation = { userOpHash, success: true, paymaster: zeroAddress, logs: [], receipt };
  const client = () => ({
    sendUserOperation: vi.fn().mockResolvedValue(userOpHash),
    waitForUserOperationReceipt: vi.fn().mockResolvedValue(operation),
  });
  const own = client(),
    sponsored = client(),
    token = client();
  // Safe: a send reaches nothing on a kernel client but the two methods the fake answers.
  const asClient = (fake: typeof own) => fake as unknown as FluentZeroDevKernel["client"];
  vi.mocked(createKernelAccountClient).mockReturnValue(asClient(token));
  stubPaymasterNetwork();
  if (mode === "fallback")
    sponsored.sendUserOperation.mockRejectedValue(
      Object.assign(new Error("paymaster unavailable"), { status: 403 }),
    );
  const kernelFake = {
    client: own,
    // The account carries its EntryPoint, which is the address the chain-side inclusion wait
    // reads the `UserOperationEvent` of — a real kernel account always has it.
    account: { entryPoint: { address: zeroAddress } },
    chain: { id: 20994 },
    signerSource: "privy",
    // The widget chain's public client, which the send reads the including block's timestamp
    // through once the receipt is already in hand.
    publicClient: {
      getBlock: vi.fn(async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
    },
  };
  // Safe: only the members a send that waits on the bundler reads.
  const kernel = kernelFake as unknown as FluentZeroDevKernel;
  const getAuthToken = vi.fn(async () => "fixture");
  const context: FluentZeroDevSendContext = {
    kernels: { silent: kernel, prompt: kernel },
    initialize: async () => kernel,
    error: null,
    network: "testnet",
    /**
     * These two files drive the bundler's own fee quote and receipt poll — what the widget did
     * before FLU-1591, and what every assertion below is written against. The chain's sources
     * have their own tests in `core/userOperationFees.test.ts`,
     * `core/userOperationReceipt.test.ts` and `zerodevSession.send.test.ts`.
     */
    readExecution: () => ({
      ...FLUENT_CONNECT_DEFAULT_EXECUTION,
      feeSource: "bundler",
      receiptSource: "bundler",
      chainCheckBeforeSign: false,
    }),
    ...(["sponsored", "fallback"].includes(mode)
      ? {
          sponsorshipUrl: "https://unused.invalid",
          appId: "test",
          sponsorshipTokenSource: () => ({
            accountType: "smart" as const,
            getAuthToken,
          }),
        }
      : {}),
    sponsorshipUnavailable: { current: false },
    createSponsoredClient: () => () => asClient(sponsored),
  };
  const send = (sent: typeof calls, options?: FluentBatchOperationExecuteOptions) =>
    sendCalls(context, sent, options);
  return { send, own, sponsored, token, operation, getAuthToken, kernel: kernelFake };
}

/**
 * Every line the widget's debug logger writes while `run` runs, with debug logging on and the
 * host's console as the writer. `write` is what that console does with each line's label.
 */
async function withDebugLogging(
  run: () => Promise<void>,
  write: (label: unknown) => void = () => {},
): Promise<unknown[][]> {
  setDebugLogging(true);
  const written: unknown[][] = [];
  const hostConsole = vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
    written.push(line);
    write(line[0]);
  });
  // A send that fails reports it through `debugError`; the failure itself is what a test asserts.
  const hostErrors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
  } finally {
    hostConsole.mockRestore();
    hostErrors.mockRestore();
    setDebugLogging(false);
  }
  return written;
}

/** The `[fluent execution timing]` line's `timing`, which is the same object the send returns. */
function loggedTiming(written: unknown[][]) {
  const line = written.find(([label]) => label === "[fluent execution timing]");
  return (line?.[1] as { timing?: Record<string, unknown> & { instants: { attempts: number } } })
    ?.timing;
}

describe("Connect receipt delivery", () => {
  it.each(["own", "sponsored", "fallback", "token"])(
    "passes an execution limit with the complete batch for %s gas",
    async (mode) => {
      const { send, own, sponsored, token } = setup(mode);
      await send(calls, {
        confirmation: "silent",
        userOperationGas: { callGasLimit: 500_000n },
        ...(mode === "token" ? {
          gasPayment: { symbol: "BLEND", includeApproval: true, approveAmount: 1n },
        } : {}),
      });
      const clients = mode === "fallback" ? [sponsored, own]
        : [mode === "sponsored" ? sponsored : mode === "token" ? token : own];
      for (const client of clients) {
        expect(client.sendUserOperation).toHaveBeenCalledWith(expect.objectContaining({ callGasLimit: 500_000n }));
        const submitted = client.sendUserOperation.mock.calls[0]![0];
        expect(submitted.calls).toHaveLength(mode === "token" ? 2 : 1);
        // The approval the paymaster needs, ahead of the batch: the Gas token's `approve` of the
        // account the paymaster named, for the amount the caller asked.
        if (mode === "token") {
          expect(submitted.calls[0]).toEqual({
            to: getFluentGasTokenAddress("BLEND", "testnet"),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [ERC20_PAYMASTER, 1n],
            }),
            value: 0n,
          });
        }
      }
    },
  );
  it("rejects invalid gas before submission or sponsorship authentication", async () => {
    const { send, own, sponsored, getAuthToken } = setup("sponsored");
    await expect(send(calls, { userOperationGas: { callGasLimit: 0n } })).rejects.toThrow("callGasLimit");
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(own.sendUserOperation).not.toHaveBeenCalled();
    expect(sponsored.sendUserOperation).not.toHaveBeenCalled();
  });
  it("skips both sponsorship authentication and paymaster execution for direct ETH", async () => {
    const { send, own, sponsored, token, getAuthToken } = setup("sponsored");
    const result = await send(calls, {
      confirmation: "silent",
      gasPayment: { symbol: "ETH", sponsorship: "never" },
    });
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(sponsored.sendUserOperation).not.toHaveBeenCalled();
    expect(token.sendUserOperation).not.toHaveBeenCalled();
    expect(own.sendUserOperation).toHaveBeenCalledOnce();
    expect(result.sponsorshipReason).toBe("not_requested");
    expect(result.receipt).toBe(receipt);
  });
  it.each(["own", "sponsored", "fallback", "token"])(
    "returns the included receipt with fast polling for %s gas",
    async (mode) => {
      const { send, own, sponsored, token } = setup(mode);
      const result = await send(calls, {
        confirmation: "silent",
        ...(mode === "token" ? { gasPayment: { symbol: "BLEND" } } : {}),
      });
      const settlement =
        mode === "sponsored" ? sponsored : mode === "token" ? token : own;
      expect(
        settlement.waitForUserOperationReceipt,
      ).toHaveBeenCalledExactlyOnceWith({
        hash: userOpHash,
        pollingInterval: 200,
        timeout: 120000,
      });
      expect(result.receipt).toBe(receipt);
      expect(result.userOpHash).toBe(userOpHash);
      expect(result.hash).toBe(hash);
      // `debugLogging` is off here — the tests below that turn it on restore it — and the
      // caller still receives the stages: that is the whole behaviour FLU-1522 adds. A fallback
      // submitted twice and says so.
      expect(result.timing?.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.timing?.prepareMs).toBeGreaterThanOrEqual(0);
      expect(result.timing?.retryMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.timing?.inclusionMs).toBe("number");
      expect(typeof result.timing?.detectMs).toBe("number");
      expect(result.timing?.instants.attempts).toBe(mode === "fallback" ? 2 : 1);
    },
  );
  it("rejects a failed UserOperation even when its outer transaction succeeded", async () => {
    const { send, operation } = setup("own");
    operation.success = false;
    await expect(send(calls, { confirmation: "silent" })).rejects.toThrow(
      "execution failed",
    );
  });
  /**
   * A UserOperation that reverted still spent its seconds somewhere, and that is exactly the
   * breakdown worth having — so the timeline is closed before the revert check, not after. The
   * send still throws: the stages are recorded for the operator, not returned to the caller.
   */
  it("still measures a send whose UserOperation reverted", async () => {
    const { send, operation, kernel } = setup("own");
    operation.success = false;
    const written = await withDebugLogging(async () => {
      await expect(send(calls, { confirmation: "silent" })).rejects.toThrow("execution failed");
    });
    const timing = loggedTiming(written);
    expect(kernel.publicClient.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
    expect(timing?.prepareMs).toBeGreaterThanOrEqual(0);
    expect(timing?.totalMs).toBeGreaterThanOrEqual(0);
    expect(timing?.retryMs).toBe(0);
    expect(timing?.instants.attempts).toBe(1);
    expect(typeof timing?.inclusionMs).toBe("number");
    expect(typeof timing?.detectMs).toBe("number");
  });
  /**
   * The moment requirement 7 exists for. The operation has settled, the gas is spent, and the
   * only broken thing is the clock the timeline is drawn on — including the readings the
   * diagnostics in the wait's `finally` take once the receipt is already in hand. The send hands
   * back that receipt; the timeline is what the failure costs, and all it costs.
   */
  it("returns the settled receipt when the clock fails the instant it arrives", async () => {
    const { send, own, operation, kernel } = setup("own");
    const clockError = new Error("clock unreadable");
    let unreadable = false;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => {
      if (unreadable) throw clockError;
      return 0;
    });
    own.waitForUserOperationReceipt.mockImplementation(async () => {
      unreadable = true;
      return operation;
    });
    let result;
    try {
      result = await send(calls, { confirmation: "silent" });
    } finally {
      clock.mockRestore();
    }
    expect(result.hash).toBe(hash);
    expect(result.userOpHash).toBe(userOpHash);
    expect(result.receipt).toBe(receipt);
    expect(result.timing).toBeUndefined();
    // Nothing was resubmitted to obtain a measurable operation, and no block was read for a
    // timeline there is none of.
    expect(own.sendUserOperation).toHaveBeenCalledOnce();
    expect(kernel.publicClient.getBlock).not.toHaveBeenCalled();
  });
  /**
   * The other half of requirement 7, and the one a non-throwing `debugLog` hid for three review
   * rounds: the clock is fine and the *writer* is broken. `debugLogging` on is the configuration
   * where this bites, because only then is a stage line actually written, and the console it is
   * written to is the host's to patch.
   *
   * The `submitted` line is why this matters more than a lost log line. It is written after the
   * bundler accepted the operation and before the receipt is waited for, so an unguarded throw
   * there rejects a send that has already been made and takes `userOpHash` — the only name the
   * caller has for it — down with it. The same holds for the two lines in a `finally`, which run
   * with the receipt in hand.
   */
  it("returns the settled receipt when every timing diagnostic throws", async () => {
    // The configuration this hazard needs: `debugLogging` on, so the stage lines are really
    // written, and a host console that throws when they are. It is scoped to the timeline's own
    // labels; the base's `[fluent zerodev] …` operational logs are not timing instrumentation and
    // are deliberately left as they are, outside this test's subject. The send and
    // `sendUserOperationWithTiming` both write through the widget's one debug logger, so this one
    // console is what every timing line of the send reaches.
    const writeError = new Error("host console is patched");
    const timingLabel = (label: unknown) =>
      typeof label === "string" &&
      label.startsWith("[fluent ") &&
      !label.startsWith("[fluent zerodev]");
    const { send, own, kernel } = setup("own");
    let result: Awaited<ReturnType<typeof send>> | undefined;
    const written = await withDebugLogging(
      async () => {
        result = await send(calls, { confirmation: "silent" });
      },
      (label) => {
        if (timingLabel(label)) throw writeError;
      },
    );
    // `debugLogging` was on and the module's own diagnostics really reached the broken console.
    expect(written.filter(([label]) => timingLabel(label)).length).toBeGreaterThan(0);
    // The outcome reaches the caller unchanged.
    expect(result?.receipt).toBe(receipt);
    expect(result?.hash).toBe(hash);
    expect(result?.userOpHash).toBe(userOpHash);
    // And so does the timeline: what failed is the writer, not the measurement.
    expect(result?.timing?.totalMs).toBeGreaterThanOrEqual(0);
    expect(result?.timing?.prepareMs).toBeGreaterThanOrEqual(0);
    expect(result?.timing?.instants.attempts).toBe(1);
    // The hazard was really exercised: these three writes were attempted and each one threw.
    expect(written).toContainEqual(["[fluent execution stage]", { stage: "setup" }]);
    expect(written).toContainEqual([
      "[fluent execution stage]",
      { stage: "submitted", userOpHash },
    ]);
    expect(written).toContainEqual([
      "[fluent execution timing]",
      expect.objectContaining({ userOpHash }),
    ]);
    // Nothing was resubmitted to recover from the writer, and the receipt was waited for once.
    expect(own.sendUserOperation).toHaveBeenCalledOnce();
    expect(own.waitForUserOperationReceipt).toHaveBeenCalledExactlyOnceWith({
      hash: userOpHash,
      pollingInterval: 200,
      timeout: 120000,
    });
    expect(kernel.publicClient.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });
  it("preserves the receipt and operation hash through the widget API", async () => {
    const timing = { prepareMs: 1, retryMs: 0, totalMs: 2, instants: { attempts: 1 } };
    const sendCalls = vi
      .fn()
      .mockResolvedValue({ hash, userOpHash, receipt, sponsored: false, timing });
    const send = runInNewContext(widgetExecutionCallback(), {
      useCallback: (fn: unknown) => fn,
      fluentAccountReady: true,
      smartAccount: { sendCalls },
      wallet: null,
      chain: {},
      eoaPublicClient: {},
      refreshBalances() {},
      track() {},
    });
    const result = await send(calls, { confirmation: "silent" });
    expect(result.receipt).toBe(receipt);
    expect(result.userOpHash).toBe(userOpHash);
    // This callback rebuilds the result field by field, so a field it forgets is a field no host
    // ever sees.
    expect(result.timing).toBe(timing);
  });
  it("returns the last EOA receipt and stops a sequential batch on a revert", async () => {
    // Safe: the External wallet send reaches nothing on these but the members the fakes answer.
    const send = (
      sent: typeof calls,
      wallet: unknown,
      chain: unknown,
      publicClient: unknown,
    ) =>
      sendCallsViaExternalWallet(
        sent,
        wallet as Parameters<typeof sendCallsViaExternalWallet>[1],
        chain as Parameters<typeof sendCallsViaExternalWallet>[2],
        publicClient as Parameters<typeof sendCallsViaExternalWallet>[3],
      );
    const wallet = {
      address: zeroAddress,
      switchChain: vi.fn(),
      walletClient: { sendTransaction: vi.fn().mockResolvedValue(hash) },
    };
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    };
    expect(
      (await send(calls, wallet, { id: 20994 }, publicClient)).receipt,
    ).toBe(receipt);
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash,
      pollingInterval: 200,
      timeout: 120000,
    });
    wallet.walletClient.sendTransaction.mockClear();
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      ...receipt,
      status: "reverted",
    });
    await expect(
      send([...calls, ...calls], wallet, { id: 20994 }, publicClient),
    ).rejects.toThrow("reverted");
    expect(wallet.walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
