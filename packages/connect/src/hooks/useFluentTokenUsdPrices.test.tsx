/**
 * @vitest-environment jsdom
 *
 * Fakes: the network (`fetch`). The hook and the price module run for real.
 */
import {
  fluentMainnetTokenDefaults,
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFluentTokenUsdPrices } from "./useFluentTokenUsdPrices";

type Deferred = { resolve: (response: Response) => void };

function coinbaseSpot(amount: number) {
  return new Response(JSON.stringify({ data: { amount: String(amount), currency: "USD" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A `fetch` whose Coinbase answers wait for the test to release them, so that
 * a request started for one token set can resolve after the caller moved on.
 * Everything else fails at once.
 */
function stubDeferredFetch() {
  const pending: Record<string, Deferred> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("api.coinbase.com")) {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      return new Promise<Response>((resolve) => {
        pending[url] = { resolve };
      });
    }),
  );
  return pending;
}

const COINBASE_ETH = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFluentTokenUsdPrices", () => {
  it("returns the prices keyed by token identity once the feeds answer", async () => {
    const pending = stubDeferredFetch();
    const tokens: FluentTokenDefinition[] = [
      fluentMainnetTokenDefaults.ETH,
      fluentMainnetTokenDefaults.USDnr,
    ];

    const { result } = renderHook(() => useFluentTokenUsdPrices(tokens));

    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(pending[COINBASE_ETH]).toBeDefined());
    await act(async () => {
      pending[COINBASE_ETH]?.resolve(coinbaseSpot(2500));
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.prices).toEqual({
      [fluentTokenIdentity(fluentMainnetTokenDefaults.ETH)]: 2500,
      [fluentTokenIdentity(fluentMainnetTokenDefaults.USDnr)]: 1,
    });
    expect(result.current.pricesYesterday).toEqual(result.current.prices);
  });

  it("drops a result that arrives for a token set the caller has since replaced", async () => {
    const pending = stubDeferredFetch();
    const first: FluentTokenDefinition[] = [fluentMainnetTokenDefaults.ETH];
    const second: FluentTokenDefinition[] = [fluentTestnetTokenDefaults.BLEND];

    const { result, rerender } = renderHook(
      ({ tokens }: { tokens: FluentTokenDefinition[] }) => useFluentTokenUsdPrices(tokens),
      { initialProps: { tokens: first } },
    );
    await waitFor(() => expect(pending[COINBASE_ETH]).toBeDefined());

    rerender({ tokens: second });
    await act(async () => {
      pending[COINBASE_ETH]?.resolve(coinbaseSpot(2500));
    });

    expect(result.current.busy).toBe(true);
    expect(result.current.prices).toEqual({});
  });
});
