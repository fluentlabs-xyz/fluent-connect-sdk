import { Layers } from "lucide-react";
import type { ReactNode } from "react";

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

/** The parts of a movement the detail screens draw. */
export type DetailMovement = Pick<
  FluentTransactionMovementEntry,
  "id" | "amount" | "direction" | "symbol"
>;

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
  const summary = describeFluentTransaction(entry);
  const movements = entry.kind === "movement" ? [entry] : entry.movements;
  const swap = splitFluentSwap(movements);
  const headed = swap ? swap.received : movements;
  const heading =
    headed.length > 0
      ? headed.map(formatFluentTransactionAmount).join(", ")
      : FLUENT_TRANSACTION_OPERATION_LABEL;
  const rate =
    swap?.received.length === 1 && swap.paid.length === 1
      ? formatSwapRate(swap.paid[0]!, swap.received[0]!)
      : undefined;
  const openExplorer = explorerOpener(track);
  const transactionHash = entry.kind === "operation" ? entry.transactionHash : entry.hash;

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
      <ActivityDetailHeader
        symbol={headed[0]?.symbol}
        heading={heading}
        // A swap's heading is only what it received, so its USD line is too.
        usd={formatFluentMovementsUsd(headed, priceOf)}
        subtitle={swap ? `${summary.title} ${formatFluentSwapPair(swap)}` : summary.title}
        timestamp={entry.timestamp}
        failed={entry.status === "failed"}
      />

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
        <FluentNetworkRow network={network} />
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
            hash={transactionHash}
            url={explorerTransaction(transactionHash, network)}
            onOpen={(url) => openExplorer(url, "transaction")}
          />
        </DetailRow>
      </dl>
    </div>
  );
}

/** Opens an explorer page from a detail screen in a new tab, counting the click. */
export function explorerOpener(track: FluentAnalyticsTrack) {
  return (url: string, label: "transaction" | "user_operation" | "explorer") => {
    track("outbound_link_clicked", {
      label,
      destination_domain: new URL(url, location.href).hostname,
      surface: "activity_page",
    });
    const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };
}

/**
 * A block that fades up into place when it mounts, `delay` after the page does, so a page
 * built from several reads as one sequence. Still for anyone who asks for reduced motion.
 */
export function riseIn(delay: string): string {
  return cn(
    "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out fill-mode-both",
    "motion-reduce:animate-none",
    delay,
  );
}

/** The top of a detail screen: the token tile, the amount and its USD, then what and when. */
export function ActivityDetailHeader({
  symbol,
  heading,
  usd,
  subtitle,
  timestamp,
  failed = false,
  entrance = false,
}: {
  /** The token the tile shows; a plain layers tile without one. */
  symbol?: string;
  heading: ReactNode;
  usd?: ReactNode;
  subtitle: string;
  timestamp: number;
  failed?: boolean;
  /**
   * Plays the page in as something just done: the tile pops in with a ring rippling off it,
   * and the amount rises in after it.
   */
  entrance?: boolean;
}) {
  const tile = symbol ? (
    <ActivityTokenTile tokenSymbol={symbol} badge="l2_to_l1" />
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10">
      <Layers className="size-4" />
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-3 py-3">
      {entrance ? (
        <span className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 rounded-full ring-2 ring-foreground/40",
              "animate-out fade-out-0 zoom-out-200 duration-700 ease-out delay-200 fill-mode-both",
              "motion-reduce:hidden",
            )}
          />
          <span
            className={cn(
              "block animate-in fade-in-0 zoom-in-50 duration-500 ease-out fill-mode-both",
              "motion-reduce:animate-none",
            )}
          >
            {tile}
          </span>
        </span>
      ) : (
        tile
      )}
      <div className={cn("flex flex-col items-center gap-0", entrance && riseIn("delay-150"))}>
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
            {usd}
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {subtitle}
          {" · "}
          {activityDateTimeFormat.format(new Date(timestamp))}
        </span>
      </div>
    </div>
  );
}

/** The Fluent badge, and the chain's own name where the route knows it. */
export function FluentNetworkRow({ network }: { network: FluentWidgetNetwork }) {
  const badge = CHAIN_BADGE.l2_to_l1;
  const chainName = getFluentBridgeRoute(network)?.destination.name ?? "Fluent";
  return (
    <DetailRow label="Network">
      <span className={`flex size-5 items-center justify-center rounded-full ${badge.bgClassName}`}>
        <Icon name={badge.icon} className={`size-3 ${badge.iconClassName}`} />
      </span>
      {chainName}
    </DetailRow>
  );
}

/**
 * One side of a swap: the amount without its sign, which the label already says, and its USD.
 * `approximate` marks an amount that is a quote rather than what landed.
 */
export function SwapSideRow({
  label,
  movement,
  priceOf,
  approximate = false,
}: {
  label: string;
  movement: DetailMovement;
  priceOf: ActivityPriceLookup;
  approximate?: boolean;
}) {
  const usd = formatActivityUsd(movement.amount, priceOf(movement));
  return (
    <DetailRow label={label}>
      <span className="tabular-nums">
        {approximate ? "≈ " : null}
        {formatFluentTransactionAmount(movement).slice(1)}
        {usd ? <span className="font-normal text-muted-foreground"> · {usd}</span> : null}
      </span>
    </DetailRow>
  );
}

/** `1 ETH = 2,305.12 USDnr`; nothing when the paid amount is zero or unreadable. */
export function formatSwapRate(paid: DetailMovement, received: DetailMovement): string | undefined {
  const rate = Number(received.amount) / Number(paid.amount);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const digits = rate >= 1 ? 2 : 6;
  return `1 ${paid.symbol} = ${formatFluentLocaleAmount(rate, digits)} ${received.symbol}`;
}
