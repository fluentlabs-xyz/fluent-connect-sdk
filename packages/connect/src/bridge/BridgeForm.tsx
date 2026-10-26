import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { Check, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { Address } from "viem";

import {
  AMOUNT_INPUT_CLASS,
  AmountCard,
  formatAmount,
  formatAmountUsd,
  formatUsd,
  getAmountFontStyle,
  SummaryRow,
} from "../components/AmountForm";
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
import { TooltipProvider } from "../components/ui/tooltip";
import { getFluentTokenDefaults, type FluentWidgetNetwork } from "../core/network";
import { useFluentTokenUsdPrices } from "../hooks/useFluentTokenUsdPrices";
import { FLUENT_SWAP_SLIPPAGE_BPS } from "../swap/contracts";
import { applyFluentSwapSlippage } from "../swap/slippage";
import {
  findFluentSwapToken,
  getFluentSwapInputAmount,
  getFluentSwapTokens,
  type FluentSwapToken,
} from "../swap/tokens";
import { useFluentSwapQuote } from "../swap/useFluentSwapQuote";
import { explorerTransaction, formatAddress } from "../utils";
import type {
  FluentDepositSwap,
  FluentDepositSwapState,
} from "../widget/hooks/useFluentDepositSwap";
import { CHAIN_BADGE } from "./ActivityTokenTile";
import { DepositSteps, type DepositStep } from "./DepositSteps";
import type { FluentBridgeRoute } from "./route";
import {
  getBridgeToken,
  getBridgeTokens,
  isBridgeTokenAvailable,
  type BridgeToken,
  type BridgeTokenSymbol,
} from "./tokens";
import { useBridgeDeposit } from "./useBridgeDeposit";

/** A fee in the source chain's coin. A zero is "0", not a word. */
function formatFee(wei: bigint | undefined, symbol: string, loading: boolean): string {
  if (loading) return "Estimating…";
  if (wei === undefined) return "—";
  return `${formatAmount(wei, 18)} ${symbol}`;
}

/** A fee in USD; nothing for zero or unpriced, so the row never says "$0". */
function formatFeeUsd(wei: bigint | undefined, usdPrice: number | undefined): string | undefined {
  if (wei === undefined || wei === 0n || usdPrice === undefined) return undefined;
  const usd = Number(formatUnits(wei, 18)) * usdPrice;
  return Number.isFinite(usd) && usd > 0 ? formatUsd(usd) : undefined;
}

/** Slippage as the summary says it: basis points read back as a percentage. */
const SLIPPAGE_LABEL = `${Number(FLUENT_SWAP_SLIPPAGE_BPS) / 100}%`;

const SLIPPAGE_TOOLTIP =
  `The swap may settle up to ${SLIPPAGE_LABEL} below its quote. Below that the pool ` +
  "rejects it, and nothing is swapped.";

/**
 * Keyed by string rather than by `BridgeTokenSymbol`: the Receive side also
 * names tokens that only exist on Fluent, which the bridge's own union does not
 * cover. A symbol with no glyph still gets its tile, so the row keeps its shape.
 */
const TOKEN_ICONS: Record<string, IconName | undefined> = {
  ETH: "eth",
  BLEND: "blend",
  USDnr: "usdnr",
  USDC: "usdc",
};

/**
 * The token's glyph on its tile, with the chain it sits on badged in the corner
 * — the Portal's pill icon, drawn with the token list's tiles and Activity's
 * chain badges. The badge ring is solid: it sits on the glyph, so alpha would
 * let it show through instead of separating the two.
 */
function TokenChainIcon({ symbol, chain }: { symbol: string; chain: "source" | "destination" }) {
  const visual = VISUAL_BY_DEFAULT_SYMBOL[symbol];
  const badge = chain === "source" ? CHAIN_BADGE.l1_to_l2 : CHAIN_BADGE.l2_to_l1;
  const icon = TOKEN_ICONS[symbol] ?? visual?.icon;
  const onBrandTile = visual?.iconClassName.includes("text-white");
  return (
    <span className="relative inline-flex shrink-0">
      <span className={`flex size-7 items-center justify-center rounded-full ${visual?.bgClassName ?? "bg-foreground/10"}`}>
        {icon ? <Icon name={icon} className={onBrandTile ? "size-4 text-white" : "size-4"} /> : null}
      </span>
      <span
        className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-neutral-900 ${badge.bgClassName}`}
      >
        <Icon name={badge.icon} className={`size-2 ${badge.iconClassName}`} />
      </span>
    </span>
  );
}

/** The arriving token, static — shown where there is nothing to choose between. */
function TokenChip({ symbol }: { symbol: string }) {
  return (
    <span className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.06] pl-2 pr-3.5 text-foreground">
      <TokenChainIcon symbol={symbol} chain="destination" />
      <span className="text-sm font-medium leading-none whitespace-nowrap">{symbol}</span>
    </span>
  );
}

/** The trigger both pickers use, so the Send and Receive cards line up. */
const TOKEN_SELECT_TRIGGER_CLASS =
  "!h-11 shrink-0 gap-2 rounded-full border-0 !bg-foreground/[0.06] py-0 pl-2 pr-3.5 text-sm font-medium shadow-none hover:!bg-foreground/10 [&>svg:last-child]:size-4 [&>svg:last-child]:text-foreground/70";

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
      <SelectTrigger aria-label="Token to deposit" className={TOKEN_SELECT_TRIGGER_CLASS}>
        <TokenChainIcon symbol={value} chain="source" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-44">
        {tokens.map((token) => {
          const available = isBridgeTokenAvailable(token);
          return (
            <SelectItem key={token.symbol} value={token.symbol} disabled={!available}>
              <Icon name={TOKEN_ICONS[token.symbol] ?? "eth"} className="size-4" />
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
 * What to end up with on Fluent. The token the bridge delivers is one of the
 * options and the default; picking any other one makes the deposit a Two-step
 * deposit, which is what the caption on each row says.
 */
function ReceiveTokenSelect({
  delivered,
  targets,
  value,
  onChange,
}: {
  delivered: string;
  targets: readonly FluentSwapToken[];
  value: string;
  onChange: (symbol: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label="Token to receive on Fluent"
        className={TOKEN_SELECT_TRIGGER_CLASS}
      >
        <TokenChainIcon symbol={value} chain="destination" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-52">
        <SelectItem value={delivered}>
          <Icon name={TOKEN_ICONS[delivered] ?? "eth"} className="size-4" />
          <span className="flex flex-col leading-tight">
            <span>{delivered}</span>
            <span className="text-[10px] font-normal opacity-60">Bridged as it is</span>
          </span>
        </SelectItem>
        {targets.map((token) => (
          <SelectItem key={token.symbol} value={token.symbol}>
            <Icon name={TOKEN_ICONS[token.symbol] ?? "eth"} className="size-4" />
            <span className="flex flex-col leading-tight">
              <span>{token.symbol}</span>
              <span className="text-[10px] font-normal opacity-60">
                Swapped on Fluent after the bridge
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The Portal's two-segment stepper for tokens that need an allowance before
 * the bridge. The step in progress takes the Portal's pink and pulses while a
 * transaction is out; a finished step settles to the foreground. Shown for any
 * such token as soon as it is picked, so the flow is announced before an
 * amount is typed.
 */
export function ApprovalSteps({
  currentStep,
  actionLabel,
  busy,
}: {
  currentStep: 1 | 2;
  actionLabel: string;
  busy: boolean;
}) {
  const steps = [
    { step: 1 as const, label: "Approve" },
    { step: 2 as const, label: actionLabel },
  ];
  return (
    <div
      role="group"
      aria-label={`Step ${currentStep} of 2`}
      className="grid grid-cols-2 gap-1.5 border-t border-foreground/10 py-4"
    >
      {steps.map(({ step, label }) => {
        const done = step < currentStep;
        const active = step === currentStep;
        return (
          <div key={step} className="flex flex-col gap-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  done ? "w-full bg-foreground" : active ? "w-full bg-[#ff8fda]" : "w-0"
                } ${active && busy ? "animate-pulse" : ""}`}
              />
            </div>
            <div
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 text-xs ${
                active ? "text-foreground" : done ? "text-foreground/60" : "text-foreground/40"
              }`}
            >
              {done ? (
                <Check aria-hidden className="size-3 shrink-0" strokeWidth={3} />
              ) : (
                <span className="tabular-nums">{step}.</span>
              )}
              <span className="truncate">{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The two steps of a deposit that ends in a Fluent swap, with the bridge leg's
 * own progress folded into step 1 — the leg is either running, done, or not
 * started, and its three phases are told in the heading beside this.
 */
function depositStepsFor({
  bridged,
  swapTarget,
  bridgeDone,
  swapStatus,
}: {
  bridged: string;
  swapTarget: string;
  bridgeDone: boolean;
  swapStatus: DepositStep["status"];
}): readonly [DepositStep, DepositStep] {
  return [
    {
      title: "Bridge to Fluent",
      // Names the delivered token rather than the one sent: on the USDC route
      // they differ, and what step 2 sells is what landed.
      caption: `${bridged} lands on your Fluent account.`,
      status: bridgeDone ? "done" : "active",
    },
    {
      title: `Swap to ${swapTarget}`,
      caption: `Your Fluent account swaps the ${bridged} it received for ${swapTarget}.`,
      status: swapStatus,
    },
  ];
}

function StatusView({
  route,
  bridge,
  onOpenPortal,
  swap,
}: {
  route: FluentBridgeRoute;
  bridge: ReturnType<typeof useBridgeDeposit>;
  onOpenPortal: () => void;
  /** Present only for a Two-step deposit: the swap leg still to come. */
  swap?: {
    target: string;
    /** Why the swap cannot be started yet, if it cannot. */
    blocked?: string;
    onSwap: () => void;
    /** Drops the swap leg and keeps what the bridge delivered. */
    onSkip: () => void;
  };
}) {
  const { state, token, deliveredToken } = bridge;
  const step = state.phase === "settled" ? 3 : state.phase === "relaying" ? 2 : 1;
  const settled = state.phase === "settled";
  const heading =
    settled
      ? swap
        ? `${deliveredToken.symbol} landed on Fluent`
        : "Success"
      : state.phase === "relaying"
        ? "Funds on the way"
        : state.phase === "submitted"
          ? "Confirming on " + route.source.name
          : (state.stepLabel ??
            (state.phase === "approving"
              ? `Approve ${token.symbol} in your wallet`
              : "Confirm in your wallet"));
  const detail =
    settled
      ? swap
        ? `Your ${deliveredToken.symbol} is on Fluent. Swapping it to ${swap.target} is next.`
        : `Your ${deliveredToken.symbol} has landed on ${route.destination.name}.`
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
    <div className="flex w-full flex-col gap-4 flex-1 items-center justify-center">
      {swap ? (
        <DepositSteps
          headline={settled ? "Bridge done — the swap is next" : "Bridging to Fluent"}
          description={
            settled
              ? `What landed is ${deliveredToken.symbol}; the swap turns it into ${swap.target}.`
              : `The swap to ${swap.target} runs once the deposit has landed.`
          }
          steps={depositStepsFor({
            bridged: deliveredToken.symbol,
            swapTarget: swap.target,
            bridgeDone: settled,
            swapStatus: settled ? "active" : "waiting",
          })}
          busy={!settled}
        />
      ) : null}
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        {swap ? null : (
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
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{heading}</span>
          <span className="text-sm opacity-50">{detail}</span>
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
      </div>
      {state.phase === "settled" && !state.receivedHash ? (
        <span className="text-center text-xs text-muted-foreground">
          Looking up the arrival on {route.destination.name}…
        </span>
      ) : null}

      {settled && swap ? (
        <div className="flex w-full flex-col gap-2">
          <Button className="w-full" disabled={Boolean(swap.blocked)} onClick={swap.onSwap}>
            {swap.blocked ?? `Swap to ${swap.target}`}
          </Button>
          <Button variant="ghost" className="w-full" onClick={swap.onSkip}>
            Keep {deliveredToken.symbol} instead
          </Button>
        </div>
      ) : settled ? (
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

/** A swap leg the bridge has already fed: every phase but `idle`. */
type DepositSwapInFlight = Exclude<FluentDepositSwapState, { phase: "idle" }>;

/** What the swap leg's screen says under its heading. */
function depositSwapDetail(state: DepositSwapInFlight): string {
  const { leg } = state;
  if (state.phase === "settled") {
    return `${formatAmount(leg.to.amount, leg.to.decimals)} ${leg.to.symbol} is on Fluent.`;
  }
  // Neither of the two ways the swap can stop puts the deposit at risk, and the
  // copy must not suggest it does: the deposit landed, and only the swap after
  // it did not happen.
  if (state.phase === "error") {
    return `Your ${leg.from.symbol} is on Fluent — only the swap failed. ${state.message}`;
  }
  if (state.phase === "declined") {
    return `Your ${leg.from.symbol} is on Fluent, unswapped. Confirm to trade it.`;
  }
  return "Your Fluent account is swapping; the new balance appears once it is mined.";
}

function depositSwapHeading(state: DepositSwapInFlight): string {
  switch (state.phase) {
    case "settled":
      return "Success";
    case "error":
      return "The swap did not go through";
    case "declined":
      return "The swap is still waiting";
    default:
      return `Swapping ${state.leg.from.symbol} to ${state.leg.to.symbol}`;
  }
}

/**
 * The swap leg once it has been sent: the bridge is behind us, so the bridge's
 * own state is not read here — the leg carries what it needs.
 */
function DepositSwapStatusView({
  network,
  depositSwap,
  retry,
  blocked,
}: {
  network: FluentWidgetNetwork;
  depositSwap: FluentDepositSwap;
  /** Re-runs the swap at today's price; absent while no fresh quote is in hand. */
  retry?: () => void;
  /** What the confirm button says while there is no price to confirm. */
  blocked: string;
}) {
  const { state } = depositSwap;
  if (state.phase === "idle") return null;
  const { leg } = state;
  const done = state.phase === "settled";
  const heading = depositSwapHeading(state);
  const detail = depositSwapDetail(state);

  return (
    <div className="flex w-full flex-col gap-4 flex-1 items-center justify-center">
      <DepositSteps
        headline={done ? "Deposit complete" : "Bridge done — the swap is left"}
        description={
          done
            ? `You deposited ${leg.from.symbol} and ended up with ${leg.to.symbol} on Fluent.`
            : `The ${leg.from.symbol} the bridge delivered becomes ${leg.to.symbol}.`
        }
        steps={depositStepsFor({
          bridged: leg.from.symbol,
          swapTarget: leg.to.symbol,
          bridgeDone: true,
          swapStatus: done ? "done" : state.phase === "error" ? "failed" : "active",
        })}
        busy={state.phase === "swapping"}
      />

      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{heading}</span>
          <span className="text-sm opacity-50">{detail}</span>
        </div>
        {state.phase === "settled" ? (
          <Button
            variant="secondary"
            className="w-full"
            href={explorerTransaction(state.hash, network)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on FluentScan
            <ExternalLink className="size-4 opacity-70" />
          </Button>
        ) : null}
      </div>

      {state.phase === "swapping" ? (
        <Button className="w-full" disabled>
          <Spinner className="size-4" />
          Swapping…
        </Button>
      ) : (
        <div className="flex w-full flex-col gap-2">
          {/* Offered while the swap is still worth doing, which is both ways it
              can stop. Without a price there is nothing to confirm, so the
              button says what it is waiting for rather than disappearing. */}
          {done ? null : retry ? (
            <Button className="w-full" onClick={retry}>
              {state.phase === "error" ? "Try the swap again" : `Swap to ${leg.to.symbol}`}
            </Button>
          ) : (
            <Button className="w-full" disabled>
              {blocked}
            </Button>
          )}
          <Button
            variant={done ? "default" : "ghost"}
            className="w-full"
            onClick={depositSwap.reset}
          >
            {done ? "Make another deposit" : `Keep the ${leg.from.symbol} instead`}
          </Button>
        </div>
      )}
    </div>
  );
}

export function BridgeForm({
  route,
  network,
  recipient,
  onSignIn,
  onOpenPortal,
  depositSwap,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  recipient?: Address;
  /** Starts a Fluent sign-in; without it the missing-account state is a notice only. */
  onSignIn?: () => void;
  onOpenPortal: () => void;
  /**
   * The swap leg of a Two-step deposit. Without it the Receive side is whatever
   * the bridge delivers, which is every surface that mounts this form bare.
   */
  depositSwap?: FluentDepositSwap;
}) {
  const tokens = getBridgeTokens(network);
  const [symbol, setSymbol] = useState<BridgeTokenSymbol>("ETH");
  const token = getBridgeToken(network, symbol);
  const bridge = useBridgeDeposit({ route, network, recipient, token });
  const { form, state, deliveredToken } = bridge;
  // What to end up with on Fluent. Undefined is "whatever the bridge delivers",
  // so a Send token change cannot leave a stale swap target behind.
  const [receiveSymbol, setReceiveSymbol] = useState<string | undefined>(undefined);
  // The fee coin and the token being sent, priced the way the token list
  // prices balances. Only tokens Fluent ships have a price; a symbol the
  // defaults lack simply gets no USD line. Hooks stay above the status
  // early-return below, or a deposit leaving idle changes the hook count.
  const priceTokens = useMemo(() => {
    const defaults = getFluentTokenDefaults(network) as Record<string, FluentTokenDefinition | undefined>;
    return [...new Set([defaults.ETH, defaults[token.symbol]])].filter(
      (definition): definition is FluentTokenDefinition => Boolean(definition),
    );
  }, [network, token.symbol]);
  const { prices } = useFluentTokenUsdPrices(priceTokens);

  // Which tokens the swap leg could buy instead of what the bridge delivers.
  // Empty where no Fluent ID can execute the leg, which also means the Receive
  // side stays the plain chip it has always been.
  const swapTargets = useMemo(
    () =>
      depositSwap?.available
        ? getFluentSwapTokens(network).filter(
            (candidate) => candidate.symbol !== deliveredToken.symbol,
          )
        : [],
    [depositSwap?.available, deliveredToken.symbol, network],
  );
  const swapTarget = swapTargets.find((candidate) => candidate.symbol === receiveSymbol);
  const swapSource = findFluentSwapToken(network, deliveredToken.symbol);
  const swapInput = getFluentSwapInputAmount(bridge.receiveAmount, swapSource);
  // A leg already sent names its own pair: the form is remounted after the
  // review page took its place, so the selection above is gone by then.
  const sentLeg =
    depositSwap && depositSwap.state.phase !== "idle" ? depositSwap.state.leg : undefined;
  const swapQuote = useFluentSwapQuote({
    network,
    tokenIn: sentLeg ? findFluentSwapToken(network, sentLeg.from.symbol) : swapSource,
    tokenOut: sentLeg ? findFluentSwapToken(network, sentLeg.to.symbol) : swapTarget,
    amountIn: sentLeg ? sentLeg.from.amount : swapInput,
    // A price is worth reading while one can still be acted on. An operation
    // already out cannot take a new price, and a settled one needs none; a
    // failed one does, because trying again prices the swap afresh.
    enabled: depositSwap?.state.phase !== "settled" && depositSwap?.state.phase !== "swapping",
  });

  // The swap leg, once sent, is the whole story: the bridge behind it has
  // settled, and this form is on screen again only because the review page gave
  // it back.
  const quote = swapQuote.quote;
  const pricingLabel = swapQuote.loading ? "Pricing the swap…" : "The swap cannot be priced";

  if (depositSwap && depositSwap.state.phase !== "idle") {
    return (
      <DepositSwapStatusView
        network={network}
        depositSwap={depositSwap}
        retry={quote ? () => void depositSwap.run(quote) : undefined}
        blocked={pricingLabel}
      />
    );
  }

  const twoStep = Boolean(depositSwap && swapTarget && swapSource);
  // Why the swap leg cannot run, in the words the Receive card shows. Loading is
  // not one of them: a price on its way is not a problem to report.
  const swapProblem = !twoStep
    ? undefined
    : swapInput === 0n
      ? "Too small to swap: the gas reserve kept back on Fluent would take all of it."
      : swapQuote.noRoute
        ? `There is no ${deliveredToken.symbol} to ${swapTarget?.symbol} pool on Fluent.`
        : swapQuote.error;
  // Nothing is signed until the leg it pays for has a price.
  const swapUnpriced = twoStep && !quote;
  const swapBlocked = swapUnpriced ? pricingLabel : undefined;

  if (state.phase !== "idle" && state.phase !== "error") {
    return (
      <StatusView
        route={route}
        bridge={bridge}
        onOpenPortal={onOpenPortal}
        swap={
          twoStep && swapTarget && depositSwap
            ? {
                target: swapTarget.symbol,
                blocked: swapBlocked,
                onSwap: () => {
                  if (quote) void depositSwap.run(quote);
                },
                // Keeping what landed drops the ask as well, or the next
                // deposit would silently inherit this one's swap target.
                onSkip: () => {
                  setReceiveSymbol(undefined);
                  bridge.reset();
                },
              }
            : undefined
        }
      />
    );
  }

  const isErc20 = token.route !== "native";
  const isSwap = token.route === "swap";
  const ethSymbol = route.source.nativeCurrency.symbol;
  const priceOf = (symbol: string) => {
    const definition = priceTokens.find((candidate) => candidate.symbol === symbol);
    return definition ? prices[fluentTokenIdentity(definition)] : undefined;
  };
  const ethUsdPrice = priceOf("ETH");
  const amountUsd = formatAmountUsd(form.amount, priceOf(token.symbol));
  const receiveToken = twoStep && swapTarget ? swapTarget : deliveredToken;
  const receiveAmount = twoStep ? quote?.amountOut : bridge.receiveAmount;
  // A figure a pool decides is an estimate until it is mined, and so is a 1:1
  // conversion the facility has not run yet.
  const approximate = isSwap || twoStep ? "≈ " : "";
  const receiveText =
    receiveAmount === undefined || receiveAmount === 0n
      ? twoStep && swapQuote.loading
        ? "…"
        : "0"
      : `${approximate}${formatAmount(receiveAmount, receiveToken.decimals)}`;
  const isFastPath = deliveredToken.route === "fast-path";
  // Any ERC-20 is a two-step flow — allowance, then the bridge — so the stepper
  // shows as soon as one is picked. The swap route has its own sequence and,
  // as in the Portal, keeps the single button. Step 1 stays current until an
  // amount exists and the allowance is known to cover it.
  const showApprovalSteps = bridge.connected && !bridge.wrongChain && isErc20 && !isSwap;
  const approvalStep: 1 | 2 =
    Number(form.amount) > 0 && !bridge.needsApproval && !bridge.approving ? 2 : 1;
  const canApprove =
    !bridge.approving && Number(form.amount) > 0 && !form.validationError && !bridge.feeLoading;
  // As the Portal sums it: whatever is known so far, unknown only when nothing is.
  const totalFee =
    bridge.fee === undefined && bridge.gasFee === undefined
      ? undefined
      : (bridge.fee ?? 0n) + (bridge.gasFee ?? 0n);
  const minimumOut =
    twoStep && quote
      ? applyFluentSwapSlippage(quote.amountOut, FLUENT_SWAP_SLIPPAGE_BPS)
      : undefined;

  return (
    <div className="flex w-full flex-col gap-4 flex-1">
      <div className="flex flex-col gap-2">
        <AmountCard label="Send">
          <div className="flex items-center gap-5">
            <div className="flex min-w-0 flex-1 flex-col [container-type:inline-size]">
              <input
                aria-label={`Amount to deposit in ${token.symbol}`}
                className={AMOUNT_INPUT_CLASS}
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
            {swapTargets.length > 0 ? (
              <ReceiveTokenSelect
                delivered={deliveredToken.symbol}
                targets={swapTargets}
                value={receiveToken.symbol}
                onChange={(next) =>
                  setReceiveSymbol(next === deliveredToken.symbol ? undefined : next)
                }
              />
            ) : (
              <TokenChip symbol={deliveredToken.symbol} />
            )}
          </div>
          {swapProblem ? <span className="text-xs text-destructive">{swapProblem}</span> : null}
        </AmountCard>
      </div>

      {twoStep && swapTarget ? (
        <DepositSteps
          headline={`Deposit ${token.symbol}, receive ${swapTarget.symbol}`}
          description="The bridge runs first; the swap is a second confirmation once it lands."
          steps={depositStepsFor({
            bridged: deliveredToken.symbol,
            swapTarget: swapTarget.symbol,
            bridgeDone: false,
            swapStatus: "waiting",
          })}
        />
      ) : null}

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
        {/* Where the deposit lands: always the Fluent account, never the
            signing wallet, which is why it is spelled out. */}
        <SummaryRow
          label="Deposit to"
          value={
            recipient ? (
              <a
                href={`${route.destination.blockExplorers?.default.url}/address/${recipient}`}
                target="_blank"
                rel="noopener noreferrer"
                title={recipient}
                // `!` against a host's own `a` rule, as on `ConsentLink`.
                className="text-inherit! underline! underline-offset-2 hover:opacity-80"
              >
                {formatAddress(recipient)}
              </a>
            ) : (
              <span className="text-foreground/60">Not signed in</span>
            )
          }
          secondary={recipient ? "Fluent account" : undefined}
          tooltip="Deposits are credited to your Fluent account, not to the wallet that signs them."
        />
        {/* The swap leg's own terms. Only the amount can move — the pool price
            is read again while the form is open — so the floor is what to show. */}
        {twoStep && swapTarget ? (
          <>
            <SummaryRow
              label="Min. received after swap"
              value={
                minimumOut === undefined
                  ? swapQuote.loading
                    ? "Pricing…"
                    : "—"
                  : `${formatAmount(minimumOut, swapTarget.decimals)} ${swapTarget.symbol}`
              }
              tooltip={SLIPPAGE_TOOLTIP}
            />
            <SummaryRow label="Max. slippage" value={SLIPPAGE_LABEL} />
          </>
        ) : null}
        {/* Only the swap route gets a note: the stepper already announces an ERC-20's two signatures. */}
        {isSwap ? (
          <span className="text-xs text-foreground/60">
            {`Fluent settles in ${deliveredToken.symbol}, so ${token.symbol} is first swapped to ${deliveredToken.symbol} on ${route.source.name} at 1:1, then bridged. Fee and gas are paid in ${ethSymbol}; expect up to four signatures — two approvals, the swap, the deposit.`}
          </span>
        ) : null}
        {twoStep && swapTarget ? (
          <span className="text-xs text-foreground/60">
            {`The swap runs on Fluent after the deposit lands: your Fluent account trades ` +
              `the ${deliveredToken.symbol} it received for ${swapTarget.symbol}, and pays ` +
              `that gas in the Gas token from your settings.`}
          </span>
        ) : null}
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
      ) : !recipient ? (
        // Nothing to credit yet. A disabled Deposit button says nothing; this
        // says what is missing and offers the way to get it.
        <div className="flex flex-col gap-2">
          <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-6 text-center">
            <span className="text-sm font-medium">Sign in with Fluent to get a deposit address</span>
            <span className="text-xs opacity-50">
              Deposits are credited to your Fluent account. Your wallet stays connected to sign them.
            </span>
          </div>
          {onSignIn ? (
            <Button className="w-full" onClick={onSignIn}>
              Sign in with Fluent
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {showApprovalSteps ? (
            <ApprovalSteps
              currentStep={approvalStep}
              actionLabel="Deposit"
              busy={approvalStep === 1 ? bridge.approving : bridge.connecting}
            />
          ) : null}
          {showApprovalSteps && approvalStep === 1 ? (
            <Button className="w-full" disabled={!canApprove} onClick={bridge.approve}>
              {bridge.approving ? (
                <>
                  <Spinner className="size-4" />
                  Approving…
                </>
              ) : (
                `Approve ${token.symbol}`
              )}
            </Button>
          ) : (
          <Button
            className="w-full"
            // A Two-step deposit waits for its swap to be priced: the person
            // asked for the other token, and a deposit that cannot deliver it
            // is not the deposit they asked for.
            disabled={!form.canSubmit || swapUnpriced}
            onClick={bridge.submit}
          >
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
              `Deposit to ${route.destination.name.split(" ")[0]}`
            )}
          </Button>
          )}
          {/* Only reachable while idle — a deposit in flight renders the status
              view instead, so this cannot pull the wallet mid-signature. */}
          <Button variant="ghost" className="w-full" onClick={bridge.disconnect}>
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
