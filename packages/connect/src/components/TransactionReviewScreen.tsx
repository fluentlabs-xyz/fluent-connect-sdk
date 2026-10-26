import { Layers } from "lucide-react";

import { CHAIN_BADGE } from "../bridge/ActivityTokenTile";
import { DetailRow, HashMenu } from "../bridge/BridgeActivityDetail";
import { getFluentBridgeRoute } from "../bridge/route";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import { explorerAddress } from "../utils";
import type { FluentBatchOperationReview } from "../widget/batchOperation";
import { formatAmount } from "./AmountForm";
import { Icon } from "./Icon";
import { Button } from "./ui/button";

/**
 * What a transaction looks like before it is signed — the `review` sub-page,
 * laid out like a transfer's detail page: who signs, on which network, then
 * every call the operation makes, and the cancel / confirm pair. Opened by the
 * widget itself whenever an execution needs confirming; Back and Cancel both
 * reject it.
 */
export function TransactionReviewScreen({
  operation,
  network,
  appName,
  track,
  onConfirm,
  onCancel,
}: {
  operation: FluentBatchOperationReview;
  network: FluentWidgetNetwork;
  /** The App asking, named the way the connect dialog names it. */
  appName: string;
  track: FluentAnalyticsTrack;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const badge = CHAIN_BADGE.l2_to_l1;
  const chainName = getFluentBridgeRoute(network)?.destination.name ?? "Fluent";
  const address = operation.account?.address;
  const calls = operation.encodedCalls;

  const openExplorer = (url: string) => {
    track("outbound_link_clicked", {
      label: "explorer",
      destination_domain: new URL(url, location.href).hostname,
      surface: "transaction_review",
    });
    const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };

  return (
    // `flex-1`: the drawer lays its page out as a flex column, so the page fills
    // it and the buttons can sit at the bottom whatever the call count.
    <div className="flex w-full flex-1 flex-col gap-2.5" aria-label="Confirm Fluent transaction">
      <div className="flex flex-col items-center gap-3 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10">
          <Layers className="size-4" />
        </span>
        <div className="flex flex-col items-center gap-0 text-center">
          <span className="min-w-0 max-w-full truncate text-2xl font-medium">
            {operation.reviewTitle ?? "Confirm transaction"}
          </span>
          <span className="text-sm text-muted-foreground">
            {appName}
            {" · "}
            {calls.length === 1 ? "1 call" : `${calls.length} calls`}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-5 rounded-2xl bg-neutral-900 p-4 text-sm">
        <DetailRow label="Signing account">
          {address ? (
            <HashMenu
              hash={address}
              url={explorerAddress(address, network)}
              onOpen={openExplorer}
              label="Address"
            />
          ) : (
            "Fluent account"
          )}
        </DetailRow>
        <DetailRow label="Network">
          <span className={`flex size-5 items-center justify-center rounded-full ${badge.bgClassName}`}>
            <Icon name={badge.icon} className={`size-3 ${badge.iconClassName}`} />
          </span>
          {chainName}
        </DetailRow>
      </dl>

      <dl className="flex flex-col gap-5 rounded-2xl bg-neutral-900 p-4 text-sm" aria-label="Transaction calls">
        {calls.map((call, index) => {
          const label =
            call.label ??
            operation.calls[index]?.method ??
            "Contract call";
          return (
            <div key={call.id ?? `${call.to}-${index}`} className="flex flex-col gap-1.5">
              <DetailRow label={label}>
                <HashMenu
                  hash={call.to}
                  url={explorerAddress(call.to, network)}
                  onOpen={openExplorer}
                  label="Contract address"
                />
              </DetailRow>
              {call.value > 0n ? (
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Value</span>
                  <span className="font-medium text-foreground/80" title={`${call.value.toString()} wei`}>
                    {formatAmount(call.value, 18)} ETH
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </dl>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button type="button" onClick={onConfirm}>
          Confirm and sign
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
