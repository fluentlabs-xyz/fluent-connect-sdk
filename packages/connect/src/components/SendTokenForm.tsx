import {
  fluentTokenIdentity,
  isFluentDefaultToken,
  isFluentNativeToken,
  type FluentDisplayToken,
  type FluentTokenBalance,
} from "@fluent.xyz/connect-sdk";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";

import {
  getFluentGasPaymentEthValue,
  type FluentGasPaymentEthRates,
  type FluentGasTokenSymbol,
} from "../core/gasPayment";
import {
  checkFluentTransferFee,
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
  type FluentTokenTransferSender,
  type FluentTransferFee,
} from "../widget/tokenTransfer";
import {
  convertFluentFeeToGasToken,
  useTransferFeeEstimate,
  type FluentTransferFeeEstimate,
} from "../widget/hooks/useTransferFeeEstimate";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import {
  AMOUNT_INPUT_CLASS,
  AmountCard,
  formatAmount,
  formatAmountUsd,
  formatUsd,
  getAmountFontStyle,
  SummaryRow,
} from "./AmountForm";
import { Icon } from "./Icon";
import { VISUAL_BY_DEFAULT_SYMBOL } from "./tokenVisuals";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { TooltipProvider } from "./ui/tooltip";

/**
 * A token's glyph on a round tile, drawn as the token list draws it: Fluent's
 * own tokens get their brand tile, a listed stranger its logo, anything else
 * its initial. The default-token gate is the list's too — the symbol comes off
 * a contract, so without it anything calling itself BLEND would look official.
 */
function TokenGlyph({ token, className = "size-7" }: { token?: FluentDisplayToken; className?: string }) {
  const visual = token && isFluentDefaultToken(token) ? VISUAL_BY_DEFAULT_SYMBOL[token.symbol] : undefined;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${visual?.bgClassName ?? "bg-foreground/10"} ${className}`}
    >
      {visual ? (
        <Icon
          name={visual.icon}
          className={visual.iconClassName.includes("text-white") ? "size-4 text-white" : "size-4"}
        />
      ) : token?.logoURI ? (
        // An <img>, never inlined: the URL is an integrator's or a stranger's.
        <img src={token.logoURI} alt="" aria-hidden="true" className="size-full object-cover" />
      ) : (
        <span className="text-xs font-medium">{token?.symbol.slice(0, 1) ?? "?"}</span>
      )}
    </span>
  );
}

/** The token picker, the same pill as the Bridge page's so the two cards line up. */
function TokenSelect({
  tokens,
  value,
  disabled,
  onChange,
}: {
  tokens: readonly FluentDisplayToken[];
  value?: FluentDisplayToken;
  disabled: boolean;
  onChange: (identity: string) => void;
}) {
  return (
    <Select
      value={value?.identity ?? null}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label="Token to send"
        className="!h-11 shrink-0 gap-2 rounded-full border-0 !bg-foreground/[0.06] py-0 pl-2 pr-3.5 text-sm font-medium shadow-none hover:!bg-foreground/10 [&>svg:last-child]:size-4 [&>svg:last-child]:text-foreground/70"
      >
        <TokenGlyph token={value} />
        {/* The symbol, not a `SelectValue`: the value is the token identity,
            which is what `SelectValue` would print. */}
        <span className="whitespace-nowrap">{value?.symbol ?? "No tokens"}</span>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-44">
        {tokens.map((candidate) => (
          <SelectItem key={candidate.identity} value={candidate.identity}>
            <TokenGlyph token={candidate} className="size-5" />
            <span>{candidate.symbol}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The estimated fee as the Bridge page prints its own: a word while the chain
 * is asked, a dash while there is nothing to ask about, otherwise the figure
 * in the token it is charged in — or in the chain's coin where that token has
 * no rate to convert by.
 */
function formatEstimatedFee(params: {
  estimate: FluentTransferFeeEstimate;
  feeToken?: FluentDisplayToken;
  nativeSymbol: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  usdPrices: Readonly<Record<string, number>>;
  nativeIdentity?: string;
}): { value: string; secondary?: string } {
  const { estimate, feeToken, nativeSymbol, ethValueByToken, usdPrices, nativeIdentity } = params;
  if (estimate.status === "loading") return { value: "Estimating…" };
  if (estimate.status !== "ready" || !feeToken) return { value: "—" };

  const inFeeToken = convertFluentFeeToGasToken({ wei: estimate.wei, feeToken, ethValueByToken });
  const usdOf = (raw: bigint, decimals: number, price: number | undefined) => {
    if (price === undefined || raw === 0n) return undefined;
    const usd = Number(formatUnits(raw, decimals)) * price;
    return Number.isFinite(usd) && usd > 0 ? formatUsd(usd) : undefined;
  };

  if (inFeeToken === undefined) {
    return {
      value: `${formatAmount(estimate.wei, 18)} ${nativeSymbol}`,
      secondary: usdOf(estimate.wei, 18, nativeIdentity ? usdPrices[nativeIdentity] : undefined),
    };
  }
  return {
    value: `≈ ${formatAmount(inFeeToken, feeToken.decimals)} ${feeToken.symbol}`,
    secondary: usdOf(inFeeToken, feeToken.decimals, usdPrices[feeToken.identity]),
  };
}

/**
 * The Send page: one Display token out of the widget account, laid out as the
 * Bridge page lays out a deposit — the amount on a card with the token pill,
 * the destination on a card below it, then the summary and one button. The
 * drawer's header carries the title and the way back.
 *
 * Both fields are checked as they are typed and the button stays down until
 * every check passes: `parseFluentTransfer*` owns the rules, and this only
 * decides when their verdicts are worth showing. An amount is never checked
 * against a balance that has not arrived — until it does, there is nothing to
 * compare against and the page says so instead of letting a send through.
 */
export function SendTokenForm({
  tokens,
  balances,
  balancesBusy,
  accountAddress,
  usdPrices = {},
  gasTokens,
  defaultGasSymbol,
  erc20GasAvailable = true,
  sponsorshipAvailable = false,
  ethValueByToken,
  onSend,
  onSent,
}: {
  /** The display tokens the account holds, in list order. */
  tokens: readonly FluentDisplayToken[];
  balances: readonly FluentTokenBalance[];
  balancesBusy: boolean;
  /** The account the transfer leaves, so it cannot also be the destination. */
  accountAddress?: string;
  /** USD per token, keyed by identity, for the line under the amount. */
  usdPrices?: Readonly<Record<string, number>>;
  /** Tokens the paymaster can charge the fee to, in priority order. */
  gasTokens: readonly FluentDisplayToken[];
  /** This person's stored gas token, which the fee selector opens on. */
  defaultGasSymbol: FluentGasTokenSymbol;
  /**
   * False for an external wallet: it has no paymaster and always pays its own
   * native gas, so there is no fee token to choose.
   */
  erc20GasAvailable?: boolean;
  /** True where the App's paymaster may cover a native-gas operation. */
  sponsorshipAvailable?: boolean;
  /** `gasPayment.ethValueByToken` from the App's config, where it set any. */
  ethValueByToken?: FluentGasPaymentEthRates;
  onSend: FluentTokenTransferSender;
  /** The transfer went out; the page has nothing left to show. */
  onSent: () => void;
}) {
  const { chain } = useFluentWidgetNetwork();
  const [identity, setIdentity] = useState<string | null>(null);
  const [gasIdentity, setGasIdentity] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Not seeded into state: the list arrives asynchronously, so a default picked
  // on the first render would be whatever happened to be there at the time.
  const token = tokens.find((candidate) => candidate.identity === identity) ?? tokens[0];

  const balanceByIdentity = useMemo(
    () => new Map(balances.map((entry) => [fluentTokenIdentity(entry), entry])),
    [balances],
  );
  const balance = token ? balanceByIdentity.get(token.identity) : undefined;
  const rawBalance = balance?.status === "ready" ? balance.raw : null;

  // An external wallet has no paymaster — it pays its own native gas whatever is
  // stored — so it is shown no choice, and the native token is what the
  // warnings below weigh.
  const chosenGasToken =
    gasTokens.find((candidate) => candidate.identity === gasIdentity) ??
    gasTokens.find((candidate) => candidate.symbol === defaultGasSymbol) ??
    gasTokens[0];
  const feeToken = erc20GasAvailable
    ? chosenGasToken
    : gasTokens.find(isFluentNativeToken) ?? chosenGasToken;
  const feeBalance = feeToken ? balanceByIdentity.get(feeToken.identity) : undefined;
  const rawFeeBalance = feeBalance?.status === "ready" ? feeBalance.raw : null;

  // A token's own contract is a valid-looking address that swallows whatever is
  // sent to it, so every listed one is barred as a destination — not just the
  // one being sent.
  const contracts = useMemo(
    () =>
      new Set(
        tokens
          .map((candidate) => candidate.address?.toLowerCase())
          .filter((address): address is string => Boolean(address)),
      ),
    [tokens],
  );

  const recipientCheck = parseFluentTransferRecipient({
    input: recipient,
    self: accountAddress,
    contracts,
  });
  const amountCheck =
    token && rawBalance !== null
      ? parseFluentTransferAmount({
          input: amount,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: rawBalance,
        })
      : null;

  const balanceNote =
    token && rawBalance !== null
      ? `${formatAmount(rawBalance, token.decimals)} ${token.symbol}`
      : balancesBusy
        ? "Loading balance..."
        : "Balance unavailable";
  const amountUsd = token ? formatAmountUsd(amount, usdPrices[token.identity]) : undefined;

  const fee: FluentTransferFee = feeToken
    ? checkFluentTransferFee({
        feeToken,
        feeBalance: rawFeeBalance,
        feeBalanceEthValue: getFluentGasPaymentEthValue({
          balance: feeBalance,
          ethValueByToken,
        }).ethValueWei,
        sponsorshipAvailable,
      })
    : { status: "ok" };

  // Asked of the chain as the Bridge page asks it: once there is a recipient
  // and an amount worth sending, and again whenever either changes.
  const feeEstimate = useTransferFeeEstimate({
    chain,
    account: accountAddress,
    token,
    to: recipientCheck.status === "ok" ? recipientCheck.address : null,
    amount: amountCheck?.status === "ok" ? amountCheck.raw : null,
  });
  const nativeToken = tokens.find(isFluentNativeToken) ?? gasTokens.find(isFluentNativeToken);
  const estimatedFee = formatEstimatedFee({
    estimate: feeEstimate,
    feeToken,
    nativeSymbol: chain.nativeCurrency.symbol,
    ethValueByToken,
    usdPrices,
    nativeIdentity: nativeToken?.identity,
  });
  const feeSponsored = Boolean(feeToken && isFluentNativeToken(feeToken) && sponsorshipAvailable);

  // How much of a fee token there is to pay with, printed beside its name in
  // the picker so the choice can be made without leaving the form. Unread balances say so
  // rather than showing a zero that would look like an empty wallet.
  const feeBalanceLabel = (candidate: FluentDisplayToken): string => {
    const entry = balanceByIdentity.get(candidate.identity);
    if (entry?.status === "ready" && entry.raw !== null) return formatAmount(entry.raw, candidate.decimals);
    return balancesBusy ? "…" : "—";
  };

  const ready =
    Boolean(token) &&
    recipientCheck.status === "ok" &&
    amountCheck?.status === "ok" &&
    fee.status !== "blocked" &&
    !sending;

  const handleSend = async () => {
    if (!token || !feeToken) return;
    if (recipientCheck.status !== "ok" || amountCheck?.status !== "ok") return;
    if (fee.status === "blocked") return;
    setSendError(null);
    setSending(true);
    try {
      const outcome = await onSend({
        token,
        to: recipientCheck.address,
        amount: amountCheck.raw,
        gasSymbol: feeToken.symbol,
      });
      // "rejected" leaves the page exactly as it was: the user dismissed the
      // review and the amount they typed is still the one they meant.
      if (outcome.status === "sent") onSent();
      if (outcome.status === "failed") setSendError(outcome.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-4" aria-label="Send tokens">
      <div className="flex flex-col gap-2">
        <AmountCard label="Send">
          <div className="flex items-center gap-5">
            <div className="flex min-w-0 flex-1 flex-col [container-type:inline-size]">
              <input
                aria-label={`Amount of ${token?.symbol ?? "tokens"} to send`}
                className={AMOUNT_INPUT_CLASS}
                style={getAmountFontStyle(amount || "0")}
                placeholder="0"
                // `decimal` rather than `numeric`: the phone keypad it opens is
                // the only one with a decimal point on it.
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={sending}
                aria-invalid={amountCheck?.status === "rejected" ? true : undefined}
                value={amount}
                onChange={(event) => {
                  setSendError(null);
                  setAmount(event.target.value);
                }}
              />
            </div>
            <TokenSelect
              tokens={tokens}
              value={token}
              disabled={sending || tokens.length === 0}
              onChange={(next) => {
                setSendError(null);
                // The amount was typed against the old token's balance and decimals.
                setAmount("");
                setIdentity(next);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-1 text-sm text-foreground/60">
              <span>{amountUsd}</span>
              <div className="flex items-center gap-1">
                <span
                  className="tabular-nums"
                  title={
                    token && rawBalance !== null ? formatUnits(rawBalance, token.decimals) : undefined
                  }
                >
                  {balanceNote}
                </span>
                <button
                  type="button"
                  className="font-medium text-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={sending || rawBalance === null || rawBalance === 0n}
                  onClick={() => {
                    if (!token || rawBalance === null) return;
                    setSendError(null);
                    setAmount(formatUnits(rawBalance, token.decimals));
                  }}
                >
                  Max
                </button>
              </div>
            </div>
            {amountCheck?.status === "rejected" ? (
              <span className="text-xs text-destructive">{amountCheck.message}</span>
            ) : null}
          </div>
        </AmountCard>

        <AmountCard label="To">
          <input
            aria-label="Recipient address"
            className={`${AMOUNT_INPUT_CLASS} text-sm`}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            disabled={sending}
            aria-invalid={recipientCheck.status === "rejected" ? true : undefined}
            value={recipient}
            onChange={(event) => {
              setSendError(null);
              setRecipient(event.target.value);
            }}
          />
          {recipientCheck.status === "rejected" ? (
            <span className="text-xs text-destructive">{recipientCheck.message}</span>
          ) : null}
        </AmountCard>
      </div>

      <TooltipProvider delay={200}>
        <div className="flex flex-col gap-3.5 py-2">
          <SummaryRow label="Network" value={chain.name} />
          <SummaryRow
            label="Fee paid in"
            value={
              erc20GasAvailable ? (
                <Select
                  value={feeToken?.identity ?? null}
                  disabled={sending || gasTokens.length === 0}
                  onValueChange={(value) => {
                    if (!value) return;
                    setSendError(null);
                    setGasIdentity(value);
                  }}
                >
                  <SelectTrigger
                    aria-label="Token the fee is paid in"
                    size="sm"
                    className="!h-auto shrink-0 gap-1.5 border-0 bg-transparent p-0 text-sm text-foreground shadow-none dark:bg-transparent dark:hover:bg-transparent"
                  >
                    <TokenGlyph token={feeToken} className="size-4 [&>svg]:size-2.5 [&>span]:text-[10px]" />
                    <span>{feeToken?.symbol ?? "No fee token"}</span>
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false} className="min-w-52">
                    {gasTokens.map((candidate) => (
                      <SelectItem key={candidate.identity} value={candidate.identity}>
                        <TokenGlyph token={candidate} className="size-5" />
                        <span>{candidate.symbol}</span>
                        <span className="ml-auto pl-4 text-foreground/60">
                          {feeBalanceLabel(candidate)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                (feeToken?.symbol ?? "Native currency")
              )
            }
            secondary={erc20GasAvailable ? undefined : "your wallet"}
            tooltip={
              erc20GasAvailable
                ? `This transfer only. Your saved choice stays ${defaultGasSymbol}.`
                : "An external wallet has no paymaster, so it pays the network fee itself."
            }
          />
          <SummaryRow
            label="Est. network fee"
            value={estimatedFee.value}
            secondary={estimatedFee.secondary}
            tooltip={
              feeSponsored
                ? "What the network charges for this transfer. The app may cover it; the review shows the exact amount."
                : "What the network charges for this transfer, converted to the fee token at today's rate. The review shows the exact amount."
            }
          />
        </div>
      </TooltipProvider>

      {fee.status !== "ok" ? (
        <p
          className={`flex gap-2 rounded-xl p-3 text-xs ${
            fee.status === "blocked"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-400/10 text-amber-300"
          }`}
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{fee.message}</span>
        </p>
      ) : null}

      {sendError ? <span className="text-xs text-destructive">{sendError}</span> : null}

      <Button className="w-full" disabled={!ready} onClick={() => void handleSend()}>
        {sending ? (
          <>
            <Spinner className="size-4" />
            Sending…
          </>
        ) : (
          `Send ${token?.symbol ?? ""}`.trim()
        )}
      </Button>

      <span className="text-balance text-center text-[10px] text-foreground/60">
        Send only to addresses on {chain.name}. Transfers are final, and funds sent to another
        network may be lost.
      </span>
    </div>
  );
}
