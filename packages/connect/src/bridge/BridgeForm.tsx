import { fluentTokenIdentity, type FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { Check, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import type { Address, Hash } from "viem";

import {
  AMOUNT_INPUT_CLASS,
  AmountCard,
  formatAmount,
  formatAmountUsd,
  formatUsd,
  getAmountFontStyle,
  SummaryRow,
} from "../components/AmountForm";
import { Button } from "../components/ui/button";
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
import {
  BridgeTokenPicker,
  TokenChainIcon,
  TokenPickerTrigger,
  type BridgeTokenOption,
} from "./BridgeTokenPicker";
import { depositSwapCopy, type DepositSwapInFlight } from "./depositSwapCopy";
import type { FluentBridgeRoute } from "./route";
import {
  getBridgeToken,
  getBridgeTokens,
  isBridgeTokenAvailable,
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

/** The arriving token, static — shown where there is nothing to choose between. */
function TokenChip({ symbol }: { symbol: string }) {
  return (
    <span className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.06] pl-2 pr-3.5 text-foreground">
      <TokenChainIcon symbol={symbol} chain="destination" />
      <span className="text-sm font-medium leading-none whitespace-nowrap">{symbol}</span>
    </span>
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

function StatusView({
  route,
  bridge,
  onOpenPortal,
  swap,
}: {
  route: FluentBridgeRoute;
  bridge: ReturnType<typeof useBridgeDeposit>;
  onOpenPortal: () => void;
  /**
   * Present only for a Two-step deposit still being signed: the swap leg to come.
   * Once the deposit is signed, `DepositSwapStatusView` takes over.
   */
  swap?: { target: string };
}) {
  const { state, token, deliveredToken } = bridge;
  const step = state.phase === "settled" ? 3 : state.phase === "relaying" ? 2 : 1;
  const settled = state.phase === "settled";
  const heading =
    settled
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
    settled
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
    <div className="flex w-full flex-col gap-4 flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3 px-4 pt-8 text-center">
        {/* A Two-step deposit being signed reads as one wait, not as a stepper:
            the form already announced the swap, and the bridge is all that is
            happening yet. */}
        {swap ? (
          <StatusGlyph status="loading" />
        ) : (
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
          <span className="text-sm opacity-50">
            {swap ? `${detail} Swapped to ${swap.target} once it lands on Fluent.` : detail}
          </span>
        </div>
      </div>
      {state.phase === "settled" && !state.receivedHash ? (
        <span className="text-center text-xs text-muted-foreground">
          Looking up the arrival on {route.destination.name}…
        </span>
      ) : null}

      {/* As on the Two-step deposit's screen: the next step leads, the
          transaction to look up sits quietly under it. */}
      <div className="flex w-full flex-col gap-2">
        {settled ? (
          <Button className="w-full" onClick={bridge.reset}>
            Make another deposit
          </Button>
        ) : null}
        {state.phase === "relaying" && state.slow ? (
          <Button variant="ghost" className="w-full" onClick={onOpenPortal}>
            Check status on Fluent Portal
          </Button>
        ) : null}
        {explorerLink ? (
          <Button
            variant="ghost"
            className="w-full"
            href={explorerLink.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on {explorerLink.name}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type StatusGlyphStatus = "loading" | "done" | "failed" | "waiting";

/**
 * The one mark a status screen leads with: a spinner while something runs, a
 * check once it is done, a cross where it stopped, and a plain dot while the
 * next move is the person's.
 */
function StatusGlyph({ status }: { status: StatusGlyphStatus }) {
  return (
    <span
      aria-hidden
      className={`flex size-12 items-center justify-center rounded-full ${
        status === "failed" ? "bg-destructive/15 text-destructive" : "bg-foreground/[0.06]"
      }`}
    >
      {status === "loading" ? (
        <Spinner className="size-5" />
      ) : status === "done" ? (
        <Check className="size-5" strokeWidth={3} />
      ) : status === "failed" ? (
        <X className="size-5" strokeWidth={3} />
      ) : (
        <span className="size-2 rounded-full bg-[#ff8fda]" />
      )}
    </span>
  );
}

/** Which mark a Two-step deposit's screen leads with in a given state. */
function depositSwapGlyph(state: DepositSwapInFlight): StatusGlyphStatus {
  switch (state.phase) {
    case "bridging":
    case "swapping":
    case "unconfirmed":
      return "loading";
    case "settled":
      return "done";
    case "bridge_failed":
    case "error":
      return "failed";
    // A landed deposit is priced and swapped on its own; it only waits when too
    // little landed to swap.
    case "ready":
      return state.leg.from.amount === 0n ? "waiting" : "loading";
    case "declined":
      return "waiting";
  }
}

/**
 * A Two-step deposit from the moment its bridge leg is signed. Its state is held
 * above the drawer (`useFluentDepositSwap`), so this view is drawn from that
 * state alone and comes back the same after any other page, or a reload.
 */
function DepositSwapStatusView({
  route,
  network,
  depositSwap,
  onOpenPortal,
  onGoHome,
  retry,
  blocked,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  depositSwap: FluentDepositSwap;
  onOpenPortal: () => void;
  onGoHome?: () => void;
  /** Runs the swap at today's price; absent while no fresh quote is in hand. */
  retry?: () => void;
  /** What the confirm button says while there is no price to confirm. */
  blocked: string;
}) {
  const { state, slow } = depositSwap;
  if (state.phase === "idle") return null;
  const tokens = "leg" in state ? state.leg : state.deposit;
  const { heading, detail } = depositSwapCopy(state, slow, route);
  // A swap is offered only once its own send stopped short: a landed deposit is
  // swapped without a press, so `ready` shows the wait rather than a button.
  const pricing = state.phase === "ready" && state.leg.from.amount > 0n;
  const swapOffered = state.phase === "declined" || state.phase === "error";

  const explorerLink =
    state.phase === "settled"
      ? { url: explorerTransaction(state.hash, network), name: "FluentScan" }
      : state.phase === "bridging" || state.phase === "bridge_failed"
        ? {
            url: `${route.source.blockExplorers?.default.url}/tx/${state.deposit.sentHash}`,
            name: route.source.blockExplorers?.default.name,
          }
        : undefined;

  return (
    <div className="flex w-full flex-col gap-4 flex-1 items-center justify-center">
      {/* One status, as a loading screen: what is happening now, not the steps
          around it. The form showed the two steps before anything was signed. */}
      <div className="flex flex-col items-center gap-3 px-4 pt-8 text-center">
        <StatusGlyph status={depositSwapGlyph(state)} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{heading}</span>
          <span className="text-sm opacity-50">{detail}</span>
        </div>
      </div>

      {/* What to do next leads; the transaction to look up sits under it, quiet,
          as the last way out rather than a call to action. */}
      <div className="flex w-full flex-col gap-2">
        {state.phase === "bridging" ? (
          // The wait need not be watched: the deposit is held above the drawer, so
          // Home is a way out that loses nothing, and this page shows it again on
          // return. Slow, the Portal can say more, and the swap can be given up on
          // — the deposit still lands, only the swap after it is dropped.
          <div className="flex w-full flex-col gap-2">
            {onGoHome ? (
              <Button className="w-full" onClick={onGoHome}>
                Back to Home
              </Button>
            ) : null}
            {slow ? (
              <>
                <Button variant="secondary" className="w-full" onClick={onOpenPortal}>
                  Check status on Fluent Portal
                </Button>
                <Button variant="ghost" className="w-full" onClick={depositSwap.reset}>
                  Skip the swap
                </Button>
              </>
            ) : null}
          </div>
        ) : state.phase === "bridge_failed" ? (
          <div className="flex w-full flex-col gap-2">
            <Button variant="secondary" className="w-full" onClick={onOpenPortal}>
              Check status on Fluent Portal
            </Button>
            <Button className="w-full" onClick={depositSwap.reset}>
              Start over
            </Button>
          </div>
        ) : state.phase === "swapping" || pricing ? (
          // Home loses nothing here either: the swap is sent from above the drawer.
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" disabled>
              <Spinner className="size-4" />
              Swapping…
            </Button>
            {onGoHome ? (
              <Button variant="ghost" className="w-full" onClick={onGoHome}>
                Back to Home
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {/* Offered while the swap is still worth doing and safe to send. Without
                a price there is nothing to confirm, so the button says what it is
                waiting for rather than disappearing. */}
            {!swapOffered ? null : retry ? (
              <Button className="w-full" onClick={retry}>
                {state.phase === "error" ? "Try the swap again" : `Swap to ${tokens.to.symbol}`}
              </Button>
            ) : (
              <Button className="w-full" disabled>
                {blocked}
              </Button>
            )}
            <Button
              variant={swapOffered ? "ghost" : "default"}
              className="w-full"
              onClick={depositSwap.reset}
            >
              {swapOffered ? `Keep the ${tokens.from.symbol} instead` : "Make another deposit"}
            </Button>
          </div>
        )}
        {explorerLink ? (
          <Button
            variant="ghost"
            className="w-full"
            href={explorerLink.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on {explorerLink.name}
          </Button>
        ) : null}
      </div>
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
  onGoHome,
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
  /** Leaves the Bridge page for the wallet menu's Home; without it no such button shows. */
  onGoHome?: () => void;
}) {
  const tokens = getBridgeTokens(network);
  const [symbol, setSymbol] = useState<BridgeTokenSymbol>("ETH");
  const token = getBridgeToken(network, symbol);
  // Filled in below, once the swap leg's terms are known: the hook has to exist
  // before them, and reads this only at the signature.
  const handOver = useRef<
    ((deposit: { hash: Hash; sender: Address; delivered: bigint }) => boolean) | undefined
  >(undefined);
  const bridge = useBridgeDeposit({
    route,
    network,
    recipient,
    token,
    onSubmitted: (deposit) => handOver.current?.(deposit) ?? false,
  });
  const { form, state, deliveredToken } = bridge;
  // What to end up with on Fluent. Undefined is "whatever the bridge delivers",
  // so a Send token change cannot leave a stale swap target behind.
  const [receiveSymbol, setReceiveSymbol] = useState<string | undefined>(undefined);
  // Which card's token list is open in place of the form, if either.
  const [picking, setPicking] = useState<"send" | "receive" | undefined>(undefined);
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
  // A deposit already handed over names its own pair and amount: the form may
  // have been remounted since, or the page reloaded, so the selection above is
  // gone by then. Its leg sells what actually landed, not what was typed.
  const swapState = depositSwap?.state;
  const sentLeg = swapState && "leg" in swapState ? swapState.leg : undefined;
  const swapQuote = useFluentSwapQuote({
    network,
    tokenIn: sentLeg ? findFluentSwapToken(network, sentLeg.from.symbol) : swapSource,
    tokenOut: sentLeg ? findFluentSwapToken(network, sentLeg.to.symbol) : swapTarget,
    amountIn: sentLeg ? sentLeg.from.amount : swapInput,
    // A price is worth reading while one can still be acted on here: on the form,
    // and after a swap that stopped short, because trying again prices it afresh.
    // A landed deposit is priced by `useFluentDepositSwap` itself.
    enabled:
      !swapState ||
      swapState.phase === "idle" ||
      swapState.phase === "declined" ||
      swapState.phase === "error",
  });

  const quote = swapQuote.quote;
  // What a swap button says while there is no price to confirm: why, when that
  // is known, rather than a word that fits every reason.
  const unpricedLabel = swapQuote.loading
    ? "Pricing the swap…"
    : swapQuote.noRoute
      ? "No pool for this swap on Fluent"
      : swapQuote.error
        ? "The swap cannot be priced right now"
        : "The swap cannot be priced";

  // Once the deposit is signed the Two-step deposit is the whole story, and it
  // is told from the state held above the drawer.
  if (depositSwap && swapState && swapState.phase !== "idle") {
    return (
      <DepositSwapStatusView
        route={route}
        network={network}
        depositSwap={depositSwap}
        onOpenPortal={onOpenPortal}
        onGoHome={onGoHome}
        retry={quote ? () => void depositSwap.run(quote) : undefined}
        blocked={unpricedLabel}
      />
    );
  }

  const twoStep = Boolean(depositSwap && swapTarget && swapSource);
  handOver.current =
    twoStep && depositSwap && swapSource && swapTarget && recipient
      ? ({ hash, sender, delivered }) => {
          const taken = depositSwap.begin({
            sentHash: hash,
            sender,
            recipient,
            from: swapSource,
            to: swapTarget,
            expected: delivered,
          });
          // The ask goes with the deposit it was made for, or the next deposit
          // would inherit this one's swap target without anyone choosing it.
          if (taken) setReceiveSymbol(undefined);
          return taken;
        }
      : undefined;
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

  if (state.phase !== "idle" && state.phase !== "error") {
    return (
      <StatusView
        route={route}
        bridge={bridge}
        onOpenPortal={onOpenPortal}
        swap={twoStep && swapTarget ? { target: swapTarget.symbol } : undefined}
      />
    );
  }

  if (picking === "send") {
    // Tokens the network cannot bridge stay listed but disabled, with the
    // reason: hiding them would make testnet look like it lacks the feature
    // rather than the liquidity.
    const options: BridgeTokenOption[] = tokens.map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      caption: candidate.unavailableReason,
      disabled: !isBridgeTokenAvailable(candidate),
    }));
    return (
      <BridgeTokenPicker
        options={options}
        value={symbol}
        chain="source"
        networkName={route.source.name}
        onSelect={(next) => {
          setSymbol(next as BridgeTokenSymbol);
          setPicking(undefined);
        }}
        onBack={() => setPicking(undefined)}
      />
    );
  }

  // Only while there is a swap to pick: the targets empty out when the Fluent ID
  // that would run the leg goes, and the form falls back to its static chip.
  if (picking === "receive" && swapTargets.length > 0) {
    // The delivered token is one of the options and the default; any other one
    // makes the deposit a Two-step deposit. Each row names its token only: the
    // Fluent badge on every icon already says where it ends up.
    const options: BridgeTokenOption[] = [
      { symbol: deliveredToken.symbol, name: deliveredToken.name },
      ...swapTargets.map((candidate) => ({ symbol: candidate.symbol, name: candidate.name })),
    ];
    return (
      <BridgeTokenPicker
        options={options}
        value={swapTarget?.symbol ?? deliveredToken.symbol}
        chain="destination"
        networkName={route.destination.name}
        onSelect={(next) => {
          setReceiveSymbol(next === deliveredToken.symbol ? undefined : next);
          setPicking(undefined);
        }}
        onBack={() => setPicking(undefined)}
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
            <TokenPickerTrigger
              symbol={symbol}
              chain="source"
              label="Token to deposit"
              onOpen={() => setPicking("send")}
            />
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
              <TokenPickerTrigger
                symbol={receiveToken.symbol}
                chain="destination"
                label="Token to receive on Fluent"
                onOpen={() => setPicking("receive")}
              />
            ) : (
              <TokenChip symbol={deliveredToken.symbol} />
            )}
          </div>
          {swapProblem ? <span className="text-xs text-destructive">{swapProblem}</span> : null}
        </AmountCard>
      </div>

      {/* The Portal's summary: what the chain charges, what the bridge charges,
          and the two together. What arrives is already on the card above. */}
      <TooltipProvider delay={200}>
      <div className="flex flex-col gap-3.5 py-2">
        <SummaryRow
          label="Network fee"
          value={formatFee(bridge.gasFee, ethSymbol, bridge.gasFeeLoading)}
          secondary={formatFeeUsd(bridge.gasFee, ethUsdPrice)}
        />
        {/* Only a fee there is: a route that charges nothing, or one not priced
            yet, has no row rather than a "0 ETH" or "Estimating…" that says
            nothing. Total fees below still counts it once it is known. */}
        {bridge.fee !== undefined && bridge.fee > 0n ? (
          <SummaryRow
            label={isFastPath ? "Settlement fee" : "Relayer gas fee"}
            value={formatFee(bridge.fee, ethSymbol, false)}
            secondary={formatFeeUsd(bridge.fee, ethUsdPrice)}
            tooltip={
              isFastPath
                ? "The settlement fee covers the fast path message delivery and liquidity route."
                : "The relayer gas fee is used to cover the cost of sending the message to the destination chain."
            }
          />
        ) : null}
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
              label="Minimum received"
              value={
                minimumOut === undefined
                  ? swapQuote.loading
                    ? "Pricing…"
                    : "—"
                  : `${formatAmount(minimumOut, swapTarget.decimals)} ${swapTarget.symbol}`
              }
              tooltip={SLIPPAGE_TOOLTIP}
            />
            <SummaryRow label="Slippage" value={SLIPPAGE_LABEL} />
          </>
        ) : null}
        {/* Only the swap route gets a note: the stepper already announces an ERC-20's two signatures. */}
        {isSwap ? (
          <span className="text-xs text-foreground/60">
            {`Fluent settles in ${deliveredToken.symbol}, so ${token.symbol} is first swapped to ${deliveredToken.symbol} on ${route.source.name} at 1:1, then bridged. Fee and gas are paid in ${ethSymbol}; expect up to four signatures — two approvals, the swap, the deposit.`}
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
            ) : swapUnpriced && form.canSubmit ? (
              swapQuote.loading ? (
                <>
                  <Spinner className="size-4" />
                  {unpricedLabel}
                </>
              ) : (
                unpricedLabel
              )
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
