import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import type { FluentWidgetNetwork } from "../core/network";
import { formatAddress } from "../utils";
import {
  rowFromHyperlane,
  rowFromIndexer,
  rowTargetUrl,
  sortRows,
  type BridgeHistoryRow,
  type BridgeHistoryStatus,
} from "./historyRows";
import { useHyperlaneTransfers } from "./hyperlaneHistory";
import type { FluentBridgeRoute } from "./route";
import { getBridgeTokens } from "./tokens";
import { useBridgeTxHistoryPages } from "./txHistory";

const STATUS_LABELS: Record<BridgeHistoryStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "text-green-400" },
  pending: { label: "Pending", className: "text-foreground/70" },
  confirming: { label: "Confirming", className: "text-foreground/70" },
  failed: { label: "Failed", className: "text-destructive" },
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatRowAmount(row: BridgeHistoryRow): string | undefined {
  if (row.amount === undefined || row.decimals === undefined || !row.tokenSymbol) return undefined;
  const [whole = "0", fraction = ""] = formatUnits(row.amount, row.decimals).split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ${row.tokenSymbol}`;
}

/**
 * What the row links to: the transaction that *delivered* the transfer on the
 * target chain. A transfer still in flight has no such transaction yet, so it
 * shows the sending hash, unlinked — a link to the departure would point the
 * user at the wrong chain for the question they are asking.
 */
function HistoryRow({ row, route }: { row: BridgeHistoryRow; route: FluentBridgeRoute }) {
  const status = STATUS_LABELS[row.status];
  const url = rowTargetUrl(row, route);
  const hash = url && row.receivedTxHash ? row.receivedTxHash : row.sentTxHash;
  const amount = formatRowAmount(row);

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground">
          {dateFormat.format(new Date(row.sentAt))}
          {amount ? <span className="ml-2 text-foreground/70">{amount}</span> : null}
        </span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={hash}
            className="inline-flex items-center gap-1 font-mono text-foreground/80 underline underline-offset-2 hover:opacity-80"
          >
            {formatAddress(hash)}
            <ExternalLink className="size-3 opacity-60" />
          </a>
        ) : (
          <span className="font-mono text-foreground/80" title={hash}>
            {formatAddress(hash)}
          </span>
        )}
      </div>
      <span className={`shrink-0 font-medium ${status.className}`}>{status.label}</span>
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
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const history = useBridgeTxHistoryPages({ baseUrl: route.indexerUrl, address });
  // The one token that rides Hyperlane on this route; its address keys the body parser.
  const hyperlaneToken = getBridgeTokens(network).find((t) => t.route === "fast-path");
  const hyperlane = useHyperlaneTransfers({ address, route, token: hyperlaneToken });

  const rows = useMemo(() => {
    const fromIndexer = (history.data?.pages ?? []).flatMap((page) => page.items.map(rowFromIndexer));
    const fromHyperlane = (hyperlane.data ?? []).map((t) => rowFromHyperlane(t, route, hyperlaneToken));
    return sortRows([...fromIndexer, ...fromHyperlane]);
  }, [history.data, hyperlane.data, hyperlaneToken, route]);

  if (!isConnected || !address) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
          <span className="text-sm font-medium">No wallet connected</span>
          <span className="text-xs opacity-50">
            History is listed for the wallet that signs your deposits.
          </span>
        </div>
        <Button className="w-full" onClick={() => openConnectModal?.()}>
          Connect a wallet
        </Button>
      </div>
    );
  }

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

  if (rows.length === 0) {
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
    <div className="flex w-full flex-col gap-3">
      {hyperlane.isError ? (
        <span className="text-center text-xs text-muted-foreground">
          {hyperlaneToken?.symbol ?? "Fast-path"} transfers could not be loaded right now.
        </span>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <HistoryRow key={row.id} row={row} route={route} />
        ))}
      </ul>
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
