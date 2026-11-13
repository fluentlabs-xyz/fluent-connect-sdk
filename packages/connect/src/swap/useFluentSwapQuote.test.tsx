/**
 * @vitest-environment jsdom
 *
 * A Fluent swap quote asked with no input token fails with an Error that names the token,
 * instead of reading the token's fields from `undefined`. The hook keeps its query disabled
 * without the token and returns no `refetch`, so the test fetches the query the hook
 * registered, as a manual refetch would.
 *
 * Fakes: `fetch`, standing for the Fluent RPC.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getFluentSwapTokens } from "./tokens";
import { useFluentSwapQuote } from "./useFluentSwapQuote";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFluentSwapQuote without an input token", () => {
  it("fails its quote with an Error naming the missing input token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no request leaves this test");
      }),
    );
    // The hook retries an Error that is not a `FluentSwapError` once; it retries at once here.
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const tokenOut = getFluentSwapTokens("mainnet")[1];
    renderHook(() => useFluentSwapQuote({ network: "mainnet", tokenOut, amountIn: 10n ** 18n }), {
      wrapper,
    });

    const query = client.getQueryCache().find({ queryKey: ["fluent-swap-quote"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useFluentSwapQuote: tokenIn is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
