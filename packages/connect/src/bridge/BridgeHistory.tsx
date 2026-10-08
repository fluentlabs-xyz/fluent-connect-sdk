import { formatUnits } from "viem";

import { formatAddress } from "../utils";
import { ActivityTokenTile } from "./ActivityTokenTile";
import { rowTitle, type BridgeHistoryRow, type BridgeHistoryStatus } from "./historyRows";

export const STATUS_LABELS: Record<BridgeHistoryStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "text-green-400" },
  pending: { label: "Pending", className: "text-foreground/70" },
  confirming: { label: "Confirming", className: "text-foreground/70" },
  failed: { label: "Failed", className: "text-destructive" },
};

// Rows sit under a heading per day, so the row itself shows only the time.
export const activityTimeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Which account a row belongs to, when the list holds more than one. */
export function AccountTag({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-foreground/10 px-1.5 leading-[18px] text-[10px] font-normal text-foreground/70 -my-px">
      {children}
    </span>
  );
}

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
export function HistoryRow({
  row,
  tag,
  usd,
  onOpen,
}: {
  row: BridgeHistoryRow;
  /** Names the account, when the list shows more than one. */
  tag?: string;
  /** What the amount was worth, already formatted; printed under it. */
  usd?: string;
  onOpen: () => void;
}) {
  const status = STATUS_LABELS[row.status];
  const amount = formatRowAmount(row);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 p-2.5 rounded-xl text-left hover:bg-neutral-800"
      >
        <ActivityTokenTile tokenSymbol={row.tokenSymbol} badge={row.direction} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium leading-4">
            {rowTitle(row)}
            {tag ? <AccountTag>{tag}</AccountTag> : null}
          </span>
          <span className="truncate text-muted-foreground leading-4">
            {activityTimeFormat.format(new Date(row.sentAt))} ·{" "}
            <span className="leading-4">{formatAddress(row.sentTxHash)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {amount ? <span className="text-sm font-medium leading-4">{amount}</span> : null}
          {amount && usd ? (
            <span
              className={`text-xs leading-4 tabular-nums text-muted-foreground ${
                row.status === "failed" ? "line-through opacity-50" : ""
              }`}
            >
              {usd}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
