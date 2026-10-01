import { useMemo } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import type { FluentWidgetNetwork } from "../core/network";
import { formatAddress } from "../utils";
import { ActivityTokenTile } from "./ActivityTokenTile";
import {
  groupRowsByDay,
  rowFromHyperlane,
  rowFromIndexer,
  rowTitle,
  sortRows,
  type BridgeActivitySelection,
  type BridgeHistoryRow,
  type BridgeHistoryStatus,
} from "./historyRows";
import { useHyperlaneTransfers } from "./hyperlaneHistory";
import type { FluentBridgeRoute } from "./route";
import { getBridgeTokens } from "./tokens";
import { useBridgeTxHistoryPages } from "./txHistory";

export const STATUS_LABELS: Record<BridgeHistoryStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "text-green-400" },
  pending: { label: "Pending", className: "text-foreground/70" },
  confirming: { label: "Confirming", className: "text-foreground/70" },
  failed: { label: "Failed", className: "text-destructive" },
};

// Rows sit under a heading per day, so the row itself shows only the time.
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

export function formatRowAmount(row: BridgeHistoryRow): string | undefined {
  if (row.amount === undefined || row.decimals === undefined || !row.tokenSymbol) return undefined;
  const [whole = "0", fraction = ""] = formatUnits(row.amount, row.decimals).split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ${row.tokenSymbol}`;
}

/**
 * One transfer, as a button: tapping it opens the details, which is also where
 * the explorer links went — a row only needs to say what, when, how much and
 * how it ended.
 */
export function HistoryRow({ row, onOpen }: { row: BridgeHistoryRow; onOpen: () => void }) {
  const status = STATUS_LABELS[row.status];
  const amount = formatRowAmount(row);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 p-2.5 rounded-xl text-left hover:bg-neutral-800"
      >
        <ActivityTokenTile row={row} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium leading-4">{rowTitle(row)}</span>
          <span className="truncate text-muted-foreground leading-4">
            {timeFormat.format(new Date(row.sentAt))} ·{" "}
            <span className="leading-4">{formatAddress(row.sentTxHash)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {amount ? <span className="text-sm font-medium leading-4">{amount}</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * The connected wallet's transfers, from both systems that record them: the
 * canonical bridge indexer (ETH, BLEND — paged, ten at a time) and the
 * Hyperlane explorer (USDnr over the fast path, which the indexer never sees).
 * Deliberately the bare minimum — date, the hash that delivered it, status.
 */
export function BridgeHistory({
  route,
  network,
  onOpenRow,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  /** A row was tapped; the caller decides where its details show. */
  onOpenRow: (selection: BridgeActivitySelection) => void;
}) {
  const { address, isConnected } = useAccount();
  const history = useBridgeTxHistoryPages({ baseUrl: route.indexerUrl, address });
  // The one token that rides Hyperlane on this route; its address keys the body parser.
  const hyperlaneToken = getBridgeTokens(network).find((t) => t.route === "fast-path");
  const hyperlane = useHyperlaneTransfers({ address, route, token: hyperlaneToken });

  const groups = useMemo(() => {
    const fromIndexer = (history.data?.pages ?? []).flatMap((page) => page.items.map(rowFromIndexer));
    const fromHyperlane = (hyperlane.data ?? []).map((t) => rowFromHyperlane(t, route, hyperlaneToken));
    return groupRowsByDay(sortRows([...fromIndexer, ...fromHyperlane]));
  }, [history.data, hyperlane.data, hyperlaneToken, route]);

  // No connect button here: the wallet is connected from the bridge page,
  // where a deposit is what the connection is for.
  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
        <span className="text-sm font-medium">No wallet connected</span>
        <span className="text-xs opacity-50">
          History is listed for the wallet that signs your deposits.
        </span>
      </div>
    );
  }

  // Past the guard above, so every row below belongs to this wallet.
  const account = address;

  // Wait for both sources before showing anything, or the first paint would be
  // a list that reorders itself a second later when the other one lands.
  if (history.isPending || hyperlane.isPending) {
    return (
      <div className="flex w-full items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Spinner className="size-4" />
        Loading transfers…
      </div>
    );
  }

  // The indexer is the primary source; a Hyperlane outage degrades the list
  // rather than replacing it with an error.
  if (history.isError) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
          <span className="text-sm font-medium">Could not load history</span>
          <span className="text-xs opacity-50">{history.error.message}</span>
        </div>
        <Button variant="secondary" className="w-full" onClick={() => void history.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
        <span className="text-sm font-medium">No transfers yet</span>
        <span className="text-xs opacity-50">
          Deposits from {formatAddress(address)} will show up here.
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {hyperlane.isError ? (
        <span className="text-center text-xs text-muted-foreground">
          {hyperlaneToken?.symbol ?? "Fast-path"} transfers could not be loaded right now.
        </span>
      ) : null}
      {groups.map((group) => (
        <div key={group.day.getTime()} className="flex flex-col gap-2.5">
          <span className="text-sm text-muted-foreground">{dayFormat.format(group.day)}</span>
          <ul className="flex flex-col gap-1 bg-neutral-900 rounded-2xl p-1">
            {group.rows.map((row) => (
              <HistoryRow key={row.id} row={row} onOpen={() => onOpenRow({ row, account })} />
            ))}
          </ul>
        </div>
      ))}
      {history.hasNextPage ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? (
            <>
              <Spinner className="size-4" />
              Loading…
            </>
          ) : (
            "Load more"
          )}
        </Button>
      ) : null}
    </div>
  );
}
