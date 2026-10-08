import { Layers } from "lucide-react";

import { ActivityTokenTile, CHAIN_BADGE } from "../bridge/ActivityTokenTile";
import { activityDateTimeFormat, DetailRow, HashMenu } from "../bridge/BridgeActivityDetail";
import { getFluentBridgeRoute } from "../bridge/route";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import {
  describeFluentTransaction,
  FLUENT_TRANSACTION_OPERATION_LABEL,
  formatFluentTransactionAmount,
  type FluentTransactionHistoryEntry,
} from "../core/transactionHistory";
import { cn } from "../lib/utils";
import { explorerAddress, explorerTransaction, explorerUserOperation, formatAddress } from "../utils";
import { Icon } from "./Icon";

/** A Fluent transaction opened from Activity, with the account it was listed for. */
export type FluentActivitySelection = {
  entry: FluentTransactionHistoryEntry;
  account: string;
};

const STATUS: Record<FluentTransactionHistoryEntry["status"], { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "text-green-400" },
  failed: { label: "Failed", className: "text-destructive" },
};

/**
 * One of the Fluent account's transactions in full — the `activity` sub-page,
 * laid out like a bridge transfer's. Everything shown is on the row the user
 * tapped, so there is no fetch; the explorer links are where the rest lives.
 */
export function FluentActivityDetail({
  selection,
  network,
  track,
}: {
  selection: FluentActivitySelection;
  network: FluentWidgetNetwork;
  track: FluentAnalyticsTrack;
}) {
  const { entry, account } = selection;
  const status = STATUS[entry.status];
  // The Fluent badge, and the chain's own name where the route knows it.
  const badge = CHAIN_BADGE.l2_to_l1;
  const chainName = getFluentBridgeRoute(network)?.destination.name ?? "Fluent";
  const movement = entry.kind === "movement" ? entry : entry.movements[0];
  const summary = describeFluentTransaction(entry);
  const heading =
    entry.kind === "movement"
      ? formatFluentTransactionAmount(entry)
      : entry.movements.length > 0
        ? entry.movements.map(formatFluentTransactionAmount).join(", ")
        : FLUENT_TRANSACTION_OPERATION_LABEL;

  const openExplorer = (url: string, label: "transaction" | "user_operation" | "explorer") => {
    track("outbound_link_clicked", {
      label,
      destination_domain: new URL(url, location.href).hostname,
      surface: "activity_page",
    });
    const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };

  const accountCell = <span title={account}>{formatAddress(account)}</span>;
  const counterpartyCell = summary.counterparty ? (
    <HashMenu
      hash={summary.counterparty}
      url={explorerAddress(summary.counterparty, network)}
      onOpen={(url) => openExplorer(url, "explorer")}
      label="Address"
    />
  ) : null;

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex flex-col items-center gap-3 py-3">
        {movement ? (
          <ActivityTokenTile tokenSymbol={movement.symbol} badge="l2_to_l1" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10">
            <Layers className="size-4" />
          </span>
        )}
        <div className="flex flex-col items-center gap-0">
          <span
            className={cn(
              "min-w-0 max-w-full truncate text-2xl font-medium",
              entry.status === "failed" && "opacity-50 line-through",
            )}
          >
            {heading}
          </span>
          <span className="text-sm text-muted-foreground">
            {summary.title}
            {" · "}
            {activityDateTimeFormat.format(new Date(entry.timestamp))}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-5 text-sm bg-neutral-900 p-4 rounded-2xl">
        <DetailRow label="Status">
          <span className={status.className}>{status.label}</span>
        </DetailRow>
        {/* A transfer reads From then To, with this account on whichever end
            it was. An operation with no counterparty keeps the neutral name. */}
        {counterpartyCell ? (
          <>
            <DetailRow label="From">
              {summary.direction === "sent" ? accountCell : counterpartyCell}
            </DetailRow>
            <DetailRow label="To">
              {summary.direction === "sent" ? counterpartyCell : accountCell}
            </DetailRow>
          </>
        ) : (
          <DetailRow label="Account">{accountCell}</DetailRow>
        )}
        <DetailRow label="Network">
          <span className={`flex size-5 items-center justify-center rounded-full ${badge.bgClassName}`}>
            <Icon name={badge.icon} className={`size-3 ${badge.iconClassName}`} />
          </span>
          {chainName}
        </DetailRow>
      </dl>

      <dl className="flex flex-col gap-5 text-sm bg-neutral-900 p-4 rounded-2xl">
        {entry.kind === "operation" ? (
          <DetailRow label="Operation ID">
            <HashMenu
              hash={entry.hash}
              url={explorerUserOperation(entry.hash, network)}
              onOpen={(url) => openExplorer(url, "user_operation")}
              label="Operation hash"
            />
          </DetailRow>
        ) : null}
        <DetailRow label="Transaction ID">
          <HashMenu
            hash={entry.kind === "operation" ? entry.transactionHash : entry.hash}
            url={explorerTransaction(
              entry.kind === "operation" ? entry.transactionHash : entry.hash,
              network,
            )}
            onOpen={(url) => openExplorer(url, "transaction")}
          />
        </DetailRow>
      </dl>
    </div>
  );
}
