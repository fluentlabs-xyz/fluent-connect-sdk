import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import ts from "typescript";
import {
  resolveSponsorshipBearer,
  sendWithSponsorship,
} from "../core/sponsoredClient";

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
function setup(mode: string) {
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
  };
  const send = runInNewContext(callback("function useFluentZeroDevAccount("), {
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
            getAuthToken: async () => "fixture",
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
    getFluentGasTokenAddress: () => "token-address",
    getSponsorshipFailure: () => ({
      reason: "unauthorized",
      disableSponsorship: true,
    }),
    sponsorshipUnavailable: { current: false },
    readUserOperationPaymaster: () => zeroAddress,
    zeroAddress,
    setPromptSigningContext() {},
    clearPromptSigningContext() {},
    debugLog() {},
    debugWarn() {},
    debugError() {},
  });
  return { send, own, sponsored, token, operation };
}

describe("Connect receipt delivery", () => {
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
    },
  );
  it("rejects a failed UserOperation even when its outer transaction succeeded", async () => {
    const { send, operation } = setup("own");
    operation.success = false;
    await expect(send(calls, { confirmation: "session" })).rejects.toThrow(
      "execution failed",
    );
  });
  it("preserves the receipt and operation hash through the widget API", async () => {
    const sendCalls = vi
      .fn()
      .mockResolvedValue({ hash, userOpHash, receipt, sponsored: false });
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
