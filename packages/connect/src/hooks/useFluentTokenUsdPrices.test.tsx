/**
 * @vitest-environment jsdom
 *
 * The wallet menu and the Bridge page mount this hook every time they open,
 * and the feeds behind it belong to other people: a page opened ten times in a
 * minute asks them once, and a page left open asks again only when the cache's
 * TTL runs out.
 *
 * Fakes: `fetch`, standing in for the price feeds; and the clock. The hook and
 * the price module run for real.
 */
import {
  fluentMainnetTokenDefaults,
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearFluentTokenUsdPriceCache, FLUENT_TOKEN_PRICE_TTL_MS } from "../core/tokenPrices";
import { useFluentTokenUsdPrices } from "./useFluentTokenUsdPrices";

const TOKENS = [fluentTestnetTokenDefaults.ETH, fluentTestnetTokenDefaults.USDnr];
const ETH_IDENTITY = fluentTokenIdentity(fluentTestnetTokenDefaults.ETH);

const spotCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("coinbase")).length;

function coinbaseSpot(spot: string) {
  return new Response(JSON.stringify({ data: { amount: spot, base: "ETH", currency: "USD" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFeeds(spot: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("coinbase")) return coinbaseSpot(spot);
    return new Response(JSON.stringify({ prices: [[Date.now() - 24 * 60 * 60 * 1000, 1900]] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  clearFluentTokenUsdPriceCache();
  vi.stubGlobal("fetch", stubFeeds("2000"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useFluentTokenUsdPrices", () => {
  it("asks the feeds once however often it mounts within the TTL", async () => {
    const first = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    expect(first.result.current.busy).toBe(true);
    await settle();
    expect(first.result.current.busy).toBe(false);
    expect(first.result.current.prices[ETH_IDENTITY]).toBe(2000);
    first.unmount();

    const second = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    // Served from the cache on the first render: no loading state to wait out.
    expect(second.result.current.busy).toBe(false);
    expect(second.result.current.prices[ETH_IDENTITY]).toBe(2000);
    await settle();

    expect(spotCalls()).toBe(1);
  });

  it("reads again when the TTL runs out while it stays mounted, and not before", async () => {
    const { result } = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    await settle();
    vi.stubGlobal("fetch", stubFeeds("2100"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUENT_TOKEN_PRICE_TTL_MS - 1);
    });
    expect(spotCalls()).toBe(0);
    expect(result.current.prices[ETH_IDENTITY]).toBe(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(spotCalls()).toBe(1);
    expect(result.current.prices[ETH_IDENTITY]).toBe(2100);
  });

  it("stops reading once it unmounts", async () => {
    const { unmount } = renderHook(() => useFluentTokenUsdPrices(TOKENS));
    await settle();
    vi.stubGlobal("fetch", stubFeeds("2100"));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUENT_TOKEN_PRICE_TTL_MS * 2);
    });
    expect(spotCalls()).toBe(0);
  });

  it("drops a result that arrives for a token set the caller has since replaced", async () => {
    let releaseEth: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("coinbase") && url.includes("ETH")) {
          return new Promise<Response>((resolve) => {
            releaseEth = resolve;
          });
        }
        return Promise.resolve(new Response("{}", { status: 404 }));
      }),
    );
    const first: FluentTokenDefinition[] = [fluentMainnetTokenDefaults.ETH];
    const second: FluentTokenDefinition[] = [fluentTestnetTokenDefaults.BLEND];

    const { result, rerender } = renderHook(
      ({ tokens }: { tokens: FluentTokenDefinition[] }) => useFluentTokenUsdPrices(tokens),
      { initialProps: { tokens: first } },
    );
    await settle();
    expect(releaseEth).toBeDefined();

    rerender({ tokens: second });
    await act(async () => {
      releaseEth?.(coinbaseSpot("2500"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.prices).toEqual({});
  });
});
