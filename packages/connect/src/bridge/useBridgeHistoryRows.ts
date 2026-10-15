import { useMemo } from "react";
import { useAccount } from "wagmi";

import type { FluentWidgetNetwork } from "../core/network";
import { rowFromHyperlane, rowFromIndexer, sortRows, type BridgeHistoryRow } from "./historyRows";
import { useHyperlaneTransfers } from "./hyperlaneHistory";
import type { FluentBridgeRoute } from "./route";
import { getBridgeTokens } from "./tokens";
import { useBridgeTxHistoryPages } from "./txHistory";

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
 * Needs wagmi above it; the Activity panel checks for that before mounting
 * whatever calls this.
 */
export function useBridgeHistoryRows({
  route,
  network,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
}): BridgeHistoryState {
  const { address, isConnected } = useAccount();
  const wallet = isConnected ? address : undefined;
  const history = useBridgeTxHistoryPages({ baseUrl: route.indexerUrl, address: wallet });
  // The one token that rides Hyperlane on this route; its address keys the body parser.
  const hyperlaneToken = getBridgeTokens(network).find((t) => t.route === "fast-path");
  const hyperlane = useHyperlaneTransfers({ address: wallet, route, token: hyperlaneToken });

  const rows = useMemo(() => {
    const fromIndexer = (history.data?.pages ?? []).flatMap((page) => page.items.map(rowFromIndexer));
    const fromHyperlane = (hyperlane.data ?? []).map((t) => rowFromHyperlane(t, route, hyperlaneToken));
    return sortRows([...fromIndexer, ...fromHyperlane]);
  }, [history.data, hyperlane.data, hyperlaneToken, route]);

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
