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
  splitFluentSwap,
  type FluentTransactionHistoryEntry,
  type FluentTransactionMovementEntry,
} from "../core/transactionHistory";
import { cn } from "../lib/utils";
import {
  explorerAddress,
  explorerTransaction,
  explorerUserOperation,
  formatAddress,
  formatFluentLocaleAmount,
} from "../utils";
import { Icon } from "./Icon";
import {
  formatActivityUsd,
  formatFluentEntryUsd,
  formatFluentMovementsUsd,
  formatFluentSwapPair,
  type ActivityPriceLookup,
} from "./WalletMenuActivity";

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
 *
 * A swap heads with what it received alone, and lists each side as its own row — Paid, then
 * Received, each with what it was worth — and the rate between them where there is one token
 * on each side.
 */
export function FluentActivityDetail({
  selection,
  network,
  priceOf,
  track,
}: {
  selection: FluentActivitySelection;
  network: FluentWidgetNetwork;
  /** USD per token, for the line under the heading and a swap's rows. */
  priceOf: ActivityPriceLookup;
  track: FluentAnalyticsTrack;
}) {
  const { entry, account } = selection;
  const status = STATUS[entry.status];
  // The Fluent badge, and the chain's own name where the route knows it.
  const badge = CHAIN_BADGE.l2_to_l1;
  const chainName = getFluentBridgeRoute(network)?.destination.name ?? "Fluent";
  const summary = describeFluentTransaction(entry);
  const swap = splitFluentSwap(entry);
  const headed = swap ? swap.received : entry.kind === "movement" ? [entry] : entry.movements;
  const movement = headed[0];
  const heading =
    headed.length > 0
      ? headed.map(formatFluentTransactionAmount).join(", ")
      : FLUENT_TRANSACTION_OPERATION_LABEL;
  // A swap's heading is only what it received, so its USD line is too.
  const usd = swap
    ? formatFluentMovementsUsd(swap.received, priceOf)
    : formatFluentEntryUsd(entry, priceOf);
  const rate =
    swap?.received.length === 1 && swap.paid.length === 1
      ? formatSwapRate(swap.paid[0]!, swap.received[0]!)
      : undefined;

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
          {usd ? (
            <span
              className={cn(
                "text-sm tabular-nums text-muted-foreground",
                entry.status === "failed" && "opacity-50 line-through",
              )}
            >
              {usd}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">
            {swap ? `${summary.title} ${formatFluentSwapPair(swap)}` : summary.title}
            {" · "}
            {activityDateTimeFormat.format(new Date(entry.timestamp))}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl">
        <DetailRow label="Status">
          <span className={status.className}>{status.label}</span>
        </DetailRow>
        {swap ? (
          <>
            {swap.paid.map((item) => (
              <SwapSideRow key={item.id} label="Paid" movement={item} priceOf={priceOf} />
            ))}
            {swap.received.map((item) => (
              <SwapSideRow key={item.id} label="Received" movement={item} priceOf={priceOf} />
            ))}
            {rate ? <DetailRow label="Rate">{rate}</DetailRow> : null}
          </>
        ) : null}
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

      <dl className="flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl">
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

/** One side of a swap: the amount without its sign, which the label already says, and its USD. */
function SwapSideRow({
  label,
  movement,
  priceOf,
}: {
  label: string;
  movement: FluentTransactionMovementEntry;
  priceOf: ActivityPriceLookup;
}) {
  const usd = formatActivityUsd(movement.amount, priceOf(movement));
  return (
    <DetailRow label={label}>
      <span className="tabular-nums">
        {formatFluentTransactionAmount(movement).slice(1)}
        {usd ? <span className="font-normal text-muted-foreground"> · {usd}</span> : null}
      </span>
    </DetailRow>
  );
}

/** `1 ETH = 2,305.12 USDnr`; nothing when the paid amount is zero or unreadable. */
function formatSwapRate(
  paid: FluentTransactionMovementEntry,
  received: FluentTransactionMovementEntry,
): string | undefined {
  const rate = Number(received.amount) / Number(paid.amount);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const digits = rate >= 1 ? 2 : 6;
  return `1 ${paid.symbol} = ${formatFluentLocaleAmount(rate, digits)} ${received.symbol}`;
}
