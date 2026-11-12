/**
 * @vitest-environment jsdom
 *
 * The history restarts whenever a transaction confirms, because the confirmed
 * transaction is one of the rows it has to show. That restart lands on top of
 * the first page's own request, and the two must not deadlock: a Send both
 * opens the screen and bumps the revision that restarts it.
 *
 * Fakes: `fetch`, where FluentScan's Blockscout v2 API answers.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FluentWidgetNetworkProvider } from "../widget/widgetNetworkContext";
import { useFluentTransactionHistory } from "./useFluentTransactionHistory";

const ACCOUNT = "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

/** One token, so nothing the explorer returns is filtered out of the result. */
const TOKENS = [{ identity: "20994:native" }];

function wrapper({ children }: { children: React.ReactNode }) {
  return <FluentWidgetNetworkProvider network="testnet">{children}</FluentWidgetNetworkProvider>;
}

/**
 * A FluentScan stand-in. Every endpoint the page reader calls answers with one
 * native transfer, which is enough to tell "loaded" from "never asked".
 */
function stubExplorer() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // One value-bearing internal transaction, which maps to a native movement.
    // The other two endpoints answer empty: one row is all this needs.
    const items = url.includes("/internal-transactions")
      ? [
          {
            transaction_hash: `0x${"a".repeat(64)}`,
            index: 0,
            timestamp: "2026-10-06T10:00:00.000Z",
            success: true,
            value: "1000000000000000000",
            from: { hash: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4" },
            to: { hash: ACCOUNT },
          },
        ]
      : [];
    return new Response(JSON.stringify({ items, next_page_params: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFluentTransactionHistory", () => {
  it("loads the first page", async () => {
    vi.stubGlobal("fetch", stubExplorer());
    const { result } = renderHook(
      () =>
        useFluentTransactionHistory({
          accountAddress: ACCOUNT,
          tokens: TOKENS,
          revisionCounter: 0,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.transactions.length).toBeGreaterThan(0);
  });

  it("still loads when the revision bumps while the first page is in flight", async () => {
    // A Send bumps the revision while its screen is on its first request. Nothing
    // else changes the fetching effect's dependencies afterwards, so an in-flight
    // guard the abort left set would swallow the retry and leave the list empty.
    vi.stubGlobal("fetch", stubExplorer());
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) =>
        useFluentTransactionHistory({
          accountAddress: ACCOUNT,
          tokens: TOKENS,
          revisionCounter: revision,
        }),
      { wrapper, initialProps: { revision: 0 } },
    );

    rerender({ revision: 1 });

    await waitFor(() => expect(result.current.transactions.length).toBeGreaterThan(0), {
      timeout: 3000,
    });
  });
});

describe("useFluentTransactionHistory under StrictMode", () => {
  /** The first-page reads of `address`: one request to its internal-transactions endpoint each. */
  const pageReads = (address: string) =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([input]) =>
        String(input).endsWith(`/addresses/${address}/internal-transactions`),
      ).length;

  it("starts over on a new revision or account, and not on a render that changes neither", async () => {
    vi.stubGlobal("fetch", stubExplorer());
    const { result, rerender } = renderHook(
      ({ account, revision }: { account: `0x${string}`; revision: number }) =>
        useFluentTransactionHistory({
          accountAddress: account,
          tokens: TOKENS,
          revisionCounter: revision,
        }),
      {
        wrapper: ({ children }) => <StrictMode>{wrapper({ children })}</StrictMode>,
        initialProps: { account: ACCOUNT as `0x${string}`, revision: 0 },
      },
    );

    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    // Pins current behaviour: StrictMode's remount aborts the first read and asks for the page again.
    expect(pageReads(ACCOUNT)).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(6);

    rerender({ account: ACCOUNT, revision: 0 });
    expect(result.current.transactions).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(6);

    rerender({ account: ACCOUNT, revision: 1 });
    expect(result.current).toMatchObject({ transactions: [], busy: true });
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    expect(pageReads(ACCOUNT)).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(9);

    rerender({ account: OTHER, revision: 1 });
    expect(result.current).toMatchObject({ transactions: [], busy: true });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(pageReads(OTHER)).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(12);
    // The explorer's one transfer is to the first account, so none of it is the second one's.
    expect(result.current.transactions).toEqual([]);
  });
});
