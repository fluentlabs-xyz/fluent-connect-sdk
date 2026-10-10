import { Copy, ExternalLink } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { Icon } from "../components/Icon";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import { copyHexToClipboard, formatAddress } from "../utils";
import { ActivityTokenTile, CHAIN_BADGE } from "./ActivityTokenTile";
import { formatRowAmount, STATUS_LABELS } from "./BridgeHistory";
import {
  rowSentUrl,
  rowTargetUrl,
  rowTitle,
  type BridgeActivitySelection,
} from "./historyRows";
import { getFluentBridgeRoute } from "./route";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const activityDateTimeFormat = dateTimeFormat;

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right font-medium">
        {children}
      </dd>
    </div>
  );
}

/**
 * A hash with a chevron: the menu copies it, and opens the explorer when the
 * chain has one. Same idiom as the token rows' address menu.
 */
export function HashMenu({
  hash,
  url,
  onOpen,
  label = "Transaction hash",
}: {
  hash: string;
  url?: string;
  onOpen: (url: string) => void;
  /** What the clipboard toast and the menu call it: a hash of some kind, or an address. */
  label?: string;
}) {
  const noun = /address/i.test(label) ? "address" : "hash";
  return (
    <Select
      value={null}
      onValueChange={(value) => {
        if (value === "copy") void copyHexToClipboard(hash, label);
        else if (value === "open" && url) onOpen(url);
      }}
    >
      <SelectTrigger
        aria-label={`${label} actions`}
        title={hash}
        className="!h-auto gap-1 border-0 bg-transparent p-0 text-sm font-medium shadow-none hover:opacity-80 aria-expanded:opacity-80 dark:bg-transparent dark:hover:bg-transparent"
      >
        <span>{formatAddress(hash)}</span>
      </SelectTrigger>
      {/* Sized to the items, not the short hash it hangs off. */}
      <SelectContent align="end" alignItemWithTrigger={false} className="w-auto">
        <SelectItem value="copy">
          <Copy className="size-4" />
          Copy {noun}
        </SelectItem>
        {url ? (
          <SelectItem value="open">
            <ExternalLink className="size-4" />
            Open in explorer
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/**
 * One transfer in full — the `activity` sub-page. Everything shown is already on
 * the row the user tapped, so this needs no wallet and no fetch; the route only
 * supplies chain names and explorer links, and the page degrades to plain text
 * without it.
 */
export function BridgeActivityDetail({
  selection,
  network,
  usd,
  track,
}: {
  selection: BridgeActivitySelection;
  network: FluentWidgetNetwork;
  /** What the amount was worth, already formatted; printed under it. */
  usd?: string;
  track: FluentAnalyticsTrack;
}) {
  const { row, account } = selection;
  const route = useMemo(() => getFluentBridgeRoute(network), [network]);
  const status = STATUS_LABELS[row.status];
  const amount = formatRowAmount(row);
  // Where the transfer left from: a deposit leaves L1, a withdrawal leaves Fluent.
  const sentFrom = row.direction === "l1_to_l2" ? route?.source : route?.destination;
  const chainName = sentFrom?.name ?? (row.direction === "l1_to_l2" ? "Ethereum" : "Fluent");
  const badge = CHAIN_BADGE[row.direction];

  const sentUrl = route ? rowSentUrl(row, route) : undefined;
  const deliveredUrl = route && row.receivedTxHash ? rowTargetUrl(row, route) : undefined;

  const openExplorer = (url: string, label: "transaction" | "delivery") => {
    track("outbound_link_clicked", {
      label,
      destination_domain: new URL(url, location.href).hostname,
      surface: "activity_page",
    });
    const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };

  return (
    <div className="flex w-full flex-col gap-2.5">

      <div className="flex flex-col items-center gap-3 py-3">
        <ActivityTokenTile tokenSymbol={row.tokenSymbol} badge={row.direction} />
        <div className="flex flex-col items-center gap-0">
          <span className="min-w-0 truncate text-2xl font-medium">{amount ?? rowTitle(row)}</span>
          {amount && usd ? (
            <span
              className={`text-sm tabular-nums text-muted-foreground ${
                row.status === "failed" ? "line-through opacity-50" : ""
              }`}
            >
              {usd}
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">{dateTimeFormat.format(new Date(row.sentAt))}</span>
        </div>
      </div> 

      <dl className="flex flex-col gap-5 text-sm bg-neutral-900 p-4 rounded-2xl">
        <DetailRow label="Status">
          <span className={status.className}>{status.label}</span>
        </DetailRow>
        <DetailRow label="Account">
          <span title={account}>
            {formatAddress(account)}
          </span>
        </DetailRow>
        <DetailRow label="Network">
          <span
            className={`flex size-5 items-center justify-center rounded-full ${badge.bgClassName}`}
          >
            <Icon name={badge.icon} className={`size-3 ${badge.iconClassName}`} />
          </span>
          {chainName}
        </DetailRow>
      </dl>

      <dl className="flex flex-col gap-5 text-sm bg-neutral-900 p-4 rounded-2xl">
        <DetailRow label="Transaction ID">
          <HashMenu
            hash={row.sentTxHash}
            url={sentUrl}
            onOpen={(url) => openExplorer(url, "transaction")}
          />
        </DetailRow>
        {row.receivedTxHash ? (
          <DetailRow label="Delivered by">
            <HashMenu
              hash={row.receivedTxHash}
              url={deliveredUrl}
              onOpen={(url) => openExplorer(url, "delivery")}
            />
          </DetailRow>
        ) : null}
        </dl>

    </div>
  );
}
