/**
 * @vitest-environment jsdom
 *
 * An Order deposit quote asked for a token with no Order deposit pair fails with an Error that
 * names the pair, instead of reading the pair's fields from `undefined`. Both hooks keep their
 * query disabled without a pair and return no `refetch`, so each test fetches the query the hook
 * registered, as a manual refetch would.
 *
 * Fakes: `fetch`, standing for the order API.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFluentBridgeRoute } from "./route";
import { getBridgeToken } from "./tokens";
import { useOrderDepositQuote, useOrderDepositRoute } from "./useOrderDepositQuote";

const route = { ...getFluentBridgeRoute("mainnet")!, orderApiUrl: "https://orders.example" };
// ETH crosses through the native gateway, so it has no Order deposit pair.
const eth = getBridgeToken("mainnet", "ETH");

function mount<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(hook, { wrapper });
  return client;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no request leaves this test");
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useOrderDepositRoute without an Order deposit pair", () => {
  it("fails its probe with an Error naming the missing pair", async () => {
    const client = mount(() => useOrderDepositRoute({ route, token: eth, deliveredToken: eth }));

    const query = client
      .getQueryCache()
      .find({ queryKey: ["fluent-order-deposit-route"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useOrderDepositRoute: pair is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("useOrderDepositQuote without an Order deposit pair", () => {
  it("fails its quote with an Error naming the missing pair", async () => {
    const client = mount(() =>
      useOrderDepositQuote({
        route,
        token: eth,
        deliveredToken: eth,
        amountIn: 10n ** 18n,
        enabled: true,
        paused: false,
      }),
    );

    const query = client
      .getQueryCache()
      .find({ queryKey: ["fluent-order-deposit-quote"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useOrderDepositQuote: pair is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
