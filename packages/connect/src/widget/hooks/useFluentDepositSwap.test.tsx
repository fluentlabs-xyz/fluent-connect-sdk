/**
 * @vitest-environment jsdom
 *
 * A Two-step deposit from the signature of its bridge leg to the end of its swap:
 * that it outlives the page that signed it, swaps what landed as soon as it
 * lands, and never sends a swap again whose first attempt may still land.
 *
 * Stood in for: `fetch`, which carries both the JSON-RPC reads (Ethereum and
 * Fluent, viem 2's `http` transport: one POST per request, `null` for a receipt
 * not mined yet; FluxFlow's quoter is reached through Multicall3's `aggregate3`,
 * one `eth_call` answering every candidate route) and the bridge indexer's GET;
 * and the batch API the widget hands this hook, whose `execute` decides the
 * swap's fate. `localStorage` is jsdom's.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  multicall3Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { WaitForUserOperationReceiptTimeoutError } from "viem/account-abstraction";

import { fluentSwapQuoterAbi } from "../../swap/abi";
import { getFluentSwapContracts } from "../../swap/contracts";
import type { FluentSwapQuote } from "../../swap/quote";
import { findFluentSwapToken } from "../../swap/tokens";
import type {
  FluentBatchApi,
  FluentBatchOperation,
  FluentBatchOperationInput,
  FluentExecuteResult,
} from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import { twoStepDepositStorageKey } from "./twoStepDepositStorage";
import { FLUENT_DEPOSIT_ARRIVAL_POLL_MS, useFluentDepositSwap } from "./useFluentDepositSwap";

const FLUENT_ID = getAddress("0x092AE7564C6611a114C20C6df766B5B35A52334A");
const OTHER_FLUENT_ID = getAddress("0x1111111111111111111111111111111111111111");
const SENDER = getAddress("0x2222222222222222222222222222222222222222");
const SENT_HASH = `0x${"aa".repeat(32)}` as Hash;
const SWAP_HASH = `0x${"bb".repeat(32)}` as Hash;

const usdnr = findFluentSwapToken("mainnet", "USDnr")!;
const eth = findFluentSwapToken("mainnet", "ETH")!;
const contracts = getFluentSwapContracts("mainnet")!;

/** What the fake chains answer; tests move these between polls. */
const chain = {
  /** The Fluent ID's USDnr balance, by account. */
  usdnr: new Map<string, bigint>(),
  /** The deposit transaction's status on Ethereum; `null` while it is not mined. */
  depositReceipt: null as "success" | "reverted" | null,
  /** Whether FluxFlow has the direct 0.3% pool; without it no route prices. */
  pool: true,
};

/** What the 0.3% pool hands out for any input. */
const QUOTED_OUT = 10n ** 16n;

/**
 * Multicall3's `aggregate3` as FluxFlow's quoter answers it: the direct 0.3%
 * route prices while the pool exists, and every other route reverts, as a
 * route through pools that do not exist does.
 */
function quoterMulticall(data: Hex): Hex {
  const { args } = decodeFunctionData({ abi: multicall3Abi, data });
  const [calls] = args as unknown as [readonly { callData: Hex }[]];
  const results = calls.map(({ callData }) => {
    const call = decodeFunctionData({ abi: fluentSwapQuoterAbi, data: callData });
    const priced =
      chain.pool &&
      call.functionName === "quoteExactInputSingle" &&
      call.args[0].fee === 3_000;
    return priced
      ? {
          success: true,
          returnData: encodeFunctionResult({
            abi: fluentSwapQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [QUOTED_OUT, 0n, 0, 0n],
          }),
        }
      : { success: false, returnData: "0x" as Hex };
  });
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
}

function rpcResult(url: string, method: string, params: unknown[]): unknown {
  if (url.includes("rpc.fluent.xyz")) {
    if (method === "eth_chainId") return "0x6313";
    if (method === "eth_call") {
      const { to, data } = params[0] as { to: string; data: Hex };
      if (to.toLowerCase() === contracts.multicall.toLowerCase()) return quoterMulticall(data);
      const account = `0x${data.slice(-40)}`.toLowerCase();
      const balance = chain.usdnr.get(account) ?? 0n;
      return `0x${balance.toString(16).padStart(64, "0")}`;
    }
  } else {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionReceipt") {
      if (!chain.depositReceipt) return null;
      return {
        transactionHash: SENT_HASH,
        blockHash: `0x${"cc".repeat(32)}`,
        blockNumber: "0x1",
        transactionIndex: "0x0",
        from: SENDER,
        to: SENDER,
        cumulativeGasUsed: "0x1",
        gasUsed: "0x1",
        effectiveGasPrice: "0x1",
        contractAddress: null,
        logs: [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: chain.depositReceipt === "success" ? "0x1" : "0x0",
        type: "0x2",
      };
    }
  }
  throw new Error(`unexpected ${method} to ${url}`);
}

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/indexer/v1/transactions")) {
    return new Response(JSON.stringify({ items: [], has_more: false }), { status: 200 });
  }
  const request = JSON.parse(String(init?.body)) as {
    id: number;
    method: string;
    params: unknown[];
  };
  const result = rpcResult(url, request.method, request.params);
  const body = { jsonrpc: "2.0", id: request.id, result };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** A stand-in batch API recording each operation; `send` decides each one's fate. */
function widgetStub(address: Address, send: () => Promise<FluentExecuteResult>) {
  const created: FluentBatchOperationInput[] = [];
  const widget = {
    account: { address, connected: true, type: "smart" },
    createBatchOp(input: FluentBatchOperationInput) {
      created.push(input);
      return {
        ...input,
        encodedCalls: [],
        canExecute: true,
        execute: () => send(),
      } as unknown as FluentBatchOperation;
    },
  } as unknown as FluentBatchApi;
  return { widget, created };
}

const mined: FluentExecuteResult = {
  hash: SWAP_HASH,
  hashes: [SWAP_HASH],
  atomic: true,
  sponsored: false,
};

function mount({
  address = FLUENT_ID,
  send = async () => mined,
}: { address?: Address; send?: () => Promise<FluentExecuteResult> } = {}) {
  const stub = widgetStub(address, send);
  const view = renderHook(
    ({ widget }) =>
      useFluentDepositSwap({
        widget,
        network: "mainnet",
        gasSymbol: "ETH",
        track: vi.fn(),
        refreshBalances: vi.fn(),
      }),
    { initialProps: { widget: stub.widget } },
  );
  return { ...stub, view };
}

function quote(amountIn: bigint): FluentSwapQuote {
  return {
    tokenIn: usdnr,
    tokenOut: eth,
    amountIn,
    amountOut: 10n ** 16n,
    route: [{ tokenIn: usdnr.address!, tokenOut: contracts.weth9, fee: 3_000 }],
  };
}

const usd = (whole: number) => BigInt(whole) * 1_000_000n;

/** Signs a deposit of `expected` USDnr into the mounted Fluent ID. */
function begin(view: ReturnType<typeof mount>["view"], expected: bigint) {
  let taken = false;
  act(() => {
    taken = view.result.current.begin({
      sentHash: SENT_HASH,
      sender: SENDER,
      recipient: FLUENT_ID,
      from: usdnr,
      to: eth,
      expected,
    });
  });
  return taken;
}

/** Runs the polls due in the next `ms`, and the reads they start. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchStub);
  chain.usdnr.clear();
  chain.depositReceipt = null;
  chain.pool = true;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useFluentDepositSwap: the bridge leg", () => {
  it("keeps following a signed deposit after the page that signed it is gone", async () => {
    const first = mount();
    expect(begin(first.view, usd(100))).toBe(true);
    first.view.unmount();

    const second = mount();
    await elapse(0);

    expect(second.view.result.current.state).toMatchObject({
      phase: "bridging",
      deposit: { sentHash: SENT_HASH, from: { symbol: "USDnr" }, to: { symbol: "ETH" } },
    });
  });

  it("does not take over a deposit credited to another account", () => {
    const { view } = mount({ address: OTHER_FLUENT_ID });

    expect(begin(view, usd(100))).toBe(false);
    expect(view.result.current.state.phase).toBe("idle");
  });

  it("swaps what landed rather than what the deposit was to deliver", async () => {
    chain.usdnr.set(FLUENT_ID.toLowerCase(), usd(5));
    const { view } = mount();
    begin(view, usd(100));
    await elapse(0);
    expect(view.result.current.state.phase).toBe("bridging");

    chain.usdnr.set(FLUENT_ID.toLowerCase(), usd(5 + 60));
    await elapse(FLUENT_DEPOSIT_ARRIVAL_POLL_MS);

    expect(view.result.current.state).toMatchObject({
      phase: "settled",
      leg: { from: { symbol: "USDnr", amount: usd(60) }, to: { symbol: "ETH" } },
    });
  });

  it("never sells more than the deposit delivered when other money lands with it", async () => {
    const { view } = mount();
    begin(view, usd(100));
    await elapse(0);

    chain.usdnr.set(FLUENT_ID.toLowerCase(), usd(150));
    await elapse(FLUENT_DEPOSIT_ARRIVAL_POLL_MS);

    expect(view.result.current.state).toMatchObject({
      phase: "settled",
      leg: { from: { amount: usd(100) } },
    });
  });

  it("says the deposit failed when its transaction reverted on Ethereum", async () => {
    const { view } = mount();
    begin(view, usd(100));
    await elapse(0);

    chain.depositReceipt = "reverted";
    await elapse(FLUENT_DEPOSIT_ARRIVAL_POLL_MS);

    expect(view.result.current.state.phase).toBe("bridge_failed");
  });

  it("calls a deposit slow after two minutes on its way", async () => {
    const { view } = mount();
    begin(view, usd(100));
    await elapse(0);
    expect(view.result.current.slow).toBe(false);

    await elapse(120_000);

    expect(view.result.current.slow).toBe(true);
  });

  it("picks up the other Fluent ID's own deposit when the account changes", async () => {
    const { view } = mount();
    begin(view, usd(100));
    await elapse(0);

    view.rerender({ widget: widgetStub(OTHER_FLUENT_ID, async () => mined).widget });
    await elapse(0);
    expect(view.result.current.state.phase).toBe("idle");

    view.rerender({ widget: widgetStub(FLUENT_ID, async () => mined).widget });
    await elapse(0);
    expect(view.result.current.state.phase).toBe("bridging");
  });
});

describe("useFluentDepositSwap: the swap leg", () => {
  /** A mounted hook whose deposit of 60 USDnr has landed, and the reads it started. */
  async function landed(send?: () => Promise<FluentExecuteResult>) {
    const mounted = mount({ send });
    begin(mounted.view, usd(60));
    await elapse(0);
    chain.usdnr.set(FLUENT_ID.toLowerCase(), usd(60));
    await elapse(FLUENT_DEPOSIT_ARRIVAL_POLL_MS);
    return mounted;
  }

  it("sends the swap as soon as the deposit lands, without a press", async () => {
    const { view, created } = await landed();

    expect(created).toHaveLength(1);
    expect(view.result.current.state).toMatchObject({
      phase: "settled",
      hash: SWAP_HASH,
      leg: { from: { amount: usd(60) }, to: { symbol: "ETH", amount: QUOTED_OUT } },
    });
  });

  it("does not send the swap again when its confirmation never came back", async () => {
    const { view, created } = await landed(async () => {
      throw new WaitForUserOperationReceiptTimeoutError({ hash: SWAP_HASH });
    });
    expect(view.result.current.state.phase).toBe("unconfirmed");

    await act(() => view.result.current.run(quote(usd(60))));
    expect(created).toHaveLength(1);
  });

  it("refuses to swap when the Fluent ID no longer holds what the swap sells", async () => {
    chain.usdnr.set(FLUENT_ID.toLowerCase(), usd(10));
    localStorage.setItem(
      twoStepDepositStorageKey("mainnet", FLUENT_ID),
      JSON.stringify({
        phase: "ready",
        leg: {
          from: { symbol: "USDnr", decimals: 6, amount: { $bigint: "60000000" } },
          to: { symbol: "ETH", decimals: 18 },
        },
      }),
    );

    const { view, created } = mount();
    await elapse(0);

    expect(created).toHaveLength(0);
    expect(view.result.current.state.phase).toBe("unconfirmed");
  });

  it("does not open the review again on its own after it is dismissed", async () => {
    const { view, created } = await landed(async () => {
      throw new FluentReviewRejectedError("transaction");
    });
    expect(view.result.current.state.phase).toBe("declined");

    await elapse(FLUENT_DEPOSIT_ARRIVAL_POLL_MS * 3);
    expect(created).toHaveLength(1);

    // The Bridge page's own button still sends it.
    await act(() => view.result.current.run(quote(usd(60))));
    expect(created).toHaveLength(2);
  });

  it("leaves the swap to try again when no pool on Fluent can price it", async () => {
    chain.pool = false;
    const { view, created } = await landed();

    expect(created).toHaveLength(0);
    expect(view.result.current.state).toMatchObject({
      phase: "error",
      message: "There is no USDnr to ETH pool on Fluent right now.",
    });
  });

  it("comes back unconfirmed after a reload in the middle of a swap", async () => {
    localStorage.setItem(
      twoStepDepositStorageKey("mainnet", FLUENT_ID),
      JSON.stringify({
        phase: "swapping",
        leg: {
          from: { symbol: "USDnr", decimals: 6, amount: { $bigint: "60000000" } },
          to: { symbol: "ETH", decimals: 18, amount: { $bigint: "1" } },
        },
      }),
    );

    const { view } = mount();
    await elapse(0);

    expect(view.result.current.state).toMatchObject({
      phase: "unconfirmed",
      leg: { from: { amount: usd(60) } },
    });
  });
});
