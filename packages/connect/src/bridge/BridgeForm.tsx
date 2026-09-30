import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { CircleHelp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { Address } from "viem";

import { Icon, type IconName } from "../components/Icon";
import { VISUAL_BY_DEFAULT_SYMBOL } from "../components/tokenVisuals";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { getFluentTokenDefaults, type FluentWidgetNetwork } from "../core/network";
import { useFluentTokenUsdPrices } from "../hooks/useFluentTokenUsdPrices";
import { formatAddress, formatFluentLocaleAmount } from "../utils";
import { CHAIN_BADGE } from "./ActivityTokenTile";
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

/** A fee in the source chain's coin. A zero is "0", not a word. */
function formatFee(wei: bigint | undefined, symbol: string, loading: boolean): string {
  if (loading) return "Estimating…";
  if (wei === undefined) return "—";
  return `${formatAmount(wei, 18)} ${symbol}`;
}

/** The Portal's tiers: cents from a dollar up, finer below it. */
function formatUsd(usd: number): string {
  return `$${formatFluentLocaleAmount(usd, usd >= 1 ? 2 : usd >= 0.01 ? 3 : 4)}`;
}

/** A fee in USD; nothing for zero or unpriced, so the row never says "$0". */
function formatFeeUsd(wei: bigint | undefined, usdPrice: number | undefined): string | undefined {
  if (wei === undefined || wei === 0n || usdPrice === undefined) return undefined;
  const usd = Number(formatUnits(wei, 18)) * usdPrice;
  return Number.isFinite(usd) && usd > 0 ? formatUsd(usd) : undefined;
}

/** The typed amount in USD — "$0" while empty, as under the Portal's figure. */
function formatAmountUsd(amount: string, usdPrice: number | undefined): string | undefined {
  if (usdPrice === undefined) return undefined;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? formatUsd(value * usdPrice) : "$0";
}

const AMOUNT_MAX_PX = 24;
const AMOUNT_MIN_PX = 14;
/** Digits in the widget's sans run about 0.6em; the separator is narrower, which keeps this conservative. */
const AMOUNT_CHAR_WIDTH_EM = 0.6;

/**
 * Shrinks a figure so a long value stays on one line, sized against its
 * wrapper (`container-type: inline-size`) rather than fixed breakpoints, as the
 * Portal's amount cards do — so both cards' figures shrink in step.
 */
function getAmountFontStyle(value: string): React.CSSProperties {
  const width = (Math.max(value.length, 1) * AMOUNT_CHAR_WIDTH_EM).toFixed(2);
  return { fontSize: `clamp(${AMOUNT_MIN_PX}px, calc(100cqi / ${width}), ${AMOUNT_MAX_PX}px)` };
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
    <div className="flex w-full flex-col gap-2.5 rounded-2xl bg-foreground/5 p-5">
      <span className="text-sm text-foreground/60">{label}</span>
      {children}
      {footer}
    </div>
  );
}

/**
 * The token's glyph on its tile, with the chain it sits on badged in the corner
 * — the Portal's pill icon, drawn with the token list's tiles and Activity's
 * chain badges. The badge ring is solid: it sits on the glyph, so alpha would
 * let it show through instead of separating the two.
 */
function TokenChainIcon({ symbol, chain }: { symbol: BridgeTokenSymbol; chain: "source" | "destination" }) {
  const visual = VISUAL_BY_DEFAULT_SYMBOL[symbol];
  const badge = chain === "source" ? CHAIN_BADGE.l1_to_l2 : CHAIN_BADGE.l2_to_l1;
  return (
    <span className="relative inline-flex shrink-0">
      <span className={`flex size-7 items-center justify-center rounded-full ${visual?.bgClassName ?? "bg-foreground/10"}`}>
        <Icon
          name={TOKEN_ICONS[symbol]}
          className={visual?.iconClassName.includes("text-white") ? "size-4 text-white" : "size-4"}
        />
      </span>
      <span
        className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-neutral-900 ${badge.bgClassName}`}
      >
        <Icon name={badge.icon} className={`size-2 ${badge.iconClassName}`} />
      </span>
    </span>
  );
}

/** The arriving token, static — the choice is made on the send side. */
function TokenChip({ token }: { token: BridgeToken }) {
  return (
    <span className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.06] pl-2 pr-3.5 text-foreground">
      <TokenChainIcon symbol={token.symbol} chain="destination" />
      <span className="text-sm font-medium leading-none whitespace-nowrap">{token.symbol}</span>
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
}: {
  tokens: readonly BridgeToken[];
  value: BridgeTokenSymbol;
  onChange: (symbol: BridgeTokenSymbol) => void;
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
        className="!h-11 shrink-0 gap-2 rounded-full border-0 !bg-foreground/[0.06] py-0 pl-2 pr-3.5 text-sm font-medium shadow-none hover:!bg-foreground/10 [&>svg:last-child]:size-4 [&>svg:last-child]:text-foreground/70"
      >
        <TokenChainIcon symbol={value} chain="source" />
        <SelectValue />
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

/**
 * One line of the fee summary, laid out as the Portal's: the label, with a
 * help tip when the fee wants explaining; the figure; and a dot-separated
 * secondary such as its value in USD.
 */
function SummaryRow({
  label,
  value,
  secondary,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  secondary?: string;
  tooltip?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-5 text-sm">
      <span className="inline-flex items-center gap-1 text-foreground/80">
        {label}
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              tabIndex={0}
              aria-label={`About the ${label.toLowerCase()}`}
              render={<span className="inline-flex cursor-default rounded-sm" />}
            >
              <CircleHelp className="size-4 text-foreground/45" />
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span className="flex items-center gap-2 text-right">
        <span className="text-foreground">{value}</span>
        {secondary ? <span className="size-0.5 rounded-full bg-foreground/50" /> : null}
        {secondary ? <span className="text-foreground/60">{secondary}</span> : null}
      </span>
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
  // The fee coin and the token being sent, priced the way the token list
  // prices balances. Only tokens Fluent ships have a price; a symbol the
  // defaults lack simply gets no USD line.
  const priceTokens = useMemo(() => {
    const defaults = getFluentTokenDefaults(network) as Record<string, FluentTokenDefinition | undefined>;
    return [...new Set([defaults.ETH, defaults[token.symbol]])].filter(
      (definition): definition is FluentTokenDefinition => Boolean(definition),
    );
  }, [network, token.symbol]);
  const { prices } = useFluentTokenUsdPrices(priceTokens);
  const priceOf = (symbol: string) => {
    const definition = priceTokens.find((candidate) => candidate.symbol === symbol);
    return definition ? prices[fluentTokenIdentity(definition)] : undefined;
  };
  const ethUsdPrice = priceOf("ETH");
  const amountUsd = formatAmountUsd(form.amount, priceOf(token.symbol));
  const receiveText =
    bridge.receiveAmount === undefined || bridge.receiveAmount === 0n
      ? "0"
      : `${isSwap ? "≈ " : ""}${formatAmount(bridge.receiveAmount, deliveredToken.decimals)}`;
  const isFastPath = deliveredToken.route === "fast-path";
  // As the Portal sums it: whatever is known so far, unknown only when nothing is.
  const totalFee =
    bridge.fee === undefined && bridge.gasFee === undefined
      ? undefined
      : (bridge.fee ?? 0n) + (bridge.gasFee ?? 0n);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <AmountCard label="Send">
          <div className="flex items-center gap-5">
            <div className="flex min-w-0 flex-1 flex-col [container-type:inline-size]">
              <input
                aria-label={`Amount to deposit in ${token.symbol}`}
                className="w-full min-w-0 border-none bg-transparent p-0 font-medium leading-[1.2] text-foreground outline-none placeholder:text-foreground/40"
                style={getAmountFontStyle(form.amount || "0")}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={form.validationError ? true : undefined}
                value={form.amount}
                onChange={(event) => form.setAmount(event.target.value)}
              />
            </div>
            <TokenSelect tokens={tokens} value={symbol} onChange={setSymbol} />
          </div>

          {/* The Portal shows this row only once there is a wallet to have a balance. */}
          {bridge.connected || bridge.restoring ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1 text-sm text-foreground/60">
                <span>{amountUsd}</span>
                <div className="flex items-center gap-1">
                  <span
                    title={
                      bridge.sourceBalance !== undefined
                        ? formatUnits(bridge.sourceBalance, token.decimals)
                        : undefined
                    }
                  >
                    {bridge.balanceLoading
                      ? "Loading balance..."
                      : `${formatAmount(bridge.sourceBalance, token.decimals)} ${token.symbol}`}
                  </span>
                  <button
                    type="button"
                    className="font-medium text-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!bridge.connected || bridge.balanceLoading}
                    onClick={form.setMax}
                  >
                    Max
                  </button>
                </div>
              </div>
              {form.validationError ? (
                <span className="text-xs text-destructive">{form.validationError}</span>
              ) : null}
            </div>
          ) : null}
        </AmountCard>

        <AmountCard label="Receive">
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0 flex-1 [container-type:inline-size]">
              <span
                className={`block truncate font-medium leading-[1.2] ${receiveText === "0" ? "text-foreground/40" : "text-foreground"}`}
                style={getAmountFontStyle(receiveText)}
              >
                {receiveText}
              </span>
            </div>
            <TokenChip token={deliveredToken} />
          </div>
        </AmountCard>
      </div>

      {/* The Portal's summary: what the chain charges, what the bridge charges,
          and the two together. What arrives is already on the card above. */}
      <TooltipProvider delay={200}>
      <div className="flex flex-col gap-3.5 py-2">
        <SummaryRow
          label={`Est. ${route.source.name.split(" ")[0]} gas fee`}
          value={formatFee(bridge.gasFee, ethSymbol, bridge.gasFeeLoading)}
          secondary={formatFeeUsd(bridge.gasFee, ethUsdPrice)}
        />
        <SummaryRow
          label={isFastPath ? "Settlement fee" : "Relayer gas fee"}
          value={formatFee(bridge.fee, ethSymbol, bridge.feeLoading)}
          secondary={formatFeeUsd(bridge.fee, ethUsdPrice)}
          tooltip={
            isFastPath
              ? "The settlement fee covers the fast path message delivery and liquidity route."
              : "The relayer gas fee is used to cover the cost of sending the message to the destination chain."
          }
        />
        <SummaryRow
          label="Total fees"
          value={formatFee(totalFee, ethSymbol, bridge.feeLoading || bridge.gasFeeLoading)}
          secondary={formatFeeUsd(totalFee, ethUsdPrice)}
        />
        <span className="text-xs text-foreground/60">
          {isSwap
            ? `Fluent settles in ${deliveredToken.symbol}, so ${token.symbol} is first swapped to ${deliveredToken.symbol} on ${route.source.name} at 1:1, then bridged. Fee and gas are paid in ${ethSymbol}; expect up to four signatures — two approvals, the swap, the deposit.`
            : isErc20
              ? `The fee and gas are paid in ${ethSymbol}. Your first ${token.symbol} deposit also needs an approval — two signatures in total.`
              : `Deposits settle once ${route.source.name} confirms the transaction and the bridge relays it — usually a few minutes.`}
        </span>
      </div>
      </TooltipProvider>

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
