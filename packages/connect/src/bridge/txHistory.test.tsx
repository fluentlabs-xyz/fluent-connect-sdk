/**
 * @vitest-environment jsdom
 *
 * A bridge history read with no address fails with an Error that names the address, instead of
 * asking the indexer for an undefined sender.
 *
 * Fakes: `fetch`, standing for the bridge indexer.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBridgeTxHistoryPages } from "./txHistory";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useBridgeTxHistoryPages without an address", () => {
  it("fails a read with an Error naming the missing address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no request leaves this test");
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useBridgeTxHistoryPages({ baseUrl: "https://indexer.example" }),
      { wrapper },
    );

    let outcome: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => {
      outcome = await result.current.refetch();
    });

    expect(outcome?.error).toEqual(new Error("useBridgeTxHistoryPages: address is missing"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
