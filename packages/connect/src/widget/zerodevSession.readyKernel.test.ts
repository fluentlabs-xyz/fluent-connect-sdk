/**
 * The kernel `ensureExecutionReady` has just built, handed to `sendCalls` in the same tick.
 *
 * Both run against the `kernels` state of the render that started them. When
 * `ensureExecutionReady` builds the first kernel, that state is still empty for every call of
 * that render — React has not re-rendered yet — so a `sendCalls` from the same render finds no
 * cached kernel and would build a second one: a second `initialize`, a second account
 * derivation, a second signer prompt. The ready kernel travels as an argument instead.
 *
 * Both are imported from `zerodevSession.ts` and called with the render's values the hook would
 * hand them: rendering the hook would need Privy, a bundler and a chain, and what is under test
 * here is the two functions, not React. Fakes, and nothing else: the kernel's bundler client and
 * the `initialize` that builds a kernel.
 */
import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";

import { FLUENT_CONNECT_DEFAULT_EXECUTION } from "../core/config";
import type { FluentBatchOperationExecuteOptions } from "./batchOperation";
import {
  ensureExecutionReady,
  sendCalls,
  type FluentZeroDevKernel,
  type FluentZeroDevSendContext,
} from "./zerodevSession";

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

function setup() {
  const client = {
    sendUserOperation: vi.fn().mockResolvedValue(userOpHash),
    // A bundler's user-operation receipt, as `viem@2.52.0` returns it: the account paid its own
    // gas, so the paymaster is the zero address.
    waitForUserOperationReceipt: vi.fn().mockResolvedValue({
      userOpHash,
      success: true,
      paymaster: zeroAddress,
      logs: [],
      receipt,
    }),
  };
  // Only the members a send that waits on the bundler reads; a kernel's account derivation and
  // its public client are never reached on this path.
  const kernel = {
    client,
    // The account carries its EntryPoint, which is the address the chain-side inclusion wait
    // reads the `UserOperationEvent` of — a real kernel account always has it.
    account: { entryPoint: { address: zeroAddress } },
    chain: { id: 20994 },
    smartAccountAddress: zeroAddress,
    signerMode: "prompt",
    signerSource: "privy",
  } as unknown as FluentZeroDevKernel;
  // The `kernels` state of the render both functions were called from: nothing built yet.
  const kernels = {};
  const initialize = vi.fn().mockResolvedValue(kernel);
  const context: FluentZeroDevSendContext = {
    kernels,
    initialize,
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
    sponsorshipUnavailable: { current: false },
    // The fake client stands in for the sponsored one; no send below configures sponsorship.
    createSponsoredClient: () => () => client as unknown as FluentZeroDevKernel["client"],
  };
  const ready = {
    kernels,
    ready: true,
    authenticated: true,
    login: vi.fn(),
    initialize,
    error: null,
  };
  return {
    sendCalls: (
      sent: typeof calls,
      options?: FluentBatchOperationExecuteOptions,
      readyAccount?: unknown,
    ) => sendCalls(context, sent, options, readyAccount),
    ensureExecutionReady: (options?: Parameters<typeof ensureExecutionReady>[1]) =>
      ensureExecutionReady(ready, options),
    initialize,
    client,
    kernel,
  };
}

describe("ZeroDev send after the account becomes ready", () => {
  it("sends through the kernel ensureExecutionReady returned, initialising exactly once", async () => {
    const { sendCalls, ensureExecutionReady, initialize, client, kernel } = setup();

    const ready = await ensureExecutionReady({ confirmation: "prompt" });
    expect(ready).toBe(kernel);
    expect(initialize).toHaveBeenCalledOnce();

    const result = await sendCalls(calls, { confirmation: "prompt" }, ready);
    expect(initialize).toHaveBeenCalledOnce();
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
    expect(result.hash).toBe(hash);
    expect(result.userOpHash).toBe(userOpHash);
  });

  it("keeps the execution gas headroom when sending through the handed-over kernel", async () => {
    const { sendCalls, ensureExecutionReady, initialize, client } = setup();

    const ready = await ensureExecutionReady({ confirmation: "prompt" });
    await sendCalls(
      calls,
      {
        confirmation: "prompt",
        userOperationGas: { callGasBuffer: { percentage: 50, fixed: 50_000n } },
      },
      ready,
    );
    expect(initialize).toHaveBeenCalledOnce();

    // The headroom travels as an `estimateGas` hook on the account actually sent with, so
    // reading it off the submitted operation proves it survived the ready-kernel path rather
    // than only the path that builds its own kernel. Called with an estimate already complete,
    // which is the branch that needs no bundler.
    const sent = client.sendUserOperation.mock.calls[0]?.[0] as {
      account?: { userOperation?: { estimateGas?: (operation: unknown) => Promise<{ callGasLimit: bigint }> } };
    };
    const estimateGas = sent.account?.userOperation?.estimateGas;
    expect(estimateGas).toBeTypeOf("function");
    const estimate = await estimateGas!({
      callGasLimit: 100_000n,
      preVerificationGas: 1n,
      verificationGasLimit: 1n,
    });
    expect(estimate.callGasLimit).toBe(200_000n);
  });

  it("initialises a kernel of its own when no ready account is handed over", async () => {
    const { sendCalls, ensureExecutionReady, initialize } = setup();

    await ensureExecutionReady({ confirmation: "prompt" });
    await sendCalls(calls, { confirmation: "prompt" });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("ignores a ready account built for the other signer mode", async () => {
    const { sendCalls, ensureExecutionReady, initialize } = setup();

    // `prompt`, because `ensureExecutionReady` ran for a "prompt" confirmation; the send that
    // follows asks for "silent". A kernel is not transferable between the two.
    const ready = await ensureExecutionReady({ confirmation: "prompt" });
    await sendCalls(calls, { confirmation: "silent" }, ready);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1]?.[0]).toMatchObject({ signerMode: "silent" });
  });

  // The rule `execute` applies (`batchOperation.signingMode.test.ts`), held here by the same
  // function: a JavaScript host reaches these two with any value, and only exactly "silent" is
  // Silent mode. Every other value, 0.5's names and garbage included, gets the prompting kernel.
  it.each(["always", "session", "skip-review", null, undefined, 0])(
    "readies and sends with the prompting kernel for a confirmation of %s",
    async (value) => {
      const { sendCalls, ensureExecutionReady, initialize } = setup();

      await ensureExecutionReady({ confirmation: value as never });
      await sendCalls(calls, { confirmation: value as never });

      expect(initialize.mock.calls.map(([options]) => options.signerMode)).toEqual([
        "prompt",
        "prompt",
      ]);
    },
  );
});
