/**
 * The Order deposit client, against answers the live API gave (`test/fixtures/orderDepositApi.ts`).
 *
 * One thing is faked: the global `fetch`, which answers with a status and a JSON body the way
 * the proxy does. Everything that reads the answer runs for real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORDER_API_NO_QUOTE,
  ORDER_API_ORDER,
  ORDER_API_ORDERS,
  ORDER_API_QUOTE_100_USDC,
} from "../../test/fixtures/orderDepositApi";
import { getOrderDeposit, getOrderDepositQuote, getOrderDeposits } from "./orderDepositApi";

const BASE_URL = "https://portal.fluent.xyz/api/m0";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDNR = "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9";
/** The stand-in the captured quote was asked for, as both sender and recipient. */
const DEAD = "0x000000000000000000000000000000000000dEaD";
const WALLET = "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df";
const ORDER_ID = "0x96200fe4d729350b4b84ad5f840946c82f44e064b6510b34bb7758749f1f4f5a";

function answer(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function quoteFor(amountIn: bigint, recipient: `0x${string}` = DEAD) {
  return getOrderDepositQuote({
    baseUrl: BASE_URL,
    sourceChainId: 1,
    destinationChainId: 25363,
    tokenIn: USDC,
    tokenOut: USDNR,
    amountIn,
    sender: DEAD,
    recipient,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getOrderDepositQuote", () => {
  it("asks for the route by chain name, with the amount as a decimal string", async () => {
    const fetchMock = answer(ORDER_API_QUOTE_100_USDC);

    await quoteFor(100_000_000n);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/quote`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      route: {
        source: { chain: "Ethereum", address: USDC },
        destination: { chain: "Fluent", address: USDNR },
      },
      amountIn: "100000000",
      sender: DEAD,
      recipient: DEAD,
    });
  });

  it("reads the amounts and both transactions of the quote the API gave", async () => {
    answer(ORDER_API_QUOTE_100_USDC);

    const quote = await quoteFor(100_000_000n);

    expect(quote?.amountIn).toBe(100_000_000n);
    expect(quote?.amountOut).toBe(99_000_000n);
    expect(quote?.fillSeconds).toBe(60);
    expect(quote?.payloads.map((payload) => [payload.chainId, payload.to, payload.value])).toEqual([
      [1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 0n],
      [1, "0xe39B012AB3b20E94a9beEa557eB0DE4171D4D3E4", 0n],
    ]);
    expect(quote?.payloads[0]?.data.startsWith("0x095ea7b3")).toBe(true);
  });

  it("answers null when the API has no quote for the amount", async () => {
    answer(ORDER_API_NO_QUOTE, 404);

    await expect(quoteFor(1_000_000n)).resolves.toBeNull();
  });

  it("answers null when the proxy holds no key", async () => {
    answer({ code: "ProxyNotConfigured", message: "M0_API_KEY is not configured" }, 503);

    await expect(quoteFor(100_000_000n)).resolves.toBeNull();
  });

  it("throws on a failure that says nothing about the route", async () => {
    answer({ code: "InternalError", message: "upstream timed out" }, 502);

    await expect(quoteFor(100_000_000n)).rejects.toThrow(/InternalError upstream timed out/);
  });

  it("throws when the service has no such route at all", async () => {
    answer(undefined, 404);

    await expect(quoteFor(100_000_000n)).rejects.toThrow(/quote request failed: 404/);
  });

  it("refuses a quote for another amount than the one asked", async () => {
    answer(ORDER_API_QUOTE_100_USDC);

    await expect(quoteFor(50_000_000n)).resolves.toBeNull();
  });

  it("refuses a quote that pays somebody other than the recipient asked for", async () => {
    answer(ORDER_API_QUOTE_100_USDC);

    await expect(quoteFor(100_000_000n, WALLET)).resolves.toBeNull();
  });

  it("refuses a quote one of whose transactions is not for an EVM wallet", async () => {
    const [quote] = ORDER_API_QUOTE_100_USDC;
    const svm = { provider: "x", data: { type: "svm" } };
    answer([{ ...quote, payloads: [...quote!.payloads, svm] }]);

    await expect(quoteFor(100_000_000n)).resolves.toBeNull();
  });

  it("gives up on a request that has not answered in ten seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const pending = quoteFor(100_000_000n);
    const refused = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(10_000);

    await refused;
  });
});

describe("getOrderDeposits", () => {
  it("asks for the wallet by its checksummed address, on the source chain", async () => {
    const fetchMock = answer(ORDER_API_ORDERS);

    await getOrderDeposits({
      baseUrl: BASE_URL,
      // The API finds nothing for a lowercase sender.
      sender: WALLET.toLowerCase() as `0x${string}`,
      originChainId: 1,
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${BASE_URL}/orders?sender=${WALLET}&originChainId=1&limit=25`,
    );
  });

  it("reads string chain ids and padded addresses, and keeps the wallet's own orders", async () => {
    answer(ORDER_API_ORDERS);

    const orders = await getOrderDeposits({ baseUrl: BASE_URL, sender: WALLET, originChainId: 1 });

    // The capture lists a third order, another wallet's.
    expect(orders).toHaveLength(2);
    expect(orders[0]).toEqual({
      orderId: ORDER_ID,
      createdAt: 1794341939,
      originChainId: 1,
      destinationChainId: 25363,
      sender: WALLET,
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      tokenOut: USDNR,
      amountIn: 3_000_000n,
      amountOut: 2_000_000n,
      amountOutFilled: 2_000_000n,
      status: "filled",
      openTxHash: "0x001c17cae0212556278b56782a3f5a39fad32b64689d377e6ac78999bccb719b",
      fillTxHash: undefined,
    });
  });

  it("throws when the history cannot be read", async () => {
    answer({ code: "InternalError", message: "indexer down" }, 500);

    await expect(
      getOrderDeposits({ baseUrl: BASE_URL, sender: WALLET, originChainId: 1 }),
    ).rejects.toThrow(/history request failed: InternalError indexer down/);
  });
});

describe("getOrderDeposit", () => {
  it("asks for the order under its source chain's name", async () => {
    const fetchMock = answer(ORDER_API_ORDER);

    await getOrderDeposit({ baseUrl: BASE_URL, originChainId: 1, orderId: ORDER_ID });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE_URL}/orders/Ethereum/${ORDER_ID}`);
  });

  it("reports the solver's transaction on Fluent", async () => {
    answer(ORDER_API_ORDER);

    const order = await getOrderDeposit({ baseUrl: BASE_URL, originChainId: 1, orderId: ORDER_ID });

    expect(order?.status).toBe("filled");
    expect(order?.sender).toBe(WALLET);
    expect(order?.fillTxHash).toBe(
      "0x99c60217d8bedeefa176a9b39694e0233e5be99b55c132b0f6bfabf517e91c53",
    );
  });

  it("answers null for an order the API does not know", async () => {
    answer({ code: "OrderNotFound", message: "Order not found" }, 404);

    await expect(
      getOrderDeposit({ baseUrl: BASE_URL, originChainId: 1, orderId: ORDER_ID }),
    ).resolves.toBeNull();
  });
});
