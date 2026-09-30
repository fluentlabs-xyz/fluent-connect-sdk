import { ArrowDownLeft, ArrowUpRight, Layers } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  FLUENT_TRANSACTION_DIRECTION_LABELS,
  FLUENT_TRANSACTION_STATUS_LABELS,
  formatFluentTransactionAge,
  formatFluentTransactionAmount,
  type FluentTransactionHistoryEntry,
  type FluentTransactionMovementEntry,
} from "../core/transactionHistory";
import { formatAddress } from "../utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

/**
 * Whether an element's content is wider than the room it has.
 *
 * Drives a tooltip that only exists when it adds something: on a wide drawer
 * the amounts fit, and a tooltip repeating text already fully on screen is
 * noise. Re-measured on resize, because the drawer is narrower on mobile.
 */
function useIsTruncated<T extends HTMLElement>() {
  const [truncated, setTruncated] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);

  // A callback ref rather than an effect over `ref.current`: measuring as
  // truncated wraps the line in a tooltip trigger, which remounts the node, and
  // an effect that ran once would be left observing the detached one — so the
  // line would never notice the drawer getting wider again.
  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;

    // The one-pixel allowance keeps sub-pixel layout rounding from reporting a
    // line that visibly fits as clipped.
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth + 1);
    measure();

    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, truncated };
}

function TransactionNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs opacity-50">{description}</span>
    </div>
  );
}

/**
 * Asks for the next rows once the end of the list comes within a screenful.
 *
 * `rootMargin` rather than a button: the fetch starts while the reader is still
 * scrolling, so rows are usually there by the time they look. Observing the
 * viewport works because the drawer body it scrolls in is itself on screen.
 */
function LoadMoreSentinel({ onReach, busy }: { onReach: () => void; busy: boolean }) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Read through a ref so re-creating the callback each render does not tear
  // the observer down and rebuild it.
  const latest = useRef(onReach);
  latest.current = onReach;

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sentinel} className="flex justify-center py-1">
      {busy ? (
        <span
          className="h-4 w-24 animate-pulse rounded-md bg-foreground/10"
          aria-label="Loading more transactions"
        />
      ) : null}
    </div>
  );
}

function TransactionRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3" aria-hidden="true">
      <span className="size-10 shrink-0 animate-pulse rounded-lg bg-foreground/10" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-4 w-20 animate-pulse rounded-md bg-foreground/10" />
        <span className="h-3 w-28 animate-pulse rounded-md bg-foreground/10" />
      </span>
      <span className="flex flex-col items-end gap-1.5">
        <span className="h-4 w-24 animate-pulse rounded-md bg-foreground/10" />
        <span className="h-3 w-12 animate-pulse rounded-md bg-foreground/10" />
      </span>
    </div>
  );
}

/** Title and icon differ by row kind; everything else is shared. */
function describeEntry(entry: FluentTransactionHistoryEntry) {
  if (entry.kind === "operation") {
    return { icon: <Layers className="size-4" />, title: "Operation" };
  }

  const sent = entry.direction === "sent";
  return {
    icon: sent ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />,
    title: FLUENT_TRANSACTION_DIRECTION_LABELS[entry.direction],
  };
}

function AmountLabel({
  movement,
  className = "",
}: {
  movement: FluentTransactionMovementEntry;
  className?: string;
}) {
  return (
    <span
      className={`${className} ${
        movement.status === "failed"
          ? "opacity-50 line-through"
          : movement.direction === "received"
            ? "text-green-400"
            : ""
      }`}
    >
      {formatFluentTransactionAmount(movement)}
    </span>
  );
}

/**
 * The second line of a row. For an operation that is what it moved, which is
 * the part worth reading; an operation that moved nothing falls back to naming
 * itself, so the row is never left without a subtitle.
 */
function EntrySubtitle({ entry }: { entry: FluentTransactionHistoryEntry }) {
  if (entry.kind === "movement") {
    return (
      <span className="w-full truncate text-xs leading-4 text-muted-foreground">
        {entry.direction === "sent" ? "To" : "From"} {formatAddress(entry.counterparty)}
      </span>
    );
  }

  if (entry.movements.length === 0) {
    return (
      <span className="w-full truncate text-xs leading-4 text-muted-foreground">
        Op {formatAddress(entry.hash)}
      </span>
    );
  }

  return <OperationAmounts movements={entry.movements} />;
}

/**
 * What an operation moved, on one line, with the rest behind a tooltip when it
 * does not fit. The amounts are ordered with dust last, so the part a narrow
 * row hides is the part worth least.
 */
function OperationAmounts({
  movements,
}: {
  movements: readonly FluentTransactionMovementEntry[];
}) {
  const { ref, truncated } = useIsTruncated<HTMLSpanElement>();

  // A block box, not a flex one. `text-overflow: ellipsis` only applies to
  // inline content overflowing a block container, so a flex row of amounts cuts
  // mid-glyph instead of showing an ellipsis — hence `ml-2` for spacing rather
  // than `gap`. `w-full` is load-bearing too: the column sets `items-start`, so
  // without it this sizes to its content and spills across the date.
  const line = (
    <span
      ref={ref}
      className="block w-full truncate text-xs leading-4 tabular-nums text-muted-foreground"
    >
      {movements.map((movement, index) => (
        <AmountLabel
          key={movement.id}
          movement={movement}
          className={index > 0 ? "ml-2" : undefined}
        />
      ))}
    </span>
  );

  if (!truncated) return line;

  return (
    <Tooltip>
      <TooltipTrigger
        // No `tabIndex`: the row is already a button, and putting a focusable
        // element inside one is invalid. Pointer and touch still reach it.
        render={<span className="block w-full min-w-0 cursor-default" />}
      >
        {line}
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col gap-0.5 tabular-nums">
          {movements.map((movement) => (
            <AmountLabel key={movement.id} movement={movement} />
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function WalletMenuTransactionList({
  transactions,
  hasAccount,
  busy,
  loadingMore,
  hasMore,
  onLoadMore,
  error,
  onSelect,
}: {
  transactions: readonly FluentTransactionHistoryEntry[];
  /** False before an account resolves, so the empty state can say which emptiness this is. */
  hasAccount: boolean;
  busy?: boolean;
  /** A further page is on its way; the rows already shown stay put. */
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Set when the explorer could not be read. Outranks the empty state: an
   *  unanswered request is not the same as an account with no history. */
  error?: string | null;
  /** Opening the row on the explorer — the caller owns where, so this stays presentational. */
  onSelect: (entry: FluentTransactionHistoryEntry) => void;
}) {
  // One clock for the whole list: rows rendered from the same paint should not
  // disagree about what "now" was.
  const now = Date.now();

  if (!hasAccount) {
    return (
      <TransactionNotice
        title="Not connected"
        description="Connect an account to see its transactions."
      />
    );
  }

  if (busy && transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading transactions">
        {[0, 1, 2, 3].map((row) => (
          <TransactionRowSkeleton key={row} />
        ))}
      </div>
    );
  }

  // Only when there is nothing to fall back on. A page that failed part-way
  // down keeps its rows and reports underneath them instead.
  if (error && transactions.length === 0) {
    return <TransactionNotice title="Could not load transactions" description={error} />;
  }

  if (transactions.length === 0) {
    return (
      <TransactionNotice
        title="No transactions yet"
        description="Transfers and operations from this account will show up here."
      />
    );
  }

  return (
    <TooltipProvider delay={200}>
    <div className="flex flex-col gap-4" aria-label="Transaction history">
      {transactions.map((entry) => {
        const { icon, title } = describeEntry(entry);
        const statusLabel = FLUENT_TRANSACTION_STATUS_LABELS[entry.status];

        return (
          <button
            type="button"
            key={entry.id}
            onClick={() => onSelect(entry)}
            className="flex w-full items-center gap-3 rounded-xl text-left hover:opacity-80"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground/10">
              {icon}
            </span>

            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden">
              <span className="flex max-w-full items-center gap-1 truncate text-sm font-medium leading-4">
                {title}
                {statusLabel ? (
                  <span className="rounded-md bg-destructive/20 px-1.5 leading-[18px] text-[10px] font-normal text-destructive -my-px">
                    {statusLabel}
                  </span>
                ) : null}
              </span>
              <EntrySubtitle entry={entry} />
            </span>

            {/* `shrink-0`: the date and amount always keep their space, so a long
                subtitle is clipped rather than pushing them off the row. */}
            <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
              {entry.kind === "movement" ? (
                <AmountLabel
                  movement={entry}
                  className="max-w-32 truncate text-sm font-medium leading-4"
                />
              ) : null}
              <span className="text-xs leading-4 opacity-50">
                {formatFluentTransactionAge(entry.timestamp, now)}
              </span>
            </span>
          </button>
        );
      })}

      {hasMore && onLoadMore ? (
        <LoadMoreSentinel onReach={onLoadMore} busy={Boolean(loadingMore)} />
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      ) : null}
    </div>
    </TooltipProvider>
  );
}
