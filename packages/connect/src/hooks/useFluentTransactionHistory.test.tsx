/**
 * @vitest-environment jsdom
 *
 * The history restarts whenever a transaction confirms, because the confirmed
 * transaction is one of the rows it has to show. That restart lands on top of
 * the first page's own request, and the two must not deadlock: this is the
 * path a Send takes every single time, since sending both opens the screen and
 * bumps the revision that restarts it.
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
    // Exactly what a Send does: `refreshBalances` bumps the revision as the
    // transfer settles, while the screen it just opened is still on its first
    // request. The restart aborts that request, and nothing afterwards changes
    // a dependency of the fetching effect — so if the abort leaves the
    // in-flight guard set, the retry is swallowed and the list stays empty
    // for good.
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
