import { Layers } from "lucide-react";
import { Fragment, useContext, useMemo, type ReactNode } from "react";
import { WagmiContext } from "wagmi";

import { ActivityTokenTile } from "../bridge/ActivityTokenTile";
import { AccountTag, activityTimeFormat, HistoryRow } from "../bridge/BridgeHistory";
import type { BridgeActivitySelection } from "../bridge/historyRows";
import { getFluentBridgeRoute } from "../bridge/route";
import { useBridgeHistoryRows, type BridgeHistoryState } from "../bridge/useBridgeHistoryRows";
import type { FluentWidgetNetwork } from "../core/network";
import {
  describeFluentTransaction,
  FLUENT_TRANSACTION_STATUS_LABELS,
  formatFluentTransactionAmount,
  type FluentTransactionHistoryEntry,
  type FluentTransactionMovementEntry,
} from "../core/transactionHistory";
import { cn } from "../lib/utils";
import { formatAddress, formatFluentLocaleAmount } from "../utils";
import type { FluentPendingTransfer } from "../widget/tokenTransfer";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

/** The account's on-chain transactions, as `useFluentTransactionHistory` hands them over. */
export type FluentActivityState = {
  /** The account the entries belong to; unset before one resolves. */
  address?: `0x${string}`;
  /** "Fluent account" with a Fluent ID; "Wallet" when the External wallet is the account. */
  label: string;
  entries: readonly FluentTransactionHistoryEntry[];
  /**
   * Transfers the widget has sent and is still waiting on. Listed above the
   * mined rows and replaced by the real one once the history catches up.
   */
  pending?: readonly FluentPendingTransfer[];
  busy: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
};

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

type Item = { id: string; at: number; node: ReactNode };

/** Runs of consecutive items on the same local calendar day, for a sorted list. */
function groupByDay(items: Item[]): { day: Date; items: Item[] }[] {
  const groups: { day: Date; items: Item[] }[] = [];
  for (const item of items) {
    const at = new Date(item.at);
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const last = groups[groups.length - 1];
    if (last && last.day.getTime() === day.getTime()) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs opacity-50">{description}</span>
    </div>
  );
}

/**
 * A transfer still in flight. Not a button: there is nothing to open yet, and
 * no hash to open it with — the explorer has never heard of this transfer.
 */
function PendingActivityRow({ transfer }: { transfer: FluentPendingTransfer }) {
  return (
    <li>
      <div className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left">
        <ActivityTokenTile tokenSymbol={transfer.symbol} badge="l2_to_l1" surface="row" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium leading-4">
            Sending
            <Spinner className="size-3 text-muted-foreground" />
          </span>
          <span className="truncate leading-4 text-muted-foreground">
            To {formatAddress(transfer.to)}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium leading-4 tabular-nums opacity-70">
          −{formatFluentLocaleAmount(transfer.amount, 6)} {transfer.symbol}
        </span>
      </div>
    </li>
  );
}

/** `−40 USDnr` in the row's amount column: struck through once failed, green when it came in. */
function ActivityAmount({
  movement,
  status,
}: {
  movement: Pick<FluentTransactionMovementEntry, "amount" | "direction" | "symbol">;
  status: FluentTransactionHistoryEntry["status"];
}) {
  return (
    <span
      className={cn(
        "text-sm font-medium leading-4 tabular-nums",
        status === "failed"
          ? "opacity-50 line-through"
          : movement.direction === "received"
            ? "text-green-400"
            : undefined,
      )}
    >
      {formatFluentTransactionAmount(movement)}
    </span>
  );
}

/**
 * One of the Fluent account's transactions, laid out like a bridge transfer:
 * token tile badged with the chain, what happened, when and with whom, and
 * the amounts. An operation reads as what it did — a send is "Sent" to its
 * recipient with the amount on the right, not an "Operation" with the amount
 * buried in the detail line. One that moved nothing names itself instead.
 */
function FluentActivityRow({
  entry,
  tag,
  onOpen,
}: {
  entry: FluentTransactionHistoryEntry;
  tag?: string;
  onOpen: () => void;
}) {
  const movement = entry.kind === "movement" ? entry : entry.movements[0];
  const movements = entry.kind === "movement" ? [entry] : entry.movements;
  const summary = describeFluentTransaction(entry);
  const statusLabel = FLUENT_TRANSACTION_STATUS_LABELS[entry.status];
  const detail = summary.counterparty
    ? `${summary.direction === "sent" ? "To" : "From"} ${formatAddress(summary.counterparty)}`
    : `Op ${formatAddress(entry.hash)}`;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 p-2.5 rounded-xl text-left hover:bg-white/10"
      >
        {movement ? (
          // `l2_to_l1` is the Fluent badge: this row lives on Fluent.
          <ActivityTokenTile tokenSymbol={movement.symbol} badge="l2_to_l1" surface="row" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10">
            <Layers className="size-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium leading-4">
            {summary.title}
            {statusLabel ? (
              <span className="rounded-md bg-destructive/20 px-1.5 leading-[18px] text-[10px] font-normal text-destructive -my-px">
                {statusLabel}
              </span>
            ) : null}
            {tag ? <AccountTag>{tag}</AccountTag> : null}
          </span>
          <span className="truncate text-muted-foreground leading-4">
            {activityTimeFormat.format(new Date(entry.timestamp))} · {detail}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {movements.map((item) => (
            <ActivityAmount key={item.id} movement={item} status={entry.status} />
          ))}
        </span>
      </button>
    </li>
  );
}

export type WalletMenuActivityProps = {
  fluent: FluentActivityState;
  /** The External wallet, when the card knows one even before wagmi reports it. */
  externalWalletAddress?: string;
  onOpenBridgeRow: (selection: BridgeActivitySelection) => void;
  onOpenFluentEntry: (entry: FluentTransactionHistoryEntry) => void;
};

/**
 * The list itself, given both sources. Exported for the preview harness, which
 * fabricates rows rather than reaching an indexer; the widget renders it
 * through `WalletMenuActivity`, which reads the bridge rows for real.
 */
export function WalletMenuActivityList({
  fluent,
  bridge,
  externalWalletAddress,
  onOpenBridgeRow,
  onOpenFluentEntry,
}: WalletMenuActivityProps & { bridge: BridgeHistoryState | null }) {
  const walletAddress = bridge?.address ?? externalWalletAddress;
  // Two accounts on one list: a Fluent ID, and the External wallet that funds
  // its deposits. Without a Fluent ID the wallet is the account, and its bridge
  // transfers are just another kind of its activity — one account, no tags.
  const twoAccounts = Boolean(
    fluent.address && walletAddress && fluent.address.toLowerCase() !== walletAddress.toLowerCase(),
  );

  // Every hash the history already accounts for, so a settled transfer's
  // stand-in disappears exactly as its real row arrives — not before, which
  // would drop it off the list for as long as the indexer lags the receipt.
  const listedHashes = useMemo(() => {
    const hashes = new Set<string>();
    for (const entry of fluent.entries) {
      hashes.add(entry.hash.toLowerCase());
      if (entry.kind === "operation") hashes.add(entry.transactionHash.toLowerCase());
    }
    return hashes;
  }, [fluent.entries]);

  const items = useMemo(() => {
    const list: Item[] = (fluent.pending ?? [])
      .filter((transfer) => !transfer.hash || !listedHashes.has(transfer.hash.toLowerCase()))
      .map((transfer) => ({
        id: `pending:${transfer.id}`,
        at: transfer.startedAt,
        node: <PendingActivityRow key={transfer.id} transfer={transfer} />,
      }));
    list.push(...fluent.entries.map((entry) => ({
      id: `fluent:${entry.id}`,
      at: entry.timestamp,
      node: (
        <FluentActivityRow
          entry={entry}
          tag={twoAccounts ? fluent.label : undefined}
          onOpen={() => onOpenFluentEntry(entry)}
        />
      ),
    })));
    const account = bridge?.address;
    if (account) {
      for (const row of bridge.rows) {
        list.push({
          id: `bridge:${row.id}`,
          at: new Date(row.sentAt).getTime(),
          node: (
            <HistoryRow
              row={row}
              tag={twoAccounts ? "Wallet" : undefined}
              onOpen={() => onOpenBridgeRow({ row, account })}
            />
          ),
        });
      }
    }
    return list.sort((a, b) => b.at - a.at);
  }, [bridge?.address, bridge?.rows, fluent.entries, fluent.label, fluent.pending, listedHashes, onOpenBridgeRow, onOpenFluentEntry, twoAccounts]);

  if (!fluent.address && !walletAddress) {
    return <Notice title="Not connected" description="Connect an account to see its activity." />;
  }

  // Wait for every source's first page before the first paint, or the list
  // would reorder itself a second later when the other one lands.
  if (items.length === 0 && (fluent.busy || bridge?.pending)) {
    return (
      <div className="flex w-full items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Spinner className="size-4" />
        Loading activity…
      </div>
    );
  }

  const errors = [
    fluent.error,
    bridge?.error ? `Bridge transfers could not be loaded: ${bridge.error}` : null,
    bridge?.hyperlaneError ? "Fast-path transfers could not be loaded right now." : null,
  ].filter((message): message is string => Boolean(message));
  const hasMore = fluent.hasMore || Boolean(bridge?.hasNextPage);
  const loadingMore = fluent.loadingMore || Boolean(bridge?.isFetchingNextPage);

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {items.length === 0 ? (
        errors.length > 0 ? (
          <Notice title="Could not load activity" description={errors.join(" ")} />
        ) : (
          <Notice
            title="No activity yet"
            description="Transfers, operations and bridge deposits will show up here."
          />
        )
      ) : (
        groupByDay(items).map((group) => (
          <div key={group.day.getTime()} className="flex flex-col gap-2.5">
            <span className="text-sm text-muted-foreground">{dayFormat.format(group.day)}</span>
            <ul className="flex flex-col gap-1 bg-white/5 rounded-2xl p-1">
              {group.items.map((item) => (
                <Fragment key={item.id}>{item.node}</Fragment>
              ))}
            </ul>
          </div>
        ))
      )}
      {items.length > 0 && errors.length > 0 ? (
        <p className="text-center text-xs text-destructive" role="status">
          {errors.join(" ")}
        </p>
      ) : null}
      {hasMore ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={loadingMore}
          onClick={() => {
            if (fluent.hasMore) fluent.loadMore();
            if (bridge?.hasNextPage) bridge.fetchNextPage();
          }}
        >
          {loadingMore ? (
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

function ActivityWithBridge({
  route,
  network,
  ...props
}: WalletMenuActivityProps & { route: NonNullable<ReturnType<typeof getFluentBridgeRoute>>; network: FluentWidgetNetwork }) {
  const bridge = useBridgeHistoryRows({ route, network });
  return <WalletMenuActivityList {...props} bridge={bridge} />;
}

/**
 * The wallet menu's Activity panel: one list, newest first, of everything the
 * person's accounts did — the Fluent account's transactions from FluentScan
 * and the External wallet's bridge transfers.
 *
 * The bridge rows read that wallet through wagmi, so they only join the list
 * where wagmi exists. `ReownProvider` renders its children bare without a
 * Reown project id, and the preview harnesses mount the card on its own;
 * neither should crash the panel, they just lose the bridge rows.
 */
export function WalletMenuActivity({
  network,
  ...props
}: WalletMenuActivityProps & { network: FluentWidgetNetwork }) {
  const route = useMemo(() => getFluentBridgeRoute(network), [network]);
  const hasWagmi = useContext(WagmiContext) !== undefined;
  if (route && hasWagmi) return <ActivityWithBridge route={route} network={network} {...props} />;
  return <WalletMenuActivityList {...props} bridge={null} />;
}
