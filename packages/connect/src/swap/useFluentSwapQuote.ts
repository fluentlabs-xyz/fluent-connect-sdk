import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, type PublicClient } from "viem";

import { getFluentChainForNetwork, type FluentWidgetNetwork } from "../core/network";
import { createFluentRpcTransport } from "../core/rpc";
import {
  FLUENT_SWAP_QUOTE_DEBOUNCE_MS,
  FLUENT_SWAP_QUOTE_REFRESH_MS,
  getFluentSwapContracts,
} from "./contracts";
import { FluentSwapError, getFluentSwapQuote, type FluentSwapQuote } from "./quote";
import type { FluentSwapToken } from "./tokens";

export type UseFluentSwapQuote = {
  quote?: FluentSwapQuote;
  /** No quote yet: the amount is still settling, or the first read is out. */
  loading: boolean;
  /** A quote is on screen and a fresher one is being read. */
  refreshing: boolean;
  /** FluxFlow holds no liquidity for the pair — an answer, not a failed read. */
  noRoute: boolean;
  /** Why the read failed, when it failed for any other reason. */
  error?: string;
};

/**
 * Prices a Fluent swap and keeps the price current.
 *
 * Reads through its own public client rather than the connected wallet's, so a
 * quote is readable whichever chain that wallet sits on — the deposit form
 * quotes the Fluent leg while the wallet is still on Ethereum.
 *
 * @example
 * ```tsx
 * const { quote, loading } = useFluentSwapQuote({
 *   network: "mainnet",
 *   tokenIn: eth,
 *   tokenOut: usdnr,
 *   amountIn: parseEther("0.01"),
 * });
 * ```
 */
export function useFluentSwapQuote({
  network,
  tokenIn,
  tokenOut,
  amountIn,
  enabled = true,
}: {
  network: FluentWidgetNetwork;
  tokenIn?: FluentSwapToken;
  tokenOut?: FluentSwapToken;
  /** The input in its smallest unit; nothing is quoted below one unit. */
  amountIn?: bigint;
  enabled?: boolean;
}): UseFluentSwapQuote {
  const contracts = getFluentSwapContracts(network);
  const client = useMemo<PublicClient>(() => {
    const chain = getFluentChainForNetwork(network);
    return createPublicClient({ chain, transport: createFluentRpcTransport(chain) });
  }, [network]);

  // A keystroke is not a quote request: the amount has to settle first, or
  // every digit of "0.015" costs a 21-call multicall.
  const [settledAmount, setSettledAmount] = useState(amountIn);
  useEffect(() => {
    const timer = setTimeout(() => setSettledAmount(amountIn), FLUENT_SWAP_QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [amountIn]);

  const ready =
    enabled &&
    Boolean(contracts && tokenIn && tokenOut) &&
    tokenIn?.symbol !== tokenOut?.symbol &&
    settledAmount !== undefined &&
    settledAmount > 0n;

  const query = useQuery<FluentSwapQuote, Error>({
    queryKey: [
      "fluent-swap-quote",
      network,
      tokenIn?.symbol,
      tokenOut?.symbol,
      settledAmount?.toString(),
    ],
    enabled: ready,
    queryFn: () =>
      getFluentSwapQuote({
        client,
        network,
        contracts: contracts!,
        tokenIn: tokenIn!,
        tokenOut: tokenOut!,
        amountIn: settledAmount!,
      }),
    refetchInterval: FLUENT_SWAP_QUOTE_REFRESH_MS,
    // A pair with no pool answers the same way however often it is asked.
    retry: (failureCount, error) =>
      !(error instanceof FluentSwapError) && failureCount < 1,
    staleTime: 0,
  });

  const noRoute =
    query.error instanceof FluentSwapError && query.error.code === "no_route";

  return {
    quote: ready ? query.data : undefined,
    loading: ready && (query.isPending || settledAmount !== amountIn),
    refreshing: ready && query.isFetching && !query.isPending,
    noRoute: ready && noRoute,
    error: ready && query.error && !noRoute ? query.error.message : undefined,
  };
}
