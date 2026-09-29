import { useMemo, type ReactNode } from "react";

import { Icon } from "../components/Icon";
import type { FluentWidgetNetwork } from "../core/network";
import { formatAddress } from "../utils";
import { ActivityTokenTile, CHAIN_BADGE } from "./ActivityTokenTile";
import { formatRowAmount, STATUS_LABELS } from "./BridgeHistory";
import { rowTitle, type BridgeActivitySelection } from "./historyRows";
import { getFluentBridgeRoute } from "./route";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
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
 * One transfer in full — the `activity` sub-page. Everything shown is already on
 * the row the user tapped, so this needs no wallet and no fetch; the route only
 * supplies chain names and explorer links, and the page degrades to plain text
 * without it.
 */
export function BridgeActivityDetail({
  selection,
  network,
}: {
  selection: BridgeActivitySelection;
  network: FluentWidgetNetwork;
}) {
  const { row, account } = selection;
  const route = useMemo(() => getFluentBridgeRoute(network), [network]);
  const status = STATUS_LABELS[row.status];
  const amount = formatRowAmount(row);
  // Where the transfer left from: a deposit leaves L1, a withdrawal leaves Fluent.
  const sentFrom = row.direction === "l1_to_l2" ? route?.source : route?.destination;
  const chainName = sentFrom?.name ?? (row.direction === "l1_to_l2" ? "Ethereum" : "Fluent");
  const badge = CHAIN_BADGE[row.direction];

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex flex-col items-center gap-3 py-3">
        <ActivityTokenTile row={row} />
        <div className="flex flex-col items-center gap-0">
          <span className="min-w-0 truncate text-2xl font-medium">{amount ?? rowTitle(row)}</span>
          <span className="text-sm text-muted-foreground">{dateTimeFormat.format(new Date(row.sentAt))}</span>
        </div>
      </div> 

      <dl className="flex flex-col gap-5 text-sm bg-foreground/5 p-5 rounded-xl">
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

      <dl className="flex flex-col gap-5 text-sm bg-foreground/5 p-5 rounded-xl">
      <DetailRow label="Transaction ID">
        <span>{formatAddress(row.sentTxHash)}</span>
        </DetailRow>
        {row.receivedTxHash ? (
          <DetailRow label="Delivered by">
            <span>{formatAddress(row.receivedTxHash)}</span>
          </DetailRow>
        ) : null}
        </dl>

    </div>
  );
}
