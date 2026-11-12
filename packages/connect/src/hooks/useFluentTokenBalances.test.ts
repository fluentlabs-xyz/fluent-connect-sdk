/**
 * @vitest-environment jsdom
 *
 * The portfolio's formatting, and when the hook reads the balances again.
 *
 * Fakes: `fetch`, answering the Fluent RPC's `eth_getBalance` and `eth_call` as `viem@2.52.0`
 * `http()` calls it.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { numberToHex, parseEther } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FLUENT_DECIMAL_SEPARATOR, formatFluentLocaleAmount } from "../utils";
import { FluentWidgetNetworkProvider } from "../widget/widgetNetworkContext";
import {
  formatFluentPortfolioPnlAbsolute,
  formatFluentPortfolioPnlPercent,
  formatFluentPortfolioTotal,
  useFluentTokenBalances,
} from "./useFluentTokenBalances";

describe("portfolio formatting", () => {
  it("splits the total into parts that rejoin into the same string a token row shows", () => {
    const total = 6448.58;
    const { whole, fraction, separator } = formatFluentPortfolioTotal(total);

    expect(`${whole}${separator}${fraction}`).toBe(formatFluentLocaleAmount(total, 2));
    expect(`$${whole}${separator}${fraction}`).toBe("$6,448.58");
  });

  // Separators written by hand would not follow the locale, and the header would
  // read `$6,448,58` above rows reading `$6,448.58`.
  it("uses the locale's decimal separator, not a hardcoded one", () => {
    expect(formatFluentPortfolioTotal(1.5).separator).toBe(FLUENT_DECIMAL_SEPARATOR);
    expect(formatFluentPortfolioTotal(1.5).separator).not.toBe(",");
  });

  it("keeps two fraction digits, including trailing zeros", () => {
    expect(formatFluentPortfolioTotal(10)).toMatchObject({ whole: "10", fraction: "00" });
    expect(formatFluentPortfolioTotal(0.5)).toMatchObject({ whole: "0", fraction: "50" });
  });

  it("groups thousands", () => {
    expect(formatFluentPortfolioTotal(1234567.89).whole).toBe("1,234,567");
  });

  it("formats pnl with the same separator and a typographic minus", () => {
    expect(formatFluentPortfolioPnlAbsolute(-189.28)).toBe("$ −189.28");
    expect(formatFluentPortfolioPnlAbsolute(189.28)).toBe("$ +189.28");
  });

  it("signs the pnl percentage with the same typographic minus", () => {
    expect(formatFluentPortfolioPnlPercent(-2.85)).toBe("−2.85%");
    expect(formatFluentPortfolioPnlPercent(2.85)).toBe("+2.85%");
  });
});

const ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

type RpcCall = { id: number; method: string; params: unknown[] };

/** The accounts whose native balance was read, one entry per read of the balances. */
const nativeReads: string[] = [];

function rpcAnswer(call: RpcCall) {
  if (call.method === "eth_getBalance") nativeReads.push(String(call.params[0]));
  const result =
    call.method === "eth_getBalance" ? numberToHex(parseEther("2")) : numberToHex(0n, { size: 32 });
  return { jsonrpc: "2.0", id: call.id, result };
}

function stubRpc() {
  return vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "null") as RpcCall | RpcCall[] | null;
    if (!body) return new Response("{}", { status: 404 });
    const payload = Array.isArray(body) ? body.map(rpcAnswer) : rpcAnswer(body);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    StrictMode,
    null,
    createElement(FluentWidgetNetworkProvider, { network: "testnet", children }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nativeReads.length = 0;
});

describe("useFluentTokenBalances under StrictMode", () => {
  it("reads again on a new revision or account, and not on a render that changes neither", async () => {
    vi.stubGlobal("fetch", stubRpc());
    const { result, rerender } = renderHook(
      ({ account, revision }: { account: `0x${string}`; revision: number }) =>
        useFluentTokenBalances({ accountAddress: account, revisionCounter: revision }),
      { wrapper, initialProps: { account: ACCOUNT as `0x${string}`, revision: 0 } },
    );
    await waitFor(() => expect(result.current.status).toBe("Balances updated"));
    // Pins current behaviour: StrictMode's second run reads again, and the User token list's first load hands over a new array, which makes a new `refresh` that reads a third time.
    expect(nativeReads).toEqual([ACCOUNT, ACCOUNT, ACCOUNT]);
    expect(result.current).toMatchObject({ busy: false, status: "Balances updated" });
    expect(result.current.balances).toHaveLength(3);

    rerender({ account: ACCOUNT, revision: 0 });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(nativeReads).toHaveLength(3);

    rerender({ account: ACCOUNT, revision: 1 });
    // A read after a transaction keeps the current balances up until it answers.
    expect(result.current).toMatchObject({ busy: true, status: "Checking token balances" });
    expect(result.current.balances).toHaveLength(3);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(nativeReads).toEqual([ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT]);

    rerender({ account: OTHER, revision: 1 });
    expect(result.current).toMatchObject({
      busy: true,
      status: "Checking token balances",
      balances: [],
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(nativeReads).toEqual([ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT, OTHER]);
    expect(result.current.status).toBe("Balances updated");
    expect(result.current.balances).toHaveLength(3);
  });
});
