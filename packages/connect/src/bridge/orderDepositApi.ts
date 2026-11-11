import { getAddress, isAddress, isHex, type Address, type Hash, type Hex } from "viem";

import { debugWarn } from "../core/debugLogger";

/**
 * Client for the service an Order deposit is quoted and followed through: the M^0
 * Orchestration API (https://docs.m0.org/api-reference/orchestration/overview) behind a proxy,
 * because the upstream wants an API key that must never ship in a browser bundle. The proxy
 * keeps the upstream's paths and bodies: `POST /quote`, `GET /orders` and
 * `GET /orders/{originChain}/{orderId}`.
 */

/** Chain names the API understands, keyed by EVM chain id. */
const ORDER_API_CHAIN_BY_ID: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  25363: "Fluent",
};

const ORDER_API_REQUEST_TIMEOUT_MS = 10_000;
const ORDER_API_HISTORY_LIMIT = 25;

/**
 * Error codes that mean "there is no quote", as opposed to "the request failed": no solver for
 * the pair or the amount, a request the API refuses, or a proxy that holds no key. These resolve
 * to `null`. Anything else (the network, a timeout, a 5xx) throws, so that a blip never reads as
 * a route that disappeared.
 */
const QUOTE_MISS_CODES = new Set(["NoQuotesAvailable", "ProxyNotConfigured", "BadQuoteRequest"]);

/** One transaction of a quote, as the External wallet is asked to sign it. */
export type OrderDepositPayload = {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
};

export type OrderDepositQuote = {
  /** What the order takes on the source chain, in the token's smallest unit. */
  amountIn: bigint;
  /** What the solver pays on Fluent, in the Delivered token's smallest unit. */
  amountOut: bigint;
  /** The solver's own estimate of the time to fill, in seconds. */
  fillSeconds?: number;
  /**
   * Signed in order, each one mined before the next: an approval when one is due, then the
   * order.
   */
  payloads: OrderDepositPayload[];
};

export type OrderDepositStatus = "open" | "filled" | "cancelled";

export type OrderDeposit = {
  orderId: Hash;
  /** Unix seconds. */
  createdAt: number;
  originChainId: number;
  destinationChainId: number;
  sender: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  amountOutFilled: bigint;
  status: OrderDepositStatus;
  /** The transaction that opened the order on the source chain. */
  openTxHash?: Hash;
  /** The solver's transaction on Fluent. Only the single-order read reports it. */
  fillTxHash?: Hash;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Returns `value` as an integer, or `undefined` when it is none: the API writes numbers as
 * numbers in one endpoint and as decimal strings in another.
 */
function readInteger(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number(value);
  return undefined;
}

function readAmount(value: unknown): bigint | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return undefined;
}

/**
 * Returns `value` as an address, or `undefined` when it is none. The API sends 20 bytes, or the
 * same address left-padded to 32 bytes.
 */
function readAddress(value: unknown): Address | undefined {
  if (typeof value !== "string") return undefined;
  if (isAddress(value, { strict: false })) return getAddress(value);
  if (/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return getAddress(`0x${value.slice(26)}`);
  return undefined;
}

function readHash(value: unknown): Hash | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? // The pattern above is what makes the string a 32-byte hex value.
      (value.toLowerCase() as Hash)
    : undefined;
}

function readStatus(value: unknown): OrderDepositStatus {
  if (value === "COMPLETED") return "filled";
  if (value === "CANCELLED") return "cancelled";
  // "CREATED", and any status the API grows later: an order nobody has resolved yet.
  return "open";
}

function readPayload(value: unknown): OrderDepositPayload | undefined {
  if (!isRecord(value) || !isRecord(value.data)) return undefined;
  const { data } = value;
  // A quote can carry payloads for other kinds of chain; an External wallet signs EVM ones.
  if (data.type !== "evm") return undefined;
  const chainId = readInteger(data.chainId);
  const to = readAddress(data.to);
  const amount = data.value === undefined || data.value === null ? 0n : readAmount(data.value);
  if (chainId === undefined || !to || amount === undefined || !isHex(data.data)) return undefined;
  return { chainId, to, data: data.data, value: amount };
}

function readQuote(value: unknown): OrderDepositQuote | undefined {
  if (!isRecord(value) || !Array.isArray(value.payloads) || value.payloads.length === 0) {
    return undefined;
  }
  const amountIn = readAmount(value.amountIn);
  const amountOut = readAmount(value.amountOut);
  if (amountIn === undefined || amountOut === undefined) return undefined;
  const payloads: OrderDepositPayload[] = [];
  for (const item of value.payloads) {
    const payload = readPayload(item);
    if (!payload) return undefined;
    payloads.push(payload);
  }
  return { amountIn, amountOut, fillSeconds: readInteger(value.estFillTime), payloads };
}

function readOrder(value: unknown): OrderDeposit | undefined {
  if (!isRecord(value)) return undefined;
  const orderId = readHash(value.orderId);
  const createdAt = readInteger(value.createdAt);
  const originChainId = readInteger(value.originChainId);
  const destinationChainId = readInteger(value.destChainId);
  const sender = readAddress(value.sender);
  const tokenIn = readAddress(value.tokenIn);
  const tokenOut = readAddress(value.tokenOut);
  const amountIn = readAmount(value.amountIn);
  const amountOut = readAmount(value.amountOut);
  if (
    !orderId ||
    createdAt === undefined ||
    originChainId === undefined ||
    destinationChainId === undefined ||
    !sender ||
    !tokenIn ||
    !tokenOut ||
    amountIn === undefined ||
    amountOut === undefined
  ) {
    return undefined;
  }
  const fills: unknown[] = Array.isArray(value.fills) ? value.fills : [];
  const fillTxHash = fills
    .map((fill) => (isRecord(fill) ? readHash(fill.transactionHash) : undefined))
    .find((hash) => hash !== undefined);
  return {
    orderId,
    createdAt,
    originChainId,
    destinationChainId,
    sender,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    amountOutFilled: readAmount(value.amountOutFilled) ?? 0n,
    status: readStatus(value.status),
    openTxHash: readHash(value.openTx),
    fillTxHash,
  };
}

type OrderApiResponse = { ok: boolean; status: number; body: unknown };

function describeFailure(what: string, response: OrderApiResponse): Error {
  const { body } = response;
  const code = isRecord(body) && typeof body.code === "string" ? body.code : response.status;
  const message = isRecord(body) && typeof body.message === "string" ? ` ${body.message}` : "";
  return new Error(`${what} failed: ${code}${message}`);
}

/** Sends one request, given up after `ORDER_API_REQUEST_TIMEOUT_MS` or when `signal` fires. */
async function requestOrderApi(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<OrderApiResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ORDER_API_REQUEST_TIMEOUT_MS);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // An error page that is not JSON still has a status worth reporting.
    const body: unknown = await response.json().catch(() => undefined);
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Returns the best quote for sending `amountIn` of `tokenIn` as an Order deposit, `null` when
 * the API has none for the pair or the amount. A request that failed throws instead.
 *
 * A quote is taken only when it answers the question asked: the same amount in, and the
 * Delivered token out. Quotes arrive ranked best first.
 */
export async function getOrderDepositQuote({
  baseUrl,
  sourceChainId,
  destinationChainId,
  tokenIn,
  tokenOut,
  amountIn,
  sender,
  recipient,
  signal,
}: {
  baseUrl: string;
  sourceChainId: number;
  destinationChainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  sender: Address;
  /** Who the solver pays on Fluent. */
  recipient: Address;
  signal?: AbortSignal;
}): Promise<OrderDepositQuote | null> {
  const sourceChain = ORDER_API_CHAIN_BY_ID[sourceChainId];
  const destinationChain = ORDER_API_CHAIN_BY_ID[destinationChainId];
  if (!sourceChain || !destinationChain || amountIn <= 0n) return null;

  const response = await requestOrderApi(
    `${baseUrl}/quote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        route: {
          source: { chain: sourceChain, address: tokenIn },
          destination: { chain: destinationChain, address: tokenOut },
        },
        amountIn: amountIn.toString(),
        sender: getAddress(sender),
        recipient: getAddress(recipient),
      }),
    },
    signal,
  );

  if (!response.ok) {
    const { body } = response;
    if (isRecord(body) && typeof body.code === "string" && QUOTE_MISS_CODES.has(body.code)) {
      return null;
    }
    throw describeFailure("The Order deposit quote request", response);
  }

  const offered: unknown[] = Array.isArray(response.body) ? response.body : [];
  for (const item of offered) {
    const quote = readQuote(item);
    if (!quote) continue;
    const destination =
      isRecord(item) && isRecord(item.route) && isRecord(item.route.destination)
        ? readAddress(item.route.destination.address)
        : undefined;
    const paidTo = isRecord(item) ? readAddress(item.recipient) : undefined;
    if (
      quote.amountIn !== amountIn ||
      destination !== getAddress(tokenOut) ||
      paidTo !== getAddress(recipient)
    ) {
      debugWarn("[FluentBridge] an Order deposit quote does not answer its request", item);
      continue;
    }
    return quote;
  }
  return null;
}

/**
 * Returns the orders `sender` opened on `originChainId`, newest first as the API lists them. An
 * order the reader cannot make sense of is left out rather than guessed at.
 */
export async function getOrderDeposits({
  baseUrl,
  sender,
  originChainId,
  signal,
}: {
  baseUrl: string;
  sender: Address;
  originChainId: number;
  signal?: AbortSignal;
}): Promise<OrderDeposit[]> {
  const search = new URLSearchParams({
    // The API matches the sender by its exact text, checksum included, and answers with
    // everybody's orders when the filter is empty.
    sender: getAddress(sender),
    originChainId: String(originChainId),
    limit: String(ORDER_API_HISTORY_LIMIT),
  });
  const response = await requestOrderApi(`${baseUrl}/orders?${search.toString()}`, {}, signal);
  if (!response.ok) throw describeFailure("The Order deposit history request", response);

  const { body } = response;
  const listed: unknown[] = isRecord(body) && Array.isArray(body.orders) ? body.orders : [];
  const orders: OrderDeposit[] = [];
  for (const item of listed) {
    const order = readOrder(item);
    // The filter is the API's; what is shown as this wallet's is checked here as well.
    if (order && order.sender === getAddress(sender)) orders.push(order);
    else debugWarn("[FluentBridge] skipped an order the history could not read", item);
  }
  return orders;
}

/**
 * Returns one order in full, `null` when the API does not know it. The only read that reports the
 * solver's transaction on Fluent.
 */
export async function getOrderDeposit({
  baseUrl,
  originChainId,
  orderId,
  signal,
}: {
  baseUrl: string;
  originChainId: number;
  orderId: Hash;
  signal?: AbortSignal;
}): Promise<OrderDeposit | null> {
  const originChain = ORDER_API_CHAIN_BY_ID[originChainId];
  if (!originChain) return null;
  const response = await requestOrderApi(
    `${baseUrl}/orders/${originChain}/${encodeURIComponent(orderId)}`,
    {},
    signal,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw describeFailure("The Order deposit status request", response);
  return readOrder(response.body) ?? null;
}
