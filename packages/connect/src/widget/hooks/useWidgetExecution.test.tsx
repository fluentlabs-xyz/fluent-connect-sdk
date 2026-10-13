/**
 * @vitest-environment jsdom
 *
 * The send that follows `ensureReady` in the same tick, through the real hook.
 *
 * `createBatchOp().execute()` keeps the `sendCalls` of the render the operation was created in.
 * When the Fluent account was not ready in that render, `fluentAccountReady` is still `false`
 * while `execute()` awaits `ensureReady` — React has had no chance to re-render — so that flag
 * cannot decide the route. The account `ensureReady` resolved with has to.
 *
 * Only `sendCallsViaExternalWallet` is mocked: it is the one dependency here that would reach a
 * wallet and a node. The smart account is a stand-in for what `useFluentZeroDevAccount` returns,
 * which is what the hook takes as a parameter anyway.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chain, Hash, TransactionReceipt } from "viem";

import type { FluentExternalWalletState } from "../../core/types";
import type { FluentExecuteResult, FluentWidgetAccount } from "../batchOperation";
import { sendCallsViaExternalWallet } from "../sendCallsViaExternalWallet";
import { useWidgetExecution } from "./useWidgetExecution";

vi.mock("../sendCallsViaExternalWallet", () => ({
  sendCallsViaExternalWallet: vi.fn(),
}));

type ExecutionParams = Parameters<typeof useWidgetExecution>[0];
type SmartAccount = ExecutionParams["smartAccount"];
type Kernel = NonNullable<SmartAccount["kernel"]>;

const TARGET = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
const EOA = "0x2222222222222222222222222222222222222222" as const;
const USER_OP_HASH = `0x${"2".repeat(64)}` as Hash;
const SMART_HASH = `0x${"1".repeat(64)}` as Hash;
const EOA_HASH = `0x${"3".repeat(64)}` as Hash;

const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.invalid"] } },
} as const satisfies Chain;

/**
 * A kernel is only a handle in this file: the hook never reads it, it hands it to
 * `smartAccount.sendCalls`, which is where the real shape matters.
 */
const readyKernel = { signerMode: "prompt", signerSource: "privy" } as unknown as Kernel;

const receipt = { transactionHash: SMART_HASH } as unknown as TransactionReceipt;
const smartAccountResult = {
  hash: SMART_HASH,
  receipt,
  userOpHash: USER_OP_HASH,
  sponsored: false,
} as Awaited<ReturnType<SmartAccount["sendCalls"]>>;
const eoaResult: FluentExecuteResult = {
  hash: EOA_HASH,
  hashes: [EOA_HASH],
  atomic: false,
  sponsored: false,
};

const wallet = {
  configured: true,
  connected: true,
  address: EOA,
  walletClient: {},
  open: () => {},
  disconnect: () => {},
  switchChain: async () => {},
} as unknown as FluentExternalWalletState;

function smartAccountStub(overrides: Partial<SmartAccount> = {}): SmartAccount {
  return {
    smartAccountReady: false,
    kernel: null,
    ensureExecutionReady: async () => readyKernel,
    sendCalls: async () => smartAccountResult,
    ...overrides,
  };
}

function renderExecution(params: {
  fluentAccountReady: boolean;
  smartAccount: SmartAccount;
  wallet?: FluentExternalWalletState | null;
  /** What `deriveWidgetAccount` reported for this render: an EOA is execution-ready too. */
  account?: Partial<FluentWidgetAccount>;
}) {
  const widgetAccount: FluentWidgetAccount = {
    connected: true,
    executionReady: false,
    executionStatus: "unavailable",
    capabilities: { atomicBatch: true, erc20Gas: true },
    ...params.account,
  };
  return renderHook(() =>
    useWidgetExecution({
      chain,
      fluentAccountReady: params.fluentAccountReady,
      wallet: params.wallet ?? null,
      smartAccount: params.smartAccount,
      widgetAccount,
      defaultConfirmationMode: "always",
      selectedGasPaymentToken: { symbol: "ETH", decimals: 18 },
      confirmBatchOperation: async () => {},
      authMode: "direct",
      confirmSignature: async () => {},
      refreshBalances: () => {},
      track: vi.fn(),
    }),
  );
}

const calls = [{ to: TARGET, data: "0x" }] as const;

beforeEach(() => {
  vi.mocked(sendCallsViaExternalWallet).mockReset();
});
afterEach(cleanup);

describe("useWidgetExecution", () => {
  it("sends through the account ensureReady produced, not the readiness flag of that render", async () => {
    const ensureExecutionReady = vi.fn<SmartAccount["ensureExecutionReady"]>(
      async () => readyKernel,
    );
    const sendCalls = vi.fn<SmartAccount["sendCalls"]>(async () => smartAccountResult);
    const { result } = renderExecution({
      fluentAccountReady: false,
      smartAccount: smartAccountStub({ ensureExecutionReady, sendCalls }),
    });

    const op = result.current.createBatchOp({ calls: [...calls] });
    await expect(op.execute()).resolves.toMatchObject({
      hash: SMART_HASH,
      userOpHash: USER_OP_HASH,
      atomic: true,
    });
    expect(ensureExecutionReady).toHaveBeenCalledOnce();
    expect(sendCalls).toHaveBeenCalledOnce();
    expect(sendCallsViaExternalWallet).not.toHaveBeenCalled();
  });

  it("hands that same account to the smart-account send, so nothing initialises twice", async () => {
    const sendCalls = vi.fn<SmartAccount["sendCalls"]>(async () => smartAccountResult);
    const { result } = renderExecution({
      fluentAccountReady: false,
      smartAccount: smartAccountStub({ sendCalls }),
    });

    await result.current.createBatchOp({ calls: [...calls] }).execute();
    expect(sendCalls.mock.calls[0]?.[2]).toBe(readyKernel);
  });

  it("passes no ready account along when the account was already ready in this render", async () => {
    const ensureExecutionReady = vi.fn<SmartAccount["ensureExecutionReady"]>(
      async () => readyKernel,
    );
    const sendCalls = vi.fn<SmartAccount["sendCalls"]>(async () => smartAccountResult);
    const { result } = renderExecution({
      fluentAccountReady: true,
      account: { executionReady: true, executionStatus: "ready", type: "smart" },
      smartAccount: smartAccountStub({
        smartAccountReady: true,
        ensureExecutionReady,
        sendCalls,
      }),
    });

    await result.current.createBatchOp({ calls: [...calls] }).execute();
    expect(ensureExecutionReady).not.toHaveBeenCalled();
    expect(sendCalls.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("still refuses when there is neither a ready account nor a wallet", async () => {
    const { result } = renderExecution({
      fluentAccountReady: false,
      wallet: null,
      smartAccount: smartAccountStub({
        // A readiness path that produced nothing: the only state in which the send has no
        // flag, no account to send through and no wallet — and must still say so.
        ensureExecutionReady: async () => undefined as unknown as Kernel,
        sendCalls: async () => {
          throw new Error("the smart account should not be asked to send");
        },
      }),
    });

    await expect(result.current.createBatchOp({ calls: [...calls] }).execute()).rejects.toThrow(
      "No Fluent account is available to execute this operation",
    );
  });

  it("keeps sending through the external wallet when no Fluent account is ready", async () => {
    vi.mocked(sendCallsViaExternalWallet).mockResolvedValue(eoaResult);
    const sendCalls = vi.fn<SmartAccount["sendCalls"]>(async () => smartAccountResult);
    const { result } = renderExecution({
      fluentAccountReady: false,
      wallet,
      account: { executionReady: true, executionStatus: "ready", type: "eoa" },
      smartAccount: smartAccountStub({ sendCalls }),
    });

    await expect(result.current.createBatchOp({ calls: [...calls] }).execute()).resolves.toBe(
      eoaResult,
    );
    expect(sendCallsViaExternalWallet).toHaveBeenCalledOnce();
    expect(vi.mocked(sendCallsViaExternalWallet).mock.calls[0]?.[1]).toBe(wallet);
    expect(sendCalls).not.toHaveBeenCalled();
  });
});
