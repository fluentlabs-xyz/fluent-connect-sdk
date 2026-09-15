import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { formatUnits } from "viem";
import type { Address } from "viem";

import { Icon, type IconName } from "../components/Icon";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import type { FluentWidgetNetwork } from "../core/network";
import { formatAddress } from "../utils";
import type { FluentBridgeRoute } from "./route";
import {
  getBridgeToken,
  getBridgeTokens,
  isBridgeTokenAvailable,
  type BridgeToken,
  type BridgeTokenSymbol,
} from "./tokens";
import { useBridgeDeposit } from "./useBridgeDeposit";

/** Six fraction digits is where a figure stops being readable in 384px. */
function formatAmount(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "—";
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

const TOKEN_ICONS: Record<BridgeTokenSymbol, IconName> = {
  ETH: "eth",
  BLEND: "blend",
  USDnr: "usdnr",
  USDC: "usdc",
};

function AmountCard({
  label,
  children,
  footer,
}: {
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl bg-foreground/5 p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {footer}
    </div>
  );
}

/** The token being bridged, with the chain it sits on. Static — the choice is made on the pay side. */
function TokenChip({ token, chainName }: { token: BridgeToken; chainName: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/10 py-1 pl-1.5 pr-2.5 text-sm font-medium">
      <Icon name={TOKEN_ICONS[token.symbol]} className="size-4" />
      {token.symbol}
      <span className="text-xs font-normal opacity-50">on {chainName}</span>
    </span>
  );
}

/**
 * The token picker, same shape as the chip so the two cards line up. Tokens the
 * network cannot bridge stay listed but disabled, with the reason — hiding them
 * would make testnet look like it lacks the feature rather than the liquidity.
 */
function TokenSelect({
  tokens,
  value,
  onChange,
  chainName,
}: {
  tokens: readonly BridgeToken[];
  value: BridgeTokenSymbol;
  onChange: (symbol: BridgeTokenSymbol) => void;
  chainName: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as BridgeTokenSymbol);
      }}
    >
      <SelectTrigger
        aria-label="Token to deposit"
        className="!h-auto shrink-0 gap-1.5 rounded-full border-0 !bg-foreground/10 py-1 pl-1.5 pr-2 text-sm font-medium shadow-none hover:!bg-foreground/15"
      >
        <Icon name={TOKEN_ICONS[value]} className="size-4" />
        <SelectValue />
        <span className="text-xs font-normal opacity-50">on {chainName}</span>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-44">
        {tokens.map((token) => {
          const available = isBridgeTokenAvailable(token);
          return (
            <SelectItem key={token.symbol} value={token.symbol} disabled={!available}>
              <Icon name={TOKEN_ICONS[token.symbol]} className="size-4" />
              <span className="flex flex-col leading-tight">
                <span>{token.symbol}</span>
                {token.unavailableReason ? (
                  <span className="text-[10px] font-normal opacity-60">{token.unavailableReason}</span>
                ) : null}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-row items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatusView({
  route,
  bridge,
  onOpenPortal,
}: {
  route: FluentBridgeRoute;
  bridge: ReturnType<typeof useBridgeDeposit>;
  onOpenPortal: () => void;
}) {
  const { state, token, deliveredToken } = bridge;
  const step = state.phase === "settled" ? 3 : state.phase === "relaying" ? 2 : 1;
  const heading =
    state.phase === "settled"
      ? "Success"
      : state.phase === "relaying"
        ? "Funds on the way"
        : state.phase === "submitted"
          ? "Confirming on " + route.source.name
          : (state.stepLabel ??
            (state.phase === "approving"
              ? `Approve ${token.symbol} in your wallet`
              : "Confirm in your wallet"));
  const detail =
    state.phase === "settled"
      ? `Your ${deliveredToken.symbol} has landed on ${route.destination.name}.`
      : state.phase === "relaying"
        ? state.slow
          ? "Your deposit went through, but the funds are taking longer than usual to arrive. They will land as soon as the bridge relays them."
          : `Your funds are on their way to ${route.destination.name} — this usually takes a few minutes.`
        : state.phase === "submitted"
          ? "Waiting for the transaction to be included in a block."
          : state.phase === "swapping"
            ? `Converting on ${route.source.name} at 1:1 through the M^0 swap facility. The bridge deposit follows once it is mined.`
            : state.phase === "approving"
              ? "Allow the contract to move your tokens. The next signature does the actual transfer."
              : `Approve the deposit in your wallet to send it from ${route.source.name}.`;

  // While the deposit is on its way the departure is the transaction that
  // exists; once it has landed, the arrival on Fluent is the one that matters.
  const explorerLink =
    state.phase === "settled" && state.receivedHash
      ? {
          url: `${route.destination.blockExplorers?.default.url}/tx/${state.receivedHash}`,
          name: route.destination.blockExplorers?.default.name,
        }
      : state.hash
        ? {
            url: `${route.source.blockExplorers?.default.url}/tx/${state.hash}`,
            name: route.source.blockExplorers?.default.name,
          }
        : undefined;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col items-center gap-3 rounded-xl bg-foreground/5 px-4 py-8 text-center">
        <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((index) => (
            <span
              key={index}
              className={`h-1 w-8 rounded-full ${
                index <= step ? "bg-foreground/70" : "bg-foreground/15"
              }`}
            />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{heading}</span>
          <span className="text-xs opacity-50">{detail}</span>
        </div>
        {step < 3 ? <Spinner className="size-4 opacity-50" /> : null}
      </div>

      {explorerLink ? (
        <Button
          variant="secondary"
          className="w-full"
          href={explorerLink.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on {explorerLink.name}
          <ExternalLink className="size-4 opacity-70" />
        </Button>
      ) : null}
      {state.phase === "settled" && !state.receivedHash ? (
        <span className="text-center text-xs text-muted-foreground">
          Looking up the arrival on {route.destination.name}…
        </span>
      ) : null}

      {state.phase === "settled" ? (
        <Button className="w-full" onClick={bridge.reset}>
          Make another deposit
        </Button>
      ) : null}

      {state.phase === "relaying" && state.slow ? (
        <Button variant="ghost" className="w-full" onClick={onOpenPortal}>
          Check status on Fluent Portal
        </Button>
      ) : null}
    </div>
  );
}

export function BridgeForm({
  route,
  network,
  recipient,
  onOpenPortal,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  recipient?: Address;
  onOpenPortal: () => void;
}) {
  const tokens = getBridgeTokens(network);
  const [symbol, setSymbol] = useState<BridgeTokenSymbol>("ETH");
  const token = getBridgeToken(network, symbol);
  const bridge = useBridgeDeposit({ route, network, recipient, token });
  const { form, state } = bridge;

  if (state.phase !== "idle" && state.phase !== "error") {
    return <StatusView route={route} bridge={bridge} onOpenPortal={onOpenPortal} />;
  }

  const isErc20 = token.route !== "native";
  const isSwap = token.route === "swap";
  const { deliveredToken } = bridge;
  const ethSymbol = route.source.nativeCurrency.symbol;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <AmountCard
          label="You pay"
          footer={
            <div className="flex h-6 flex-row items-center justify-between text-xs text-muted-foreground">
              <span>
                {bridge.balanceLoading
                  ? "Loading balance…"
                  : bridge.connected
                    ? `You have ${formatAmount(bridge.sourceBalance, token.decimals)} ${token.symbol}`
                    : `On ${route.source.name}`}
              </span>
              {bridge.connected ? (
                <button
                  type="button"
                  className="font-medium text-foreground/70 transition-opacity hover:opacity-70"
                  onClick={form.setMax}
                >
                  MAX
                </button>
              ) : null}
            </div>
          }
        >
          <div className="flex h-10 flex-row items-center justify-between gap-2">
            <input
              aria-label={`Amount to deposit in ${token.symbol}`}
              className="min-w-0 shrink bg-transparent text-2xl font-medium outline-none placeholder:text-muted-foreground"
              placeholder="0.0"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={form.validationError ? true : undefined}
              value={form.amount}
              onChange={(event) => form.setAmount(event.target.value)}
            />
            <TokenSelect
              tokens={tokens}
              value={symbol}
              onChange={setSymbol}
              chainName={route.source.name}
            />
          </div>
        </AmountCard>

        <AmountCard label="You receive">
          <div className="flex h-10 flex-row items-center justify-between gap-2">
            <span className="min-w-0 truncate text-2xl font-medium">
              {bridge.receiveAmount === undefined
                ? "0.0"
                : `${isSwap ? "≈ " : ""}${formatAmount(bridge.receiveAmount, deliveredToken.decimals)}`}
            </span>
            <TokenChip token={deliveredToken} chainName={route.destination.name} />
          </div>
        </AmountCard>
      </div>

      <div className="flex flex-col gap-2">
        <SummaryRow
          label="Bridge fee"
          value={
            bridge.feeLoading ? (
              <Spinner className="size-3.5 opacity-50" />
            ) : bridge.fee === undefined ? (
              "—"
            ) : bridge.fee === 0n ? (
              <span className="text-green-400">Free</span>
            ) : (
              `${formatAmount(bridge.fee, 18)} ${ethSymbol}`
            )
          }
        />
        <SummaryRow label="Arrives as" value={`${deliveredToken.symbol} on ${route.destination.name}`} />
        <span className="text-xs text-muted-foreground">
          {isSwap
            ? `Fluent settles in ${deliveredToken.symbol}, so ${token.symbol} is first swapped to ${deliveredToken.symbol} on ${route.source.name} at 1:1, then bridged. Fee and gas are paid in ${ethSymbol}; expect up to four signatures — two approvals, the swap, the deposit.`
            : isErc20
              ? `The fee and gas are paid in ${ethSymbol}. Your first ${token.symbol} deposit also needs an approval — two signatures in total.`
              : `Deposits settle once ${route.source.name} confirms the transaction and the bridge relays it — usually a few minutes.`}
        </span>
      </div>

      {form.validationError ? (
        <span className="text-xs text-destructive">{form.validationError}</span>
      ) : null}
      {state.phase === "error" ? (
        <span className="text-xs text-destructive">{state.message}</span>
      ) : null}

      {bridge.restoring ? (
        <Button className="w-full" disabled>
          <Spinner className="size-4" />
          Reconnecting your wallet…
        </Button>
      ) : !bridge.connected ? (
        <Button className="w-full" onClick={bridge.connect}>
          Connect a wallet
        </Button>
      ) : bridge.wrongChain ? (
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            disabled={bridge.switchingChain}
            onClick={bridge.switchToSource}
          >
            {bridge.switchingChain ? (
              <>
                <Spinner className="size-4" />
                Switching to {route.source.name}…
              </>
            ) : (
              `Switch to ${route.source.name}`
            )}
          </Button>
          {bridge.switchError ? (
            <span className="text-center text-xs text-destructive">{bridge.switchError}</span>
          ) : null}
          <Button variant="ghost" className="w-full" onClick={bridge.disconnect}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button className="w-full" disabled={!form.canSubmit} onClick={bridge.submit}>
            {bridge.connecting ? (
              <>
                <Spinner className="size-4" />
                Confirm in your wallet…
              </>
            ) : bridge.feeLoading ? (
              <>
                <Spinner className="size-4" />
                Loading bridge fee…
              </>
            ) : bridge.needsApproval ? (
              `Approve ${token.symbol} and continue`
            ) : isSwap ? (
              `Swap to ${deliveredToken.symbol} and continue`
            ) : (
              "Continue"
            )}
          </Button>
          {/* Only reachable while idle — a deposit in flight renders the status
              view instead, so this cannot pull the wallet mid-signature. */}
          <Button variant="ghost" className="w-full" onClick={bridge.disconnect}>
            Disconnect
          </Button>
        </div>
      )}

      {bridge.connected ? (
        <span className="text-center text-xs text-muted-foreground">
          Deposits are signed by the wallet holding the {token.symbol}, not by your Fluent ID.
          They arrive at{" "}
          {recipient ? (
            <a
              href={`${route.destination.blockExplorers?.default.url}/address/${recipient}`}
              target="_blank"
              rel="noopener noreferrer"
              title={recipient}
              className="font-medium text-foreground/80 underline underline-offset-2 hover:opacity-80"
            >
              {formatAddress(recipient)}
            </a>
          ) : (
            "your Fluent account"
          )}
          .
        </span>
      ) : null}
    </div>
  );
}
