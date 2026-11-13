import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";

import { getOrderDeposit, getOrderDeposits, type OrderDeposit } from "./orderDepositApi";
import type { FluentBridgeRoute } from "./route";

/**
 * How many filled orders, newest first, are asked for the transaction that filled them. The
 * list does not carry it, so each one costs a request of its own.
 */
const ORDER_DEPOSIT_FILL_LOOKUPS = 10;

/**
 * Returns the Order deposits `address` opened from the route's source chain into Fluent, newest
 * first, each filled one of the newest `ORDER_DEPOSIT_FILL_LOOKUPS` with the solver's
 * transaction once that has been read. Nothing is asked where the route has no order API.
 *
 * A read that fails leaves the orders out and stops the polling: the history that calls this
 * has other sources, and a service that is down is not asked again every few seconds.
 */
export function useOrderDepositHistory({
  address,
  route,
  refetchInterval = false,
}: {
  address?: Address;
  route: FluentBridgeRoute;
  /** Milliseconds between reads, or `false` for none. */
  refetchInterval?: number | false;
}): OrderDeposit[] {
  const baseUrl = route.orderApiUrl;
  const originChainId = route.source.id;
  const destinationChainId = route.destination.id;

  const list = useQuery({
    queryKey: ["fluent-order-deposits", baseUrl, originChainId, address],
    queryFn: ({ signal }) => {
      if (!address || !baseUrl) {
        const missing = !address ? "address" : "route.orderApiUrl";
        throw new Error(`useOrderDepositHistory: ${missing} is missing`);
      }
      return getOrderDeposits({ baseUrl, sender: address, originChainId, signal });
    },
    enabled: Boolean(address && baseUrl),
    staleTime: 15_000,
    refetchInterval: (query) => (query.state.status === "error" ? false : refetchInterval),
    retry: false,
  });

  const orders = useMemo(
    () => (list.data ?? []).filter((order) => order.destinationChainId === destinationChainId),
    [destinationChainId, list.data],
  );
  const filled = useMemo(
    () => orders.filter((order) => order.status === "filled").slice(0, ORDER_DEPOSIT_FILL_LOOKUPS),
    [orders],
  );

  const fillHashes = useQueries({
    // Without an order API the list is never read, so there is no filled order to look up.
    queries: !baseUrl
      ? []
      : filled.map((order) => ({
          queryKey: ["fluent-order-deposit-fill", baseUrl, originChainId, order.orderId],
          queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const read = await getOrderDeposit({
              baseUrl,
              originChainId,
              orderId: order.orderId,
              signal,
            });
            return read?.fillTxHash ?? null;
          },
          // A filled order's transaction does not change.
          staleTime: Number.POSITIVE_INFINITY,
          retry: false,
        })),
    combine: (results) => results.map((result) => result.data ?? undefined),
  });

  return useMemo(
    () =>
      orders.map((order) => {
        const index = filled.indexOf(order);
        const fillTxHash = index === -1 ? undefined : fillHashes[index];
        return fillTxHash ? { ...order, fillTxHash } : order;
      }),
    [fillHashes, filled, orders],
  );
}
