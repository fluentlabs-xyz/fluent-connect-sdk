/**
 * @vitest-environment jsdom
 *
 * An Order deposit history read with no address fails with an Error that names the address,
 * instead of asking the order API for an undefined sender. The hook keeps its query disabled
 * while the address is missing and returns no `refetch`, so the test fetches the query the hook
 * registered, as a manual refetch would.
 *
 * Fakes: `fetch`, standing for the order API.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOrderDepositHistory } from "./orderDepositHistory";
import { getFluentBridgeRoute } from "./route";

const route = { ...getFluentBridgeRoute("mainnet")!, orderApiUrl: "https://orders.example" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useOrderDepositHistory without an address", () => {
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
    renderHook(() => useOrderDepositHistory({ route }), { wrapper });

    const query = client
      .getQueryCache()
      .find({ queryKey: ["fluent-order-deposits"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useOrderDepositHistory: address is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
