import { Layers } from "lucide-react";
import { formatUnits, type Hash } from "viem";

import { ActivityTokenTile, CHAIN_BADGE } from "../bridge/ActivityTokenTile";
import { activityDateTimeFormat, DetailRow, HashMenu } from "../bridge/BridgeActivityDetail";
import { getFluentBridgeRoute } from "../bridge/route";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import {
  describeFluentTransaction,
  FLUENT_TRANSACTION_OPERATION_LABEL,
  FLUENT_TRANSACTION_SWAP_LABEL,
  formatFluentTransactionAmount,
  splitFluentSwap,
  type FluentTransactionHistoryEntry,
  type FluentTransactionMovementEntry,
  type FluentTransactionSummary,
} from "../core/transactionHistory";
import { cn } from "../lib/utils";
import {
  explorerAddress,
  explorerTransaction,
  explorerUserOperation,
  formatAddress,
  formatFluentLocaleAmount,
} from "../utils";
import type {
  FluentDepositSwapLeg,
  FluentDepositSwapState,
} from "../widget/hooks/useFluentDepositSwap";
import { Icon } from "./Icon";
import { Spinner } from "./ui/spinner";
import {
  formatActivityUsd,
  formatFluentMovementsUsd,
  formatFluentSwapPair,
  type ActivityPriceLookup,
} from "./WalletMenuActivity";

/** A Fluent transaction opened from Activity, with the account it was listed for. */
export type FluentActivitySelection = {
  entry: FluentTransactionHistoryEntry;
  account: string;
};

type DetailStatus = { label: string; className: string; busy?: boolean };

const STATUS: Record<FluentTransactionHistoryEntry["status"], DetailStatus> = {
  confirmed: { label: "Confirmed", className: "text-green-400" },
  failed: { label: "Failed", className: "text-destructive" },
};

/** The parts of a movement the screen draws. */
type DetailMovement = Pick<FluentTransactionMovementEntry, "id" | "amount" | "direction" | "symbol">;

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
  return (
    <ActivityDetailView
      network={network}
      priceOf={priceOf}
      track={track}
      account={account}
      summary={describeFluentTransaction(entry)}
      movements={entry.kind === "movement" ? [entry] : entry.movements}
      timestamp={entry.timestamp}
      status={STATUS[entry.status]}
      failed={entry.status === "failed"}
      operationHash={entry.kind === "operation" ? entry.hash : undefined}
      transactionHash={entry.kind === "operation" ? entry.transactionHash : entry.hash}
    />
  );
}

/**
 * The swap of a Two-step deposit, opened as soon as its review is confirmed and before the
 * history lists it: Pending while it is out, then how it ended. What it received is the quote
 * it was sent at, so it is marked as an estimate; the IDs appear once the receipt is back.
 */
export function DepositSwapActivityDetail({
  state,
  sentAt,
  account,
  network,
  priceOf,
  track,
}: {
  state: Extract<FluentDepositSwapState, { leg: FluentDepositSwapLeg }>;
  /** When the review was confirmed, in unix milliseconds. */
  sentAt: number;
  account: string;
  network: FluentWidgetNetwork;
  priceOf: ActivityPriceLookup;
  track: FluentAnalyticsTrack;
}) {
  const { leg } = state;
  const movements: DetailMovement[] = [
    {
      id: "paid",
      direction: "sent",
      symbol: leg.from.symbol,
      amount: formatUnits(leg.from.amount, leg.from.decimals),
    },
  ];
  if (leg.to.amount !== undefined) {
    movements.push({
      id: "received",
      direction: "received",
      symbol: leg.to.symbol,
      amount: formatUnits(leg.to.amount, leg.to.decimals),
    });
  }
  const status: DetailStatus =
    state.phase === "settled"
      ? STATUS.confirmed
      : state.phase === "error"
        ? STATUS.failed
        : state.phase === "unconfirmed"
          ? { label: "Not confirmed", className: "text-foreground/70" }
          : { label: "Pending", className: "text-foreground/70", busy: true };
  return (
    <ActivityDetailView
      network={network}
      priceOf={priceOf}
      track={track}
      account={account}
      summary={{ title: FLUENT_TRANSACTION_SWAP_LABEL }}
      movements={movements}
      timestamp={sentAt}
      status={status}
      failed={state.phase === "error"}
      estimated
      note={"message" in state ? state.message : undefined}
      operationHash={state.phase === "settled" ? state.userOpHash : undefined}
      transactionHash={state.phase === "settled" ? state.hash : undefined}
    />
  );
}

function ActivityDetailView({
  network,
  priceOf,
  track,
  account,
  summary,
  movements,
  timestamp,
  status,
  failed,
  estimated,
  note,
  operationHash,
  transactionHash,
}: {
  network: FluentWidgetNetwork;
  priceOf: ActivityPriceLookup;
  track: FluentAnalyticsTrack;
  account: string;
  summary: FluentTransactionSummary;
  movements: readonly DetailMovement[];
  timestamp: number;
  status: DetailStatus;
  failed: boolean;
  /** What a swap received is a quote, not what landed: drawn with `≈`. */
  estimated?: boolean;
  /** Why it ended as it did, under the status card. */
  note?: string;
  operationHash?: Hash;
  transactionHash?: Hash;
}) {
  // The Fluent badge, and the chain's own name where the route knows it.
  const badge = CHAIN_BADGE.l2_to_l1;
  const chainName = getFluentBridgeRoute(network)?.destination.name ?? "Fluent";
  const swap = splitFluentSwap(movements);
  const headed = swap ? swap.received : movements;
  const movement = headed[0];
  const approximate = estimated ? "≈ " : "";
  const heading =
    headed.length > 0
      ? approximate + headed.map(formatFluentTransactionAmount).join(", ")
      : FLUENT_TRANSACTION_OPERATION_LABEL;
  // A swap's heading is only what it received, so its USD line is too.
  const usd = formatFluentMovementsUsd(headed, priceOf);
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
              failed && "opacity-50 line-through",
            )}
          >
            {heading}
          </span>
          {usd ? (
            <span
              className={cn(
                "text-sm tabular-nums text-muted-foreground",
                failed && "opacity-50 line-through",
              )}
            >
              {approximate}
              {usd}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">
            {swap ? `${summary.title} ${formatFluentSwapPair(swap)}` : summary.title}
            {" · "}
            {activityDateTimeFormat.format(new Date(timestamp))}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl">
        <DetailRow label="Status">
          {status.busy ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
          <span className={status.className}>{status.label}</span>
        </DetailRow>
        {swap ? (
          <>
            {swap.paid.map((item) => (
              <SwapSideRow key={item.id} label="Paid" movement={item} priceOf={priceOf} />
            ))}
            {swap.received.map((item) => (
              <SwapSideRow
                key={item.id}
                label="Received"
                movement={item}
                priceOf={priceOf}
                approximate={approximate}
              />
            ))}
            {rate ? (
              <DetailRow label="Rate">
                {approximate}
                {rate}
              </DetailRow>
            ) : null}
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
      {note ? <p className="px-1 text-center text-xs text-muted-foreground">{note}</p> : null}

      {operationHash || transactionHash ? (
        <dl className="flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl">
          {operationHash ? (
            <DetailRow label="Operation ID">
              <HashMenu
                hash={operationHash}
                url={explorerUserOperation(operationHash, network)}
                onOpen={(url) => openExplorer(url, "user_operation")}
                label="Operation hash"
              />
            </DetailRow>
          ) : null}
          {transactionHash ? (
            <DetailRow label="Transaction ID">
              <HashMenu
                hash={transactionHash}
                url={explorerTransaction(transactionHash, network)}
                onOpen={(url) => openExplorer(url, "transaction")}
              />
            </DetailRow>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/** One side of a swap: the amount without its sign, which the label already says, and its USD. */
function SwapSideRow({
  label,
  movement,
  priceOf,
  approximate = "",
}: {
  label: string;
  movement: DetailMovement;
  priceOf: ActivityPriceLookup;
  approximate?: string;
}) {
  const usd = formatActivityUsd(movement.amount, priceOf(movement));
  return (
    <DetailRow label={label}>
      <span className="tabular-nums">
        {approximate}
        {formatFluentTransactionAmount(movement).slice(1)}
        {usd ? <span className="font-normal text-muted-foreground"> · {usd}</span> : null}
      </span>
    </DetailRow>
  );
}

/** `1 ETH = 2,305.12 USDnr`; nothing when the paid amount is zero or unreadable. */
function formatSwapRate(paid: DetailMovement, received: DetailMovement): string | undefined {
  const rate = Number(received.amount) / Number(paid.amount);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const digits = rate >= 1 ? 2 : 6;
  return `1 ${paid.symbol} = ${formatFluentLocaleAmount(rate, digits)} ${received.symbol}`;
}
