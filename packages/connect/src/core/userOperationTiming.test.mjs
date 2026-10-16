import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKernelAccountClient } from "@zerodev/sdk";
import { custom, numberToHex, HttpRequestError } from "viem";
import ts from "typescript";
import { closeSendTiming, sendUserOperationWithTiming } from "./userOperationTiming";
import { sendWithSponsorship } from "./sponsoredClient";
import { setDebugLogging } from "./debugLogger";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"2".repeat(64)}`;
const signature = `0x${"3".repeat(130)}`;
const chain = { id: 20994, name: "Fluent", rpcUrls: { default: { http: [] } } };
const source = ts.transpileModule(
  readFileSync(new URL("../widget/zerodevSession.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;
const begin = source.indexOf("async function ensureWalletOnFluentChain(");
const end = source.length;
const ensureChain = runInNewContext(source.slice(begin, end) + "\nensureWalletOnFluentChain;", {
  numberToHex,
  debugLog() {},
});

afterEach(() => {
  vi.restoreAllMocks();
  setDebugLogging(false);
});

describe("Connect submission boundaries", () => {
  /**
   * The behaviour this Issue exists for. Before it, `sendUserOperationWithTiming` opened with
   * `if (!isDebugLoggingEnabled()) return client.sendUserOperation(args)` — so a host that had not
   * turned on a console flag measured nothing, and a host that had got console lines it could not
   * read back. The stages are collected either way now, and returned either way.
   */
  it("measures and returns the stages with diagnostics off, and still logs nothing", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const sign = vi.fn(async () => {
      now += 2000;
      return signature;
    });
    const account = { address, signUserOperation: sign };
    const client = {
      sendUserOperation: vi.fn(async (args) => {
        now += 1000;
        await args.account.signUserOperation({});
        now += 700;
        return hash;
      }),
    };
    const submission = await sendUserOperationWithTiming(client, { account, calls: [] });
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement).toMatchObject({
      prepareMs: 1000,
      signMs: 2000,
      broadcastMs: 700,
    });
    expect(log).not.toHaveBeenCalled();
    // The one boundary in the path is the observed account, so the caller's own account is not
    // what the client receives — while the signer it wraps is still the caller's, unwrapped.
    expect(client.sendUserOperation.mock.calls[0][0].account).not.toBe(account);
    expect(account.signUserOperation).toBe(sign);
  });
  it("measures the real ZeroDev prepare/sign/send flow without repeating or changing it", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    setDebugLogging(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const nonce = vi.fn(async () => {
      now += 300;
      return 9n;
    });
    const sign = vi.fn(async function (operation) {
      expect(this).toBe(account);
      expect(operation.nonce).toBe(9n);
      now += 2000;
      return signature;
    });
    const account = {
      address,
      type: "smart",
      entryPoint: { address, version: "0.7" },
      getFactoryArgs: async () => ({}),
      encodeCalls: async () => "0x1234",
      getNonce: nonce,
      getStubSignature: async () => `0x${"4".repeat(130)}`,
      signUserOperation: sign,
    };
    const request = vi.fn(async ({ method, params }) => {
      if (method === "eth_estimateUserOperationGas") {
        now += 700;
        return {
          callGasLimit: "0x10000",
          preVerificationGas: "0x10000",
          verificationGasLimit: "0x10000",
        };
      }
      expect(method).toBe("eth_sendUserOperation");
      expect(params[0]).toMatchObject({
        sender: address,
        nonce: "0x9",
        callData: "0x1234",
        signature,
      });
      expect(params[1]).toBe(address);
      now += 700;
      return hash;
    });
    const client = createKernelAccountClient({
      account,
      chain,
      bundlerTransport: custom({ request }),
      userOperation: {
        estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      },
    });
    const calls = [{ to: address, data: "0x1234", value: 0n }];
    const submission = await sendUserOperationWithTiming(client, { account, calls });
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement).toMatchObject({
      prepareMs: 1000,
      signMs: 2000,
      broadcastMs: 700,
    });
    expect(nonce).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledOnce();
    expect(account.signUserOperation).toBe(sign);
    expect(request.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_estimateUserOperationGas",
      "eth_sendUserOperation",
    ]);
    expect(log).toHaveBeenCalledWith("[fluent submission timing]", {
      success: true,
      preparationMs: 1000,
      signingMs: 2000,
      broadcastMs: 700,
      // One submission's span, and named so it cannot be read as the send's `totalMs`, which
      // runs on to the receipt.
      submissionMs: 3700,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(signature);
    expect(JSON.stringify(log.mock.calls)).not.toContain("0x1234");
  });

  it.each(["preparing", "signing", "broadcasting"])(
    "propagates failures while %s without retrying the send",
    async (stage) => {
      const error = new Error("failure");
      setDebugLogging(true);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const account = {
        signUserOperation: vi.fn(async () => {
          if (stage === "signing") throw error;
          return signature;
        }),
      };
      const client = {
        sendUserOperation: vi.fn(async ({ account }) => {
          if (stage === "preparing") throw error;
          await account.signUserOperation({});
          throw error;
        }),
      };
      await expect(sendUserOperationWithTiming(client, { account })).rejects.toBe(error);
      // A failed submission returns nothing to measure; what it did reach is still logged.
      expect(client.sendUserOperation).toHaveBeenCalledOnce();
      expect(log).toHaveBeenLastCalledWith(
        "[fluent submission timing]",
        expect.objectContaining({ success: false }),
      );
    },
  );
});

/**
 * Requirement 7 of the Issue, and the contract written on `FluentExecuteTiming`: an error inside
 * the measuring code costs the stages it could not establish, never the send. Injected rather
 * than argued, because the moment it matters is the one after the bundler already holds the
 * operation — losing its hash there loses gas the user has already spent.
 */
describe("Connect submission measurement failures", () => {
  const clockError = new Error("clock unavailable");
  const submissionError = new Error("bundler rejected the operation");
  const account = { address, signUserOperation: async () => signature };

  /**
   * A wall clock that answers while the attempt starts and throws once `fail()` is called — the
   * reading `close()` takes after `sendUserOperation` has already returned the hash.
   */
  function wallClock() {
    let failing = false;
    vi.spyOn(Date, "now").mockImplementation(() => {
      if (failing) throw clockError;
      return EPOCH;
    });
    return {
      fail() {
        failing = true;
      },
    };
  }

  /** A monotonic clock that throws for the duration of one call, and is sound either side. */
  async function whileMonotonicClockFails(call) {
    let failing = false;
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (failing) throw clockError;
      return 0;
    });
    failing = true;
    try {
      return await call();
    } finally {
      failing = false;
    }
  }

  it("returns the submitted operation's hash when the attempt cannot be closed", async () => {
    const clock = wallClock();
    const attempts = [];
    const client = {
      sendUserOperation: vi.fn(async (args) => {
        await args.account.signUserOperation({});
        clock.fail();
        return hash;
      }),
    };
    const submission = await sendUserOperationWithTiming(client, { account, calls: [] }, undefined, (attempt) =>
      attempts.push(attempt),
    );
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement).toBeUndefined();
    // The attempt is still recorded, and still names its operation: a caller that submits twice
    // must not be told that this one never happened.
    expect(attempts).toHaveLength(1);
    expect(attempts[0].userOpHash).toBe(hash);
    expect(attempts[0].measurement).toBeUndefined();
    // And nothing was resubmitted to get a measurable one.
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
  });

  it("rethrows the submission's own error rather than the measurement's", async () => {
    const clock = wallClock();
    const attempts = [];
    const client = {
      sendUserOperation: vi.fn(async () => {
        clock.fail();
        throw submissionError;
      }),
    };
    // The error sponsorship handling classifies — a 401 bearer, a 403 refusal — survives intact.
    await expect(
      sendUserOperationWithTiming(client, { account, calls: [] }, undefined, (attempt) =>
        attempts.push(attempt),
      ),
    ).rejects.toBe(submissionError);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].userOpHash).toBeUndefined();
    expect(attempts[0].measurement).toBeUndefined();
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
  });

  it("sends when the monotonic clock is unreadable from the first instant", async () => {
    const client = {
      sendUserOperation: vi.fn(async (args) => {
        await args.account.signUserOperation({});
        return hash;
      }),
    };
    const submission = await whileMonotonicClockFails(() =>
      sendUserOperationWithTiming(client, { account, calls: [] }),
    );
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement).toBeUndefined();
  });

  /**
   * A monotonic clock that fails one nominated reading and answers every other, advancing only
   * when the test says a stage advanced. The readings are, in order: the attempt's start, the
   * signature request, the signature's return, and the one `close()` takes at the end.
   */
  function monotonicClockFailing(failedRead) {
    let elapsed = 0;
    let reads = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (++reads === failedRead) throw clockError;
      return elapsed;
    });
    return { advance: (ms) => (elapsed += ms) };
  }
  /** A submission that spends 100 ms preparing, 200 ms signing and 300 ms broadcasting. */
  function timedSubmission(clock) {
    const signer = {
      address,
      signUserOperation: async () => {
        clock.advance(200);
        return signature;
      },
    };
    return {
      account: signer,
      client: {
        sendUserOperation: vi.fn(async (args) => {
          clock.advance(100);
          await args.account.signUserOperation({});
          clock.advance(300);
          return hash;
        }),
      },
    };
  }

  it("omits preparation, rather than widening it, when the signature request is unreadable", async () => {
    const clock = monotonicClockFailing(2);
    const { account: signer, client } = timedSubmission(clock);
    const submission = await sendUserOperationWithTiming(client, { account: signer, calls: [] });
    expect(submission.userOpHash).toBe(hash);
    // 100 ms of preparation did happen, and the instant it ended is unknown — so it is reported
    // as unknown. The 600 ms the whole attempt took is emphatically not this stage.
    expect(submission.measurement.prepareMs).toBeUndefined();
    expect(submission.measurement.signMs).toBeUndefined();
    // The broadcast's own two boundaries were both readable, so it survives intact.
    expect(submission.measurement.broadcastMs).toBe(300);
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
  });

  it("omits signing, rather than lending it the broadcast, when its end is unreadable", async () => {
    const clock = monotonicClockFailing(3);
    const { account: signer, client } = timedSubmission(clock);
    const submission = await sendUserOperationWithTiming(client, { account: signer, calls: [] });
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement.prepareMs).toBe(100);
    // Signing ran for 200 ms; without the instant it ended, 500 ms is the only number this code
    // could invent, and inventing it would move the broadcast into the signature.
    expect(submission.measurement.signMs).toBeUndefined();
    expect(submission.measurement.broadcastMs).toBeUndefined();
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
  });

  /**
   * The other side of the distinction: a boundary never reached is not a boundary unmeasured.
   * An attempt that fails before asking for a signature spent all of itself preparing, and that
   * number is a measurement — it is what a paymaster's refusal costs.
   */
  it("reports a failed preparation as the whole attempt it was", async () => {
    const clock = monotonicClockFailing(0);
    const account = { address, signUserOperation: vi.fn() };
    const attempts = [];
    const client = {
      sendUserOperation: vi.fn(async () => {
        clock.advance(400);
        throw submissionError;
      }),
    };
    await expect(
      sendUserOperationWithTiming(client, { account, calls: [] }, undefined, (attempt) =>
        attempts.push(attempt),
      ),
    ).rejects.toBe(submissionError);
    expect(attempts[0].measurement).toMatchObject({ prepareMs: 400 });
    expect(attempts[0].measurement.signMs).toBeUndefined();
    expect(attempts[0].measurement.broadcastMs).toBeUndefined();
    expect(account.signUserOperation).not.toHaveBeenCalled();
  });

  it("sends, and still measures, when the host's console throws", async () => {
    setDebugLogging(true);
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("console patched by the host");
    });
    const client = {
      sendUserOperation: vi.fn(async (args) => {
        await args.account.signUserOperation({});
        return hash;
      }),
    };
    const submission = await sendUserOperationWithTiming(client, { account, calls: [] });
    expect(submission.userOpHash).toBe(hash);
    expect(submission.measurement).toBeDefined();
  });
});

/**
 * One attempt as `sendUserOperationWithTiming` returns it, with every instant stated. Built by
 * hand here on purpose: the arithmetic under test is what happens *between* the two clocks, and a
 * test that let a real clock supply them could not express a skew.
 */
function attempt(userOpHash, instants) {
  const {
    startedAt = 0,
    startedAtEpochMs = EPOCH,
    prepareMs = 100,
    signMs = 200,
    broadcastMs = 300,
  } = instants ?? {};
  const elapsed = prepareMs + signMs + broadcastMs;
  return {
    userOpHash,
    measurement: {
      startedAt,
      startedAtEpochMs,
      prepareMs,
      signMs,
      broadcastMs,
      finishedAt: startedAt + elapsed,
      finishedAtEpochMs: startedAtEpochMs + elapsed,
    },
  };
}

const EPOCH = 1_700_000_000_000;
const settledHash = `0x${"a".repeat(64)}`;
const rejectedHash = `0x${"b".repeat(64)}`;
const ownGasHash = `0x${"c".repeat(64)}`;
/**
 * A block stamped at this instant. `block.timestamp` is seconds, so a fixture must name a whole
 * one — half the point of these tests is that the chain's clock has a coarser resolution than the
 * numbers being compared to it.
 */
const blockAt = (epochMs) => {
  expect(epochMs % 1000).toBe(0);
  return { timestamp: BigInt(epochMs / 1000) };
};

describe("Connect send timeline", () => {
  it("splits bundling from this client noticing it, off the including block's timestamp", async () => {
    const only = attempt(settledHash);
    const timing = await closeSendTiming({
      attempts: [only],
      settledUserOpHash: settledHash,
      receivedAt: 2000,
      receivedAtEpochMs: EPOCH + 2000,
      blockNumber: 100n,
      getBlock: async ({ blockNumber }) => {
        expect(blockNumber).toBe(100n);
        return blockAt(EPOCH + 1000);
      },
    });
    expect(timing).toMatchObject({
      prepareMs: 100,
      signMs: 200,
      broadcastMs: 300,
      // Broadcast returned at EPOCH + 600, the block is stamped at EPOCH + 1000, and the receipt
      // was in hand at EPOCH + 2000: 400 ms of bundling and block time, then a second of polling.
      inclusionMs: 400,
      detectMs: 1000,
      retryMs: 0,
      totalMs: 2000,
    });
    expect(timing.instants).toEqual({
      submittedAtEpochMs: EPOCH,
      broadcastedAtEpochMs: EPOCH + 600,
      receivedAtEpochMs: EPOCH + 2000,
      blockTimestampEpochMs: EPOCH + 1000,
      attempts: 1,
    });
  });

  /**
   * Requirement of the Issue, not an accident: `block.timestamp` is the chain's clock at
   * one-second resolution and the browser's is its own, so a small estimate may legitimately come
   * out negative. Clamping it to zero would report a known skew as a measured instant.
   */
  it.each([
    // Broadcast returned at EPOCH + 600 and the receipt was in hand at EPOCH + 2000, so each
    // ordering of the two clocks leaves one of the two estimates below zero.
    { name: "behind", blockEpochMs: EPOCH, inclusionMs: -600, detectMs: 2000 },
    { name: "ahead of", blockEpochMs: EPOCH + 3000, inclusionMs: 2400, detectMs: -1000 },
  ])(
    "reports a signed estimate rather than clamping it, with the chain's clock %s the client's",
    async ({ blockEpochMs, inclusionMs, detectMs }) => {
      const timing = await closeSendTiming({
        attempts: [attempt(settledHash)],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
        blockNumber: 100n,
        getBlock: async () => blockAt(blockEpochMs),
      });
      expect(timing.inclusionMs).toBe(inclusionMs);
      expect(timing.detectMs).toBe(detectMs);
      // The measured span never goes negative, whatever the other clock says.
      expect(timing.totalMs).toBe(2000);
    },
  );

  it.each([
    {
      name: "the block read fails",
      getBlock: async () => {
        throw new Error("rpc down");
      },
      blockNumber: 100n,
    },
    { name: "the receipt names no block", getBlock: () => blockAt(EPOCH), blockNumber: undefined },
    { name: "no block reader was given", getBlock: undefined, blockNumber: 100n },
  ])(
    "leaves inclusion and detection absent when %s, and keeps the rest",
    async ({ getBlock, blockNumber }) => {
      const timing = await closeSendTiming({
        attempts: [attempt(settledHash)],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
        blockNumber,
        getBlock,
      });
      expect(timing.inclusionMs).toBeUndefined();
      expect(timing.detectMs).toBeUndefined();
      expect(timing.instants.blockTimestampEpochMs).toBeUndefined();
      // A timing failure costs the two stages it feeds and nothing else.
      expect(timing).toMatchObject({ prepareMs: 100, signMs: 200, broadcastMs: 300, retryMs: 0 });
      // The one number this Issue is read for stays present and stays non-negative.
      expect(timing.totalMs).toBe(2000);
      expect(timing.totalMs).toBeGreaterThanOrEqual(0);
    },
  );

  /** Attributing one operation's milliseconds to another would be worse than saying nothing. */
  it("reports nothing when no measured attempt carries the settled hash", async () => {
    expect(
      await closeSendTiming({
        attempts: [attempt(rejectedHash)],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
      }),
    ).toBeUndefined();
    expect(
      await closeSendTiming({
        attempts: [],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
      }),
    ).toBeUndefined();
    // An attempt whose clock could not be read names its operation but measures nothing, as the
    // settled attempt here and as the first one below. A timeline missing its start is not one.
    expect(
      await closeSendTiming({
        attempts: [{ userOpHash: settledHash }],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
      }),
    ).toBeUndefined();
    expect(
      await closeSendTiming({
        attempts: [{ userOpHash: rejectedHash }, attempt(settledHash, { startedAt: 500 })],
        settledUserOpHash: settledHash,
        receivedAt: 2000,
        receivedAtEpochMs: EPOCH + 2000,
      }),
    ).toBeUndefined();
  });
});

/**
 * The three ways a sponsored send ends, driven through the real `sendWithSponsorship` rather than
 * a retelling of it: a rejected bearer costs a second submission, a refused App falls back to the
 * account's own gas, and in both cases the stages must describe the operation whose hash and
 * receipt come back — never the attempt that was thrown away.
 */
describe("Connect send timeline across sponsorship retries", () => {
  /** One client that signs through the account it is handed, so the boundary is real. */
  function submitter(tick, outcome) {
    return {
      sendUserOperation: vi.fn(async (args) => {
        tick(100);
        if (outcome.failAt === "prepare") throw outcome.error;
        await args.account.signUserOperation({});
        tick(300);
        if (outcome.error) throw outcome.error;
        return outcome.userOpHash;
      }),
    };
  }

  function clocks() {
    let monotonic = 0;
    let epoch = EPOCH;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    vi.spyOn(Date, "now").mockImplementation(() => epoch);
    return {
      tick(ms) {
        monotonic += ms;
        epoch += ms;
      },
      at: () => ({ receivedAt: monotonic, receivedAtEpochMs: epoch }),
    };
  }

  /** Exactly the wiring `zerodevSession.sendCalls` uses: record each attempt, settle by hash. */
  async function run({ tick, sponsoredOutcomes, ownGasOutcome, waitMs = 1200 }) {
    const attempts = [];
    const account = {
      address,
      signUserOperation: async () => {
        tick(200);
        return signature;
      },
    };
    const submit = async (client) => {
      const { userOpHash } = await sendUserOperationWithTiming(
        client,
        { account, calls: [] },
        undefined,
        (attempt) => attempts.push(attempt),
      );
      return userOpHash;
    };
    const sponsoredClients = sponsoredOutcomes.map((outcome) => submitter(tick, outcome));
    const ownGasClient = submitter(tick, ownGasOutcome);
    let built = 0;
    const disableSponsorship = vi.fn();
    const outcome = await sendWithSponsorship({
      resolveBearer: async ({ fresh }) => ({ token: fresh ? "fresh" : "first" }),
      buildClient: () => sponsoredClients[built++],
      sendSponsored: (client) => submit(client),
      sendOwnGas: () => submit(ownGasClient),
      ownGasClient,
      waitFor: async () => {
        tick(waitMs);
        return { success: true, receipt: { blockNumber: 100n } };
      },
      disableSponsorship,
      log: { debug() {}, warn() {} },
    });
    return { attempts, outcome, disableSponsorship, sponsoredClients, ownGasClient };
  }

  it("charges a first-try sponsored send no retry overhead", async () => {
    const clock = clocks();
    const { attempts, outcome } = await run({
      tick: clock.tick,
      sponsoredOutcomes: [{ userOpHash: settledHash }],
      ownGasOutcome: { userOpHash: ownGasHash },
    });
    const timing = await closeSendTiming({
      attempts,
      settledUserOpHash: outcome.userOpHash,
      ...clock.at(),
      blockNumber: 100n,
      getBlock: async () => blockAt(EPOCH + 1000),
    });
    expect(outcome.userOpHash).toBe(settledHash);
    expect(timing).toMatchObject({
      prepareMs: 100,
      signMs: 200,
      broadcastMs: 300,
      retryMs: 0,
      totalMs: 1800,
    });
    expect(timing.instants.attempts).toBe(1);
  });

  it("keeps a rejected bearer's submission out of the retried operation's stages", async () => {
    const clock = clocks();
    const rejected = new HttpRequestError({ status: 401, url: "https://unused.invalid" });
    const { attempts, outcome, disableSponsorship } = await run({
      tick: clock.tick,
      sponsoredOutcomes: [
        { userOpHash: rejectedHash, failAt: "prepare", error: rejected },
        { userOpHash: settledHash },
      ],
      ownGasOutcome: { userOpHash: ownGasHash },
    });
    const timing = await closeSendTiming({
      attempts,
      settledUserOpHash: outcome.userOpHash,
      ...clock.at(),
      blockNumber: 100n,
      getBlock: async () => blockAt(EPOCH + 1000),
    });
    // A 401 says only that this bearer was refused, so sponsorship stays on and the retry settles.
    expect(disableSponsorship).not.toHaveBeenCalled();
    expect(outcome.sponsored).toBe(true);
    expect(outcome.userOpHash).toBe(settledHash);
    // The refused attempt names no operation — the paymaster never let one be submitted.
    expect(attempts.map((one) => one.userOpHash)).toEqual([undefined, settledHash]);
    // The rejected attempt reached preparation only, and its 100 ms are retry overhead — not
    // this operation's `prepareMs`, which is its own.
    expect(timing).toMatchObject({
      prepareMs: 100,
      signMs: 200,
      broadcastMs: 300,
      retryMs: 100,
      totalMs: 1900,
    });
    expect(timing.instants.attempts).toBe(2);
  });

  it("keeps a refused App's submission out of the own-gas operation's stages", async () => {
    const clock = clocks();
    const refused = new HttpRequestError({ status: 403, url: "https://unused.invalid" });
    const { attempts, outcome, disableSponsorship } = await run({
      tick: clock.tick,
      sponsoredOutcomes: [{ userOpHash: rejectedHash, failAt: "prepare", error: refused }],
      ownGasOutcome: { userOpHash: ownGasHash },
    });
    const timing = await closeSendTiming({
      attempts,
      settledUserOpHash: outcome.userOpHash,
      ...clock.at(),
      blockNumber: 100n,
      getBlock: async () => blockAt(EPOCH + 1000),
    });
    expect(disableSponsorship).toHaveBeenCalledOnce();
    expect(outcome.sponsored).toBe(false);
    expect(outcome.userOpHash).toBe(ownGasHash);
    expect(timing).toMatchObject({
      prepareMs: 100,
      signMs: 200,
      broadcastMs: 300,
      retryMs: 100,
      totalMs: 1900,
    });
    expect(timing.instants.attempts).toBe(2);
    // The overhead is inside the total the reader is shown, and inside no stage.
    expect(timing.prepareMs + timing.signMs + timing.broadcastMs + timing.retryMs).toBeLessThan(
      timing.totalMs,
    );
  });
});

describe("Connect chain selection before signing", () => {
  it("does not switch wallets already on Fluent and rechecks the live provider on every call", async () => {
    const request = vi.fn().mockResolvedValue("0x5202");
    const wallet = { getEthereumProvider: async () => ({ request }), switchChain: vi.fn() };
    await ensureChain(wallet, chain);
    expect(wallet.switchChain).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: "eth_chainId" });
    request.mockResolvedValueOnce("0x1").mockResolvedValue("0x5202");
    await ensureChain(wallet, chain);
    expect(wallet.switchChain).toHaveBeenCalledExactlyOnceWith(20994);
  });

  it("keeps switch rejection and wrong-network failures", async () => {
    const rejected = new Error("User rejected");
    const wallet = {
      getEthereumProvider: async () => ({ request: vi.fn().mockResolvedValue("0x1") }),
      switchChain: vi.fn().mockRejectedValue(rejected),
    };
    await expect(ensureChain(wallet, chain)).rejects.toBe(rejected);
    wallet.switchChain.mockResolvedValue(undefined);
    await expect(ensureChain(wallet, chain)).rejects.toThrow("Unsupported chainId");
  });
});
