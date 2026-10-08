/**
 * The kernel `ensureExecutionReady` has just built, handed to `sendCalls` in the same tick.
 *
 * Both callbacks close over the `kernels` state of the render they were created in. When
 * `ensureExecutionReady` builds the first kernel, that state is still empty in every closure of
 * that render — React has not re-rendered yet — so a `sendCalls` from the same render finds no
 * cached kernel and would build a second one: a second `initialize`, a second account
 * derivation, a second signer prompt. The ready kernel travels as an argument instead.
 *
 * Both callbacks are read out of `zerodevSession.ts` and run with their free variables supplied,
 * the way `executionReceipt.test.ts` does it: rendering the hook would need Privy, a bundler and
 * a chain, and what is under test here is the two callbacks, not React.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import ts from "typescript";

import { sendUserOperationWithTiming } from "../core/userOperationTiming";
import { resolveSponsorshipBearer, sendWithSponsorship } from "../core/sponsoredClient";

const source = ts.transpileModule(
  readFileSync(new URL("./zerodevSession.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

/** The two `useCallback`s, verbatim, as one script whose value is both of them. */
function callbacks() {
  const sendCallsAt = source.indexOf("const sendCalls = useCallback(");
  const ensureReadyAt = source.indexOf("const ensureExecutionReady = useCallback(");
  const returnAt = source.indexOf("\n    return {", ensureReadyAt);
  expect(sendCallsAt).toBeGreaterThan(-1);
  expect(ensureReadyAt).toBeGreaterThan(sendCallsAt);
  expect(returnAt).toBeGreaterThan(ensureReadyAt);
  return (
    source.slice(sendCallsAt, ensureReadyAt) +
    source.slice(ensureReadyAt, returnAt) +
    "\n[sendCalls, ensureExecutionReady];"
  );
}

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

function setup(options: { signerSource?: string; hostedSigner?: unknown } = {}) {
  const client = {
    sendUserOperation: vi.fn().mockResolvedValue(userOpHash),
    waitForUserOperationReceipt: vi.fn().mockResolvedValue({ success: true, receipt }),
  };
  const kernel = {
    client,
    account: {},
    chain: { id: 20994 },
    smartAccountAddress: zeroAddress,
    signerMode: "prompt",
    signerSource: options.signerSource ?? "privy",
  };
  // The `kernels` state of the render both callbacks were created in: nothing built yet.
  const kernels = {};
  const initialize = vi.fn().mockResolvedValue(kernel);
  const [sendCalls, ensureExecutionReady] = runInNewContext(callbacks(), {
    performance,
    sendUserOperationWithTiming,
    useCallback: (fn: unknown) => fn,
    authenticated: true,
    ready: true,
    login: vi.fn(),
    network: "testnet",
    error: null,
    embeddedWallet: options.hostedSigner ? undefined : {},
    hostedSigner: options.hostedSigner ?? null,
    hookOptions: {},
    kernels,
    initialize,
    confirmationToSignerMode: (mode: string) => (mode === "session" ? "silent" : "prompt"),
    createSponsoredClient: () => () => client,
    resolveSponsorshipBearer,
    sendWithSponsorship,
    sponsorshipLog: { debug() {}, warn() {} },
    createFluentZeroDevErc20ExecutionClient: () => client,
    getFluentGasTokenAddress: (symbol: string) => (symbol === "ETH" ? undefined : "token-address"),
    sponsorshipUnavailable: { current: false },
    readUserOperationPaymaster: () => zeroAddress,
    zeroAddress,
    setPromptSigningContext() {},
    clearPromptSigningContext() {},
    debugLog() {},
    debugWarn() {},
    debugError() {},
  });
  return { sendCalls, ensureExecutionReady, initialize, client, kernel };
}

describe("ZeroDev send after the account becomes ready", () => {
  it("sends through the kernel ensureExecutionReady returned, initialising exactly once", async () => {
    const { sendCalls, ensureExecutionReady, initialize, client, kernel } = setup();

    const ready = await ensureExecutionReady({ confirmation: "always" });
    expect(ready).toBe(kernel);
    expect(initialize).toHaveBeenCalledOnce();

    const result = await sendCalls(calls, { confirmation: "always" }, ready);
    expect(initialize).toHaveBeenCalledOnce();
    expect(client.sendUserOperation).toHaveBeenCalledOnce();
    expect(result.hash).toBe(hash);
    expect(result.userOpHash).toBe(userOpHash);
  });

  it("initialises a kernel of its own when no ready account is handed over", async () => {
    const { sendCalls, ensureExecutionReady, initialize } = setup();

    await ensureExecutionReady({ confirmation: "always" });
    await sendCalls(calls, { confirmation: "always" });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("ignores a ready account built for the other signer mode", async () => {
    const { sendCalls, ensureExecutionReady, initialize } = setup();

    // `prompt`, because `ensureReady` ran for an "always" confirmation; the send that follows
    // asks for "session", which signs silently. A kernel is not transferable between the two.
    const ready = await ensureExecutionReady({ confirmation: "always" });
    await sendCalls(calls, { confirmation: "session" }, ready);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1]?.[0]).toMatchObject({ signerMode: "silent" });
  });

  it("still prepares the hosted signer for a hosted ready account", async () => {
    const hostedSigner = { prepare: vi.fn(), address: zeroAddress, close: vi.fn() };
    const { sendCalls, ensureExecutionReady, initialize } = setup({
      signerSource: "hosted",
      hostedSigner,
    });

    const ready = await ensureExecutionReady({ confirmation: "always" });
    await sendCalls(calls, { confirmation: "always" }, ready);
    expect(hostedSigner.prepare).toHaveBeenCalledExactlyOnceWith("always");
    expect(initialize).toHaveBeenCalledOnce();
  });
});
