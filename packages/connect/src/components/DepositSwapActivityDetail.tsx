import { formatUnits } from "viem";

import { DetailRow, HashMenu } from "../bridge/BridgeActivityDetail";
import { depositSwapCopy, type DepositSwapInFlight } from "../bridge/depositSwapCopy";
import { getFluentBridgeRoute } from "../bridge/route";
import type { FluentAnalyticsTrack } from "../core/analytics";
import type { FluentWidgetNetwork } from "../core/network";
import { formatFluentTransactionAmount } from "../core/transactionHistory";
import { explorerTransaction, explorerUserOperation, formatAddress } from "../utils";
import type { FluentDepositSwap } from "../widget/hooks/useFluentDepositSwap";
import { cn } from "../lib/utils";
import {
  ActivityDetailHeader,
  explorerOpener,
  FluentNetworkRow,
  formatSwapRate,
  riseIn,
  SwapSideRow,
  type DetailMovement,
} from "./FluentActivityDetail";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { formatActivityUsd, type ActivityPriceLookup } from "./WalletMenuActivity";

type StepStatus = { label: string; className: string; busy?: boolean };

const PENDING: StepStatus = { label: "Pending", className: "text-foreground/70", busy: true };
const MUTED = "text-muted-foreground";

/** Where the bridge leg stands: on its way, failed, or landed on the Fluent ID. */
function depositStatus(state: DepositSwapInFlight): StepStatus {
  if (state.phase === "bridging") return PENDING;
  if (state.phase === "bridge_failed") return { label: "Failed", className: "text-destructive" };
  return { label: "Landed", className: "text-green-400" };
}

/** Where the swap leg stands, including before it could start. */
function swapStatus(state: DepositSwapInFlight): StepStatus {
  switch (state.phase) {
    case "bridging":
      return { label: "Waiting for the deposit", className: MUTED };
    case "bridge_failed":
      return { label: "Not sent", className: MUTED };
    case "ready":
      return state.leg.from.amount === 0n ? { label: "Skipped", className: MUTED } : PENDING;
    case "swapping":
      return PENDING;
    case "settled":
      return { label: "Confirmed", className: "text-green-400" };
    case "declined":
      return { label: "Waiting for you", className: MUTED };
    case "error":
      return { label: "Failed", className: "text-destructive" };
    case "unconfirmed":
      return { label: "Not confirmed", className: MUTED };
  }
}

/** A leg's status, faded in afresh each time it changes, so Pending turning Landed is seen. */
function StepStatusCell({ status }: { status: StepStatus }) {
  return (
    <span
      key={status.label}
      className={cn(
        "inline-flex items-center gap-1.5",
        "animate-in fade-in-0 zoom-in-90 duration-300 ease-out motion-reduce:animate-none",
      )}
    >
      {status.busy ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
      <span className={status.className}>{status.label}</span>
    </span>
  );
}

/**
 * A Two-step deposit as a Transfer page, from its signature on: opened in place of the Swap
 * page's status screen, and drawn from the state held above the drawer, since the history
 * lists neither leg until it is mined and indexed.
 *
 * Each leg has its own status row. What the swap receives is the quote it was sent at, so it
 * is marked as an estimate. Where the next move is the person's — a swap to confirm again, a
 * deposit that failed or is slow — the Swap page, which holds those actions, is one press away.
 */
export function DepositSwapActivityDetail({
  depositSwap,
  account,
  network,
  priceOf,
  track,
  onOpenSwapPage,
}: {
  depositSwap: FluentDepositSwap;
  account: string;
  network: FluentWidgetNetwork;
  priceOf: ActivityPriceLookup;
  track: FluentAnalyticsTrack;
  /** Opens the Swap page, where a Two-step deposit's actions are. */
  onOpenSwapPage: () => void;
}) {
  const { state, slow } = depositSwap;
  const route = getFluentBridgeRoute(network);
  if (state.phase === "idle" || !route) return null;

  const leg = "leg" in state ? state.leg : undefined;
  const deposit = state.phase === "bridging" || state.phase === "bridge_failed"
    ? state.deposit
    : undefined;
  const from = leg?.from ?? deposit!.from;
  const to = leg?.to ?? deposit!.to;
  const sentHash = deposit?.sentHash ?? leg?.deposit?.sentHash;
  const startedAt = deposit?.startedAt ?? leg?.deposit?.startedAt;

  const paid: DetailMovement = {
    id: "paid",
    direction: "sent",
    symbol: from.symbol,
    amount: formatUnits(leg ? leg.from.amount : deposit!.expected, from.decimals),
  };
  const received: DetailMovement | undefined =
    leg?.to.amount === undefined
      ? undefined
      : {
          id: "received",
          direction: "received",
          symbol: to.symbol,
          amount: formatUnits(leg.to.amount, to.decimals),
        };
  const rate = received ? formatSwapRate(paid, received) : undefined;
  const usd = received
    ? formatActivityUsd(received.amount, priceOf(received))
    : formatActivityUsd(paid.amount, priceOf(paid));

  // What the Swap page would have said, kept for the states where it says more than the rows.
  const { detail } = depositSwapCopy(state, slow, route);
  const note =
    (state.phase === "bridging" && slow) ||
    state.phase === "bridge_failed" ||
    (state.phase === "ready" && state.leg.from.amount === 0n) ||
    state.phase === "declined" ||
    state.phase === "error" ||
    state.phase === "unconfirmed"
      ? detail
      : undefined;
  const actionable =
    (state.phase === "bridging" && slow) ||
    state.phase === "bridge_failed" ||
    state.phase === "declined" ||
    state.phase === "error";

  const openExplorer = explorerOpener(track);
  const sourceExplorer = route.source.blockExplorers?.default.url;
  const settled = state.phase === "settled" ? state : undefined;

  return (
    <div className="flex w-full flex-col gap-2.5">
      <ActivityDetailHeader
        symbol={to.symbol}
        heading={
          received
            ? `≈ ${formatFluentTransactionAmount(received)}`
            : `${formatFluentTransactionAmount(paid).slice(1)} → ${to.symbol}`
        }
        usd={usd ? `${received ? "≈ " : ""}${usd}` : undefined}
        subtitle={`Deposit ${from.symbol} → ${to.symbol}`}
        timestamp={startedAt ?? Date.now()}
        entrance
      />

      <dl
        className={cn("flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl", riseIn("delay-300"))}
      >
        <DetailRow label="Deposit">
          <StepStatusCell status={depositStatus(state)} />
        </DetailRow>
        <DetailRow label="Swap">
          <StepStatusCell status={swapStatus(state)} />
        </DetailRow>
        <SwapSideRow label="Paid" movement={paid} priceOf={priceOf} />
        {received ? (
          <SwapSideRow label="Received" movement={received} priceOf={priceOf} approximate />
        ) : null}
        {rate ? <DetailRow label="Rate">≈ {rate}</DetailRow> : null}
        <DetailRow label="Account">
          <span title={account}>{formatAddress(account)}</span>
        </DetailRow>
        <FluentNetworkRow network={network} />
      </dl>
      {note ? (
        <p className={cn("px-1 text-center text-xs text-muted-foreground", riseIn("delay-400"))}>
          {note}
        </p>
      ) : null}

      {sentHash || settled ? (
        <dl
          className={cn(
            "flex flex-col gap-5 text-sm bg-white/5 p-4 rounded-2xl",
            riseIn("delay-450"),
          )}
        >
          {sentHash ? (
            <DetailRow label="Deposit ID">
              <HashMenu
                hash={sentHash}
                url={sourceExplorer ? `${sourceExplorer}/tx/${sentHash}` : undefined}
                onOpen={(url) => openExplorer(url, "transaction")}
              />
            </DetailRow>
          ) : null}
          {settled?.userOpHash ? (
            <DetailRow label="Operation ID">
              <HashMenu
                hash={settled.userOpHash}
                url={explorerUserOperation(settled.userOpHash, network)}
                onOpen={(url) => openExplorer(url, "user_operation")}
                label="Operation hash"
              />
            </DetailRow>
          ) : null}
          {settled ? (
            <DetailRow label="Swap ID">
              <HashMenu
                hash={settled.hash}
                url={explorerTransaction(settled.hash, network)}
                onOpen={(url) => openExplorer(url, "transaction")}
              />
            </DetailRow>
          ) : null}
        </dl>
      ) : null}

      {actionable ? (
        <Button className={cn("w-full", riseIn("delay-500"))} onClick={onOpenSwapPage}>
          {state.phase === "declined" || state.phase === "error"
            ? `Swap to ${to.symbol}`
            : "Open the Swap page"}
        </Button>
      ) : null}
    </div>
  );
}
