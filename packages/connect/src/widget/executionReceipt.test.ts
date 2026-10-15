import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import ts from "typescript";
import {
  closeSendTiming,
  epochNow,
  monotonicNow,
  sendUserOperationWithTiming,
  span,
} from "../core/userOperationTiming";
import { validateUserOperationGas } from "../core/userOperationGas";
import {
  resolveSponsorshipBearer,
  sendWithSponsorship,
} from "../core/sponsoredClient";
import { isDebugLoggingEnabled, setDebugLogging } from "../core/debugLogger";

function compiled(path: string) {
  return ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
}
const source = [
  compiled("./zerodevSession.ts"),
  compiled("./hooks/useWidgetExecution.ts"),
  compiled("./sendCallsViaExternalWallet.ts"),
].join("\n");
const hash = `0x${"1".repeat(64)}`;
const userOpHash = `0x${"2".repeat(64)}`;
const receipt = {
  transactionHash: hash,
  blockHash: hash,
  blockNumber: 100n,
  status: "success",
  logs: [],
};
const calls = [{ to: zeroAddress, data: "0x", value: 0n }];

function callback(start: string) {
  const begin = source.indexOf(
    "const sendCalls = useCallback(",
    source.indexOf(start),
  );
  const end = source.indexOf("\n    const ", begin + 1);
  return source.slice(begin, end) + "\nsendCalls;";
}
/**
 * `debugLog` is injectable because a diagnostic writer that throws is a configuration the send
 * has to survive, not an edge case: `debugLogging` on means these lines are actually written, and
 * the console they are written to belongs to the host.
 */
function setup(mode: string, debugLog: ReturnType<typeof vi.fn> = vi.fn()) {
  const operation = { success: true, receipt };
  const client = () => ({
    sendUserOperation: vi.fn().mockResolvedValue(userOpHash),
    waitForUserOperationReceipt: vi.fn().mockResolvedValue(operation),
  });
  const own = client(),
    sponsored = client(),
    token = client();
  if (mode === "fallback")
    sponsored.sendUserOperation.mockRejectedValue(
      Object.assign(new Error("paymaster unavailable"), { status: 403 }),
    );
  const kernel = {
    client: own,
    account: {},
    chain: { id: 20994 },
    signerSource: "privy",
    // The widget chain's public client, which the send reads the including block's timestamp
    // through once the receipt is already in hand.
    publicClient: {
      getBlock: vi.fn(async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
    },
  };
  const getAuthToken = vi.fn(async () => "fixture");
  const send = runInNewContext(callback("function useFluentZeroDevAccount("), {
    performance,
    sendUserOperationWithTiming,
    closeSendTiming,
    monotonicNow,
    epochNow,
    span,
    validateUserOperationGas,
    useCallback: (fn: unknown) => fn,
    authenticated: true,
    ready: true,
    network: "testnet",
    error: null,
    embeddedWallet: {},
    hostedSigner: null,
    hookOptions: ["sponsored", "fallback"].includes(mode)
      ? {
          sponsorshipUrl: "https://unused.invalid",
          appId: "test",
          sponsorshipTokenSource: () => ({
            accountType: "smart",
            getAuthToken,
          }),
        }
      : {},
    kernels: { silent: kernel, prompt: kernel },
    initialize: async () => kernel,
    confirmationToSignerMode: (mode: string) =>
      mode === "session" ? "silent" : "prompt",
    createSponsoredClient: () => () => sponsored,
    resolveSponsorshipBearer,
    sendWithSponsorship,
    sponsorshipLog: { debug() {}, warn() {} },
    createFluentZeroDevErc20ExecutionClient: () => token,
    createFluentZeroDevErc20PaymasterApprovalCall: async () => ({ to: zeroAddress, data: "0x1234", value: 0n }),
    getFluentGasTokenAddress: (symbol: string) => symbol === "ETH" ? undefined : "token-address",
    getSponsorshipFailure: () => ({
      reason: "unauthorized",
      disableSponsorship: true,
    }),
    sponsorshipUnavailable: { current: false },
    readUserOperationPaymaster: () => zeroAddress,
    zeroAddress,
    setPromptSigningContext() {},
    clearPromptSigningContext() {},
    debugLog,
    debugWarn() {},
    debugError() {},
  });
  return { send, own, sponsored, token, operation, getAuthToken, debugLog, kernel };
}

/** The `[fluent execution timing]` line's `timing`, which is the same object the send returns. */
function loggedTiming(debugLog: ReturnType<typeof vi.fn>) {
  const line = debugLog.mock.calls.find(([label]) => label === "[fluent execution timing]");
  return line?.[1]?.timing;
}

describe("Connect receipt delivery", () => {
  it.each(["own", "sponsored", "fallback", "token"])(
    "passes an execution limit with the complete batch for %s gas",
    async (mode) => {
      const { send, own, sponsored, token } = setup(mode);
      await send(calls, {
        confirmation: "session",
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
        if (mode === "token") expect(submitted.calls[0].data).toBe("0x1234");
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
      confirmation: "session",
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
        confirmation: "session",
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
      // `debugLogging` is off here — the one test below that turns it on restores it — and the
      // caller still receives the stages: that is the whole behaviour FLU-1522 adds. A fallback
      // submitted twice and says so.
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.timing.prepareMs).toBeGreaterThanOrEqual(0);
      expect(result.timing.retryMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.timing.inclusionMs).toBe("number");
      expect(typeof result.timing.detectMs).toBe("number");
      expect(result.timing.instants.attempts).toBe(mode === "fallback" ? 2 : 1);
    },
  );
  it("rejects a failed UserOperation even when its outer transaction succeeded", async () => {
    const { send, operation } = setup("own");
    operation.success = false;
    await expect(send(calls, { confirmation: "session" })).rejects.toThrow(
      "execution failed",
    );
  });
  /**
   * A UserOperation that reverted still spent its seconds somewhere, and that is exactly the
   * breakdown worth having — so the timeline is closed before the revert check, not after. The
   * send still throws: the stages are recorded for the operator, not returned to the caller.
   */
  it("still measures a send whose UserOperation reverted", async () => {
    const { send, operation, debugLog, kernel } = setup("own");
    operation.success = false;
    await expect(send(calls, { confirmation: "session" })).rejects.toThrow(
      "execution failed",
    );
    const timing = loggedTiming(debugLog);
    expect(kernel.publicClient.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
    expect(timing.prepareMs).toBeGreaterThanOrEqual(0);
    expect(timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(timing.retryMs).toBe(0);
    expect(timing.instants.attempts).toBe(1);
    expect(typeof timing.inclusionMs).toBe("number");
    expect(typeof timing.detectMs).toBe("number");
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
      result = await send(calls, { confirmation: "session" });
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
    // written, and a writer that throws when they are. It is scoped to the timeline's own labels;
    // the base's `[fluent zerodev] …` operational logs are not timing instrumentation and are
    // deliberately left as they are, outside this test's subject.
    const writeError = new Error("host console is patched");
    const timingLabel = (label: unknown) =>
      typeof label === "string" &&
      label.startsWith("[fluent ") &&
      !label.startsWith("[fluent zerodev]");
    const debugLog = vi.fn();
    debugLog.mockImplementation((label: string) => {
      if (timingLabel(label)) throw writeError;
    });
    const { send, own, kernel } = setup("own", debugLog);
    // The widget's writer is injected, but `sendUserOperationWithTiming` holds the real one, and
    // it writes nothing unless `debugLogging` is on — so turn it on and patch the console it
    // writes to, which is exactly the host's hazard. Restored however the send ends.
    const wasDebugLogging = isDebugLoggingEnabled();
    setDebugLogging(true);
    let hostWrites = 0;
    const hostConsole = vi.spyOn(console, "log").mockImplementation((...args) => {
      if (!timingLabel(args[0])) return;
      hostWrites += 1;
      throw writeError;
    });
    let result;
    try {
      result = await send(calls, { confirmation: "session" });
    } finally {
      hostConsole.mockRestore();
      setDebugLogging(wasDebugLogging);
    }
    // `debugLogging` was on and the module's own diagnostics really reached the broken console.
    expect(hostWrites).toBeGreaterThan(0);
    // The outcome reaches the caller unchanged.
    expect(result.receipt).toBe(receipt);
    expect(result.hash).toBe(hash);
    expect(result.userOpHash).toBe(userOpHash);
    // And so does the timeline: what failed is the writer, not the measurement.
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.prepareMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.instants.attempts).toBe(1);
    // The hazard was really exercised: these three writes were attempted and each one threw.
    expect(debugLog).toHaveBeenCalledWith("[fluent execution stage]", { stage: "setup" });
    expect(debugLog).toHaveBeenCalledWith("[fluent execution stage]", {
      stage: "submitted",
      userOpHash,
    });
    expect(debugLog).toHaveBeenCalledWith(
      "[fluent execution timing]",
      expect.objectContaining({ userOpHash }),
    );
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
    const send = runInNewContext(callback("function useWidgetExecution("), {
      useCallback: (fn: unknown) => fn,
      fluentAccountReady: true,
      smartAccount: { sendCalls },
      wallet: null,
      chain: {},
      eoaPublicClient: {},
      refreshBalances() {},
      track() {},
    });
    const result = await send(calls, { confirmation: "session" });
    expect(result.receipt).toBe(receipt);
    expect(result.userOpHash).toBe(userOpHash);
    // This callback rebuilds the result field by field, so a field it forgets is a field no host
    // ever sees.
    expect(result.timing).toBe(timing);
  });
  it("returns the last EOA receipt and stops a sequential batch on a revert", async () => {
    const start = source.indexOf("async function sendCallsViaExternalWallet(");
    const end = source.length;
    const send = runInNewContext(
      source.slice(start, end) + "\nsendCallsViaExternalWallet;",
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
