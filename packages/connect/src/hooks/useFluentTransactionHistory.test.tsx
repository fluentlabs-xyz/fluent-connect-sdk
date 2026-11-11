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
import { afterEach, describe, expect, it, vi } from "vitest";

import { FluentWidgetNetworkProvider } from "../widget/widgetNetworkContext";
import { useFluentTransactionHistory } from "./useFluentTransactionHistory";

const ACCOUNT = "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E" as const;

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
      () => useFluentTransactionHistory({ accountAddress: ACCOUNT, tokens: TOKENS, revisionCounter: 0 }),
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
