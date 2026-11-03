import { DetailRow, HashMenu } from "../bridge/BridgeActivityDetail";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import { formatFluentTransactionAmount } from "../core/transactionHistory";
import { cn } from "../lib/utils";
import { explorerAddress, explorerTransaction, formatAddress } from "../utils";
import type { FluentPendingTransfer } from "../widget/tokenTransfer";
import {
  ActivityDetailHeader,
  explorerOpener,
  FluentNetworkRow,
  riseIn,
} from "./FluentActivityDetail";
import { Spinner } from "./ui/spinner";
import { formatActivityUsd, type ActivityPriceLookup } from "./WalletMenuActivity";

/**
 * A Send as a Transfer page, opened when its review is confirmed: drawn from the transfer the
 * widget holds rather than from a row of the history, which does not list it yet. Pending until
 * `execute` resolves with the transaction hash, Confirmed with its explorer link after.
 */
export function SentTransferDetail({
  transfer,
  account,
  network,
  priceOf,
  track,
}: {
  transfer: FluentPendingTransfer;
  account: string;
  network: FluentWidgetNetwork;
  /** USD per token, for the line under the heading. */
  priceOf: ActivityPriceLookup;
  track: FluentAnalyticsTrack;
}) {
  const openExplorer = explorerOpener(track);
  const movement = { amount: transfer.amount, direction: "sent" as const, symbol: transfer.symbol };

  return (
    <div className="flex w-full flex-col gap-2.5">
      <ActivityDetailHeader
        symbol={transfer.symbol}
        heading={
          <span title={`${transfer.amount} ${transfer.symbol}`}>
            {formatFluentTransactionAmount(movement)}
          </span>
        }
        usd={formatActivityUsd(
          transfer.amount,
          priceOf({ identity: transfer.tokenIdentity, symbol: transfer.symbol }),
        )}
        subtitle="Sent"
        timestamp={transfer.startedAt}
        entrance
      />

      <dl
        className={cn("flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl", riseIn("delay-300"))}
      >
        <DetailRow label="Status">
          <span
            key={transfer.hash ? "confirmed" : "pending"}
            className="inline-flex items-center gap-1.5 animate-in fade-in-0 zoom-in-90 duration-300 ease-out motion-reduce:animate-none"
          >
            {transfer.hash ? (
              <span className="text-green-400">Confirmed</span>
            ) : (
              <>
                <Spinner className="size-3.5 text-muted-foreground" />
                <span className="text-foreground/70">Pending</span>
              </>
            )}
          </span>
        </DetailRow>
        <DetailRow label="From">
          <span title={account}>{formatAddress(account)}</span>
        </DetailRow>
        <DetailRow label="To">
          <HashMenu
            hash={transfer.to}
            url={explorerAddress(transfer.to, network)}
            onOpen={(url) => openExplorer(url, "explorer")}
            label="Address"
          />
        </DetailRow>
        <FluentNetworkRow network={network} />
      </dl>

      {transfer.hash ? (
        <dl
          className={cn("flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl", riseIn("delay-100"))}
        >
          <DetailRow label="Transaction ID">
            <HashMenu
              hash={transfer.hash}
              url={explorerTransaction(transfer.hash, network)}
              onOpen={(url) => openExplorer(url, "transaction")}
            />
          </DetailRow>
        </dl>
      ) : null}
    </div>
  );
}
