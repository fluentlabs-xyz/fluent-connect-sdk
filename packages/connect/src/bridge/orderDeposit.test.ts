/**
 * What an Order deposit's quote must look like to be signed, and the order it is signed in.
 *
 * Fakes:
 * - the order API behind the global `fetch`, answering with a captured quote
 *   (`test/fixtures/orderDepositApi.ts`);
 * - the `OrderDepositSigner`, standing in for the source chain and the External wallet.
 */
import { encodeFunctionData, erc20Abi, type Address, type Hash } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ORDER_API_QUOTE_100_USDC } from "../../test/fixtures/orderDepositApi";
import {
  findOrderDepositQuoteFault,
  getOrderDepositMinimum,
  readOrderDepositApproval,
  sendOrderDeposit,
  type OrderDepositSigner,
} from "./orderDeposit";
import {
  getOrderDepositQuote,
  type OrderDepositPayload,
  type OrderDepositQuote,
} from "./orderDepositApi";

const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDNR: Address = "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9";
const ORDER_BOOK: Address = "0xe39B012AB3b20E94a9beEa557eB0DE4171D4D3E4";
/** The stand-in the captured quote was asked for, as both sender and recipient. */
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const OTHER: Address = "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df";
const AMOUNT = 100_000_000n;

async function capturedQuote(): Promise<OrderDepositQuote> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ORDER_API_QUOTE_100_USDC })),
  );
  const quote = await getOrderDepositQuote({
    baseUrl: "https://portal.fluent.xyz/api/m0",
    sourceChainId: 1,
    destinationChainId: 25363,
    tokenIn: USDC,
    tokenOut: USDNR,
    amountIn: AMOUNT,
    sender: DEAD,
    recipient: DEAD,
  });
  if (!quote) throw new Error("the captured quote was not read");
  return quote;
}

function faultOf(quote: OrderDepositQuote, recipient: Address = DEAD) {
  return findOrderDepositQuoteFault({
    quote,
    sourceChainId: 1,
    tokenIn: USDC,
    amountIn: AMOUNT,
    recipient,
  });
}

function approve(token: Address, spender: Address, amount: bigint): OrderDepositPayload {
  return {
    chainId: 1,
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    value: 0n,
  };
}

/** Returns a signer whose wallet signs everything and whose chain mines it, in the order asked. */
function signerWith(allowance: bigint, receipt: "success" | "reverted" = "success") {
  const events: string[] = [];
  const signer: OrderDepositSigner = {
    readAllowance: async () => allowance,
    sendTransaction: async (payload) => {
      events.push(`sign ${payload.to}`);
      return `0x${String(events.length).padStart(64, "0")}` as Hash;
    },
    waitForReceipt: async (hash) => {
      events.push(`mined ${Number(BigInt(hash))}`);
      return receipt;
    },
  };
  return { signer, events };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOrderDepositMinimum", () => {
  it("is two tokens in the token's own decimals", () => {
    expect(getOrderDepositMinimum(6)).toBe(2_000_000n);
  });
});

describe("readOrderDepositApproval", () => {
  it("reads the approval the API put first, and takes the order for no approval", async () => {
    const quote = await capturedQuote();

    expect(readOrderDepositApproval(quote.payloads[0]!)).toEqual({
      token: USDC,
      spender: ORDER_BOOK,
      amount: AMOUNT,
    });
    expect(readOrderDepositApproval(quote.payloads[1]!)).toBeUndefined();
  });
});

describe("findOrderDepositQuoteFault", () => {
  it("finds no fault in the quote the API gave", async () => {
    expect(faultOf(await capturedQuote())).toBeUndefined();
  });

  it("finds no fault in a quote that needs no approval", async () => {
    const quote = await capturedQuote();

    expect(faultOf({ ...quote, payloads: [quote.payloads[1]!] })).toBeUndefined();
  });

  it("refuses an order that pays somebody other than the recipient", async () => {
    expect(faultOf(await capturedQuote(), OTHER)).toBe("its order does not name the recipient");
  });

  it("refuses an approval for more than the amount sent", async () => {
    const quote = await capturedQuote();
    const payloads = [approve(USDC, ORDER_BOOK, AMOUNT + 1n), quote.payloads[1]!];

    expect(faultOf({ ...quote, payloads })).toBe("it approves more than the amount sent");
  });

  it("refuses an approval to a contract the order does not go to", async () => {
    const quote = await capturedQuote();
    const payloads = [approve(USDC, OTHER, AMOUNT), quote.payloads[1]!];

    expect(faultOf({ ...quote, payloads })).toBe("it approves a contract the order does not go to");
  });

  it("refuses an approval of a token other than the one sent", async () => {
    const quote = await capturedQuote();
    const payloads = [approve(USDNR, ORDER_BOOK, AMOUNT), quote.payloads[1]!];

    expect(faultOf({ ...quote, payloads })).toBe("it approves another token");
  });

  it("refuses a quote that ends in a call on the token itself", async () => {
    const quote = await capturedQuote();
    const transfer: OrderDepositPayload = {
      chainId: 1,
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [DEAD, AMOUNT] }),
      value: 0n,
    };

    expect(faultOf({ ...quote, payloads: [transfer] })).toBe(
      "its last transaction is not an order",
    );
  });

  it("refuses a transaction that carries ETH", async () => {
    const quote = await capturedQuote();
    const payloads = [quote.payloads[0]!, { ...quote.payloads[1]!, value: 1n }];

    expect(faultOf({ ...quote, payloads })).toBe("it spends ETH");
  });

  it("refuses a transaction on a chain other than the source", async () => {
    const quote = await capturedQuote();
    const payloads = [quote.payloads[0]!, { ...quote.payloads[1]!, chainId: 25363 }];

    expect(faultOf({ ...quote, payloads })).toBe("it has a transaction on another chain");
  });
});

describe("sendOrderDeposit", () => {
  it("signs the approval, waits for it to be mined, then signs the order", async () => {
    const quote = await capturedQuote();
    const { signer, events } = signerWith(0n);
    const steps: string[] = [];

    const hash = await sendOrderDeposit({
      quote,
      account: DEAD,
      signer,
      onStep: (step) => steps.push(step),
    });

    expect(events).toEqual([`sign ${USDC}`, "mined 1", `sign ${ORDER_BOOK}`]);
    expect(steps).toEqual(["approval", "order"]);
    // The order's hash, handed back before anyone waits for it to be mined.
    expect(Number(BigInt(hash))).toBe(3);
  });

  it("does not ask again for an approval the chain already holds", async () => {
    const quote = await capturedQuote();
    const { signer, events } = signerWith(AMOUNT);
    const steps: string[] = [];

    await sendOrderDeposit({ quote, account: DEAD, signer, onStep: (step) => steps.push(step) });

    expect(events).toEqual([`sign ${ORDER_BOOK}`]);
    expect(steps).toEqual(["order"]);
  });

  it("asks for the approval when the allowance cannot be read", async () => {
    const quote = await capturedQuote();
    const { signer, events } = signerWith(AMOUNT);
    signer.readAllowance = async () => {
      throw new Error("rpc down");
    };

    await sendOrderDeposit({ quote, account: DEAD, signer });

    expect(events).toEqual([`sign ${USDC}`, "mined 1", `sign ${ORDER_BOOK}`]);
  });

  it("stops before the order when the approval reverted", async () => {
    const quote = await capturedQuote();
    const { signer, events } = signerWith(0n, "reverted");

    await expect(sendOrderDeposit({ quote, account: DEAD, signer })).rejects.toThrow(
      "The approval transaction reverted",
    );
    expect(events).toEqual([`sign ${USDC}`, "mined 1"]);
  });
});
