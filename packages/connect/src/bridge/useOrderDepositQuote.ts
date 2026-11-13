import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";

import { debugWarn } from "../core/debugLogger";
import { findOrderDepositQuoteFault } from "./orderDeposit";
import { getOrderDepositQuote, type OrderDepositQuote } from "./orderDepositApi";
import type { FluentBridgeRoute } from "./route";
import type { BridgeToken } from "./tokens";

/**
 * Who a quote is asked for while there is no wallet, or no Fluent ID, to ask for: a price can
 * be shown before either exists. Such a quote is never signed, since the form cannot submit
 * without both and asks again once it has them.
 */
const ORDER_DEPOSIT_PREVIEW_ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";
/** Large enough that the solver's flat fee never makes the probe a miss. */
const ORDER_DEPOSIT_PROBE_TOKENS = "100";
const ORDER_DEPOSIT_PROBE_STALE_MS = 5 * 60_000;
/** A quote is asked for again this often while the form shows it. */
const ORDER_DEPOSIT_QUOTE_REFRESH_MS = 15_000;
/** How long the amount has to stand still before a quote is asked for it. */
const ORDER_DEPOSIT_QUOTE_SETTLE_MS = 350;

/** What an Order deposit of `token` needs to be known before it can be quoted at all. */
type OrderDepositPair = {
  baseUrl: string;
  sourceChainId: number;
  destinationChainId: number;
  tokenIn: Address;
  tokenOut: Address;
};

function readOrderDepositPair(
  route: FluentBridgeRoute,
  token: BridgeToken,
  deliveredToken: BridgeToken,
): OrderDepositPair | undefined {
  if (token.route !== "swap" || !route.orderApiUrl) return undefined;
  if (!token.l1Address || !deliveredToken.l2Address) return undefined;
  return {
    baseUrl: route.orderApiUrl,
    sourceChainId: route.source.id,
    destinationChainId: route.destination.id,
    tokenIn: token.l1Address,
    tokenOut: deliveredToken.l2Address,
  };
}

/** Returns a quote the widget would sign, or `null`: the API had none, or this one is refused. */
async function readSignableQuote(
  pair: OrderDepositPair,
  request: { amountIn: bigint; sender: Address; recipient: Address },
  signal: AbortSignal,
): Promise<OrderDepositQuote | null> {
  const quote = await getOrderDepositQuote({ ...pair, ...request, signal });
  if (!quote) return null;
  const fault = findOrderDepositQuoteFault({
    quote,
    sourceChainId: pair.sourceChainId,
    tokenIn: pair.tokenIn,
    amountIn: request.amountIn,
    recipient: request.recipient,
  });
  if (fault) {
    debugWarn(`[FluentBridge] refused an Order deposit quote: ${fault}`, quote);
    return null;
  }
  return quote;
}

/**
 * Reports whether `token` crosses as an Order deposit right now, asked once per form with a
 * quote for a round amount that is never shown and never signed. While the answer is out the form waits
 * (`checking`); a miss, a refused quote and a request that failed all leave the token on the
 * route it had before, through the swap facility and the bridge.
 */
export function useOrderDepositRoute({
  route,
  token,
  deliveredToken,
}: {
  route: FluentBridgeRoute;
  token: BridgeToken;
  deliveredToken: BridgeToken;
}): { available: boolean; checking: boolean } {
  const pair = readOrderDepositPair(route, token, deliveredToken);
  const probe = useQuery({
    queryKey: [
      "fluent-order-deposit-route",
      pair?.baseUrl,
      pair?.sourceChainId,
      pair?.destinationChainId,
      pair?.tokenIn,
      pair?.tokenOut,
    ],
    queryFn: async ({ signal }) => {
      if (!pair) throw new Error("useOrderDepositRoute: pair is missing");
      const quote = await readSignableQuote(
        pair,
        {
          amountIn: parseUnits(ORDER_DEPOSIT_PROBE_TOKENS, token.decimals),
          sender: ORDER_DEPOSIT_PREVIEW_ACCOUNT,
          recipient: ORDER_DEPOSIT_PREVIEW_ACCOUNT,
        },
        signal,
      );
      return quote !== null;
    },
    enabled: Boolean(pair),
    staleTime: ORDER_DEPOSIT_PROBE_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    available: Boolean(pair) && probe.data === true,
    checking: Boolean(pair) && probe.isPending,
  };
}

/** Returns `value` once it has stopped changing for `delayMs`. */
function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return settled;
}

export type OrderDepositQuoteState = {
  /** The quote for exactly the amount passed in; never one for an amount typed before it. */
  quote?: OrderDepositQuote;
  /** A quote for the amount is on its way. */
  loading: boolean;
  /** The API has no quote for this amount, or gave one the widget refuses to sign. */
  missing: boolean;
  /** The request itself failed; the next refresh asks again. */
  failed: boolean;
};

/**
 * Returns the quote for an Order deposit of `amountIn`, asked for once the amount has stood
 * still and again every `ORDER_DEPOSIT_QUOTE_REFRESH_MS`, because a quote ages. `paused` stops
 * the refresh: a quote must not change under a deposit that is being signed.
 */
export function useOrderDepositQuote({
  route,
  token,
  deliveredToken,
  amountIn,
  sender,
  recipient,
  enabled,
  paused,
}: {
  route: FluentBridgeRoute;
  token: BridgeToken;
  deliveredToken: BridgeToken;
  amountIn?: bigint;
  /** The External wallet, once one is connected. */
  sender?: Address;
  /** The Fluent ID the solver pays, once there is one. */
  recipient?: Address;
  enabled: boolean;
  paused: boolean;
}): OrderDepositQuoteState {
  const pair = readOrderDepositPair(route, token, deliveredToken);
  const settledAmount = useSettledValue(amountIn, ORDER_DEPOSIT_QUOTE_SETTLE_MS);
  const wanted = enabled && Boolean(pair) && amountIn !== undefined && amountIn > 0n;
  const settled = wanted && settledAmount === amountIn;
  const from = sender ?? ORDER_DEPOSIT_PREVIEW_ACCOUNT;
  const to = recipient ?? ORDER_DEPOSIT_PREVIEW_ACCOUNT;

  const query = useQuery({
    queryKey: [
      "fluent-order-deposit-quote",
      pair?.baseUrl,
      pair?.sourceChainId,
      pair?.destinationChainId,
      pair?.tokenIn,
      pair?.tokenOut,
      settledAmount?.toString(),
      from,
      to,
    ],
    queryFn: ({ signal }) => {
      if (!pair || settledAmount === undefined) {
        const missing = !pair ? "pair" : "settledAmount";
        throw new Error(`useOrderDepositQuote: ${missing} is missing`);
      }
      return readSignableQuote(
        pair,
        { amountIn: settledAmount, sender: from, recipient: to },
        signal,
      );
    },
    enabled: settled,
    staleTime: ORDER_DEPOSIT_QUOTE_REFRESH_MS,
    refetchInterval: paused ? false : ORDER_DEPOSIT_QUOTE_REFRESH_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!wanted) return { loading: false, missing: false, failed: false };
  if (!settled || query.isPending) return { loading: true, missing: false, failed: false };
  // A refresh that failed keeps the quote it could not replace, so `data` is read first.
  if (query.data) return { quote: query.data, loading: false, missing: false, failed: false };
  return { loading: false, missing: query.data === null, failed: query.isError };
}
