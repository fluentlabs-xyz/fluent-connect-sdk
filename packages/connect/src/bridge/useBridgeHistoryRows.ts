import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import type { FluentWidgetNetwork } from "../core/network";
import {
  rowFromHyperlane,
  rowFromIndexer,
  rowFromSentDeposit,
  rowInFlight,
  sortRows,
  type BridgeHistoryRow,
  type SentBridgeDeposit,
} from "./historyRows";
import { useHyperlaneTransfers } from "./hyperlaneHistory";
import type { FluentBridgeRoute } from "./route";
import { getBridgeTokens } from "./tokens";
import { useBridgeTxHistoryPages } from "./txHistory";

/** How often the history is read again while a transfer on it has not ended. */
export const FLUENT_BRIDGE_HISTORY_POLL_MS = 10_000;

export type BridgeHistoryState = {
  /** The wallet the rows are listed for; unset while none is connected. */
  address?: `0x${string}`;
  /** Newest first, from both systems that record transfers. */
  rows: BridgeHistoryRow[];
  /** A first page is still out. False with no wallet: there is nothing to wait for. */
  pending: boolean;
  /** The indexer could not be read; it is the primary source, so this is shown. */
  error: string | null;
  /** The Hyperlane explorer could not be read; the list degrades rather than fails. */
  hyperlaneError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
};

/**
 * The connected wallet's bridge transfers, from both systems that record them:
 * the canonical bridge indexer (ETH, BLEND — paged, ten at a time) and the
 * Hyperlane explorer (USDnr over the fast path, which the indexer never sees).
 * Deposits in `sent` that this wallet signed join them as pending rows until
 * one of the two lists the same hash, and both are read again every
 * `FLUENT_BRIDGE_HISTORY_POLL_MS` while any row is still on its way.
 * Needs wagmi above it; the Activity panel checks for that before mounting
 * whatever calls this.
 */
export function useBridgeHistoryRows({
  route,
  network,
  sent,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  /** Deposits the widget saw signed, whichever wallet signed them. */
  sent?: readonly SentBridgeDeposit[];
}): BridgeHistoryState {
  const { address, isConnected } = useAccount();
  const wallet = isConnected ? address : undefined;
  // Set from the rows below, so it lags them by one render.
  const [poll, setPoll] = useState(false);
  const refetchInterval = poll ? FLUENT_BRIDGE_HISTORY_POLL_MS : false;
  const history = useBridgeTxHistoryPages({
    baseUrl: route.indexerUrl,
    address: wallet,
    refetchInterval,
  });
  // The one token that rides Hyperlane on this route; its address keys the body parser.
  const hyperlaneToken = getBridgeTokens(network).find((t) => t.route === "fast-path");
  const hyperlane = useHyperlaneTransfers({
    address: wallet,
    route,
    token: hyperlaneToken,
    refetchInterval,
  });

  const rows = useMemo(() => {
    const fromIndexer = (history.data?.pages ?? []).flatMap((page) => page.items.map(rowFromIndexer));
    const fromHyperlane = (hyperlane.data ?? []).map((t) => rowFromHyperlane(t, route, hyperlaneToken));
    const listed = new Set(
      [...fromIndexer, ...fromHyperlane].map((row) => row.sentTxHash.toLowerCase()),
    );
    const fromWidget = wallet
      ? (sent ?? [])
          .filter(
            (deposit) =>
              deposit.sender.toLowerCase() === wallet.toLowerCase() &&
              !listed.has(deposit.sentTxHash.toLowerCase()),
          )
          .map(rowFromSentDeposit)
      : [];
    return sortRows([...fromIndexer, ...fromHyperlane, ...fromWidget]);
  }, [history.data, hyperlane.data, hyperlaneToken, route, sent, wallet]);

  const inFlight = rows.some(rowInFlight);
  useEffect(() => setPoll(inFlight), [inFlight]);

  return {
    address: wallet,
    rows,
    pending: Boolean(wallet) && (history.isPending || hyperlane.isPending),
    error: history.isError ? history.error.message : null,
    hyperlaneError: hyperlane.isError,
    hasNextPage: Boolean(history.hasNextPage),
    isFetchingNextPage: history.isFetchingNextPage,
    fetchNextPage: () => void history.fetchNextPage(),
  };
}
