import type { FluentTokenBalance, FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { useMemo } from "react";
import {
  formatFluentGasTokenBalance,
  formatFluentLocaleAmount,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
} from "../gasPayment";
import { fluentDefaultGasTokens } from "../hooks/useFluentTokenBalances";
import { formatAddress } from "../utils/formatAddress";
import { Icon, type IconName } from "./Icon";

const tokenIcons: Record<string, IconName> = {
  ETH: "eth",
  USDnr: "usdnr",
  BLEND: "fluent",
};

const tokenIconClassName: Record<string, string> = {
  ETH: "size-6 text-white",
  USDnr: "size-6 text-white",
  BLEND: "size-4",
};

const tokenBgClassName: Record<string, string> = {
  ETH: "bg-[#627EEA]",
  USDnr: "bg-[#7f52d0]",
  BLEND: "bg-[#FFFFFF]/10",
};

export function WalletMenuGasPayment({
  accountAddress,
  balances,
  busy,
  usdPrices = {},
  bridgeUrl: _bridgeUrl,
  ethValueByToken: _ethValueByToken,
  tokens = fluentDefaultGasTokens,
  selectedSymbol,
  onSelectedSymbolChange,
}: {
  accountAddress?: `0x${string}`;
  balances: readonly FluentTokenBalance[];
  busy: boolean;
  usdPrices?: Readonly<Record<string, number>>;
  bridgeUrl: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  tokens?: readonly FluentTokenDefinition[];
  selectedSymbol: FluentGasPaymentSymbol;
  onSelectedSymbolChange: (symbol: FluentGasPaymentSymbol) => void;
}) {
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(tokens), [tokens]);

  const sortedRows = useMemo(
    () =>
      gasTokens
        .map((token, index) => ({
          token,
          balance: balances.find((item) => item.symbol === token.symbol),
          index,
        }))
        .sort((left, right) => {
          const leftRaw = getComparableBalance(left.balance);
          const rightRaw = getComparableBalance(right.balance);
          if (leftRaw === rightRaw) return left.index - right.index;
          return rightRaw > leftRaw ? 1 : -1;
        }),
    [balances, gasTokens],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4" aria-label="Gas payment tokens">
        {sortedRows.map(({ token, balance }) => {
          const symbol = token.symbol as FluentGasPaymentSymbol;
          const unavailable = balance?.status === "not-configured";
          const failed = balance?.status === "error";
          const iconName = tokenIcons[symbol];
          const active = selectedSymbol === symbol;
          const formatted =
            balance?.status === "ready"
              ? formatFluentGasTokenBalance(balance, 0) ??
                (balance.formatted ? formatFluentLocaleAmount(balance.formatted, 0) : null)
              : null;
          const usdValueLabel = formatTokenUsdValue(balance, usdPrices[symbol]);

          return (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl text-left transition-colors"
              aria-pressed={active}
              disabled={unavailable || failed}
              key={symbol}
              onClick={() => onSelectedSymbolChange(symbol)}
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tokenBgClassName[symbol] ?? "bg-white/10"}`}
              >
                {iconName ? (
                  <Icon
                    name={iconName}
                    className={tokenIconClassName[symbol] ?? "size-6 text-foreground"}
                  />
                ) : (
                  <span className="text-xs font-medium">{symbol.slice(0, 1)}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium leading-4">
                  {symbol}
                  {active && (
                    <span className="rounded-md bg-white/15 px-1.5 leading-[18px] text-[10px] font-normal text-muted-foreground -my-px">
                      Gas
                    </span>
                  )}
                </span>
                {token.address ? (
                  <span className="text-xs leading-4 opacity-50">
                    {formatAddress(token.address)}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs leading-4 text-muted-foreground">
                    {symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </span>

              <span className="flex flex-col items-end gap-0.5 tabular-nums">
                <span className="text-sm font-medium leading-4">
                  {renderBalanceLabel({
                    formatted,
                    unavailable,
                    failed,
                    isLoading: Boolean(accountAddress || busy),
                  })}
                </span>
                {usdValueLabel ? (
                  <span className="text-xs leading-4 opacity-50">{usdValueLabel}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTokenUsdValue(
  balance: FluentTokenBalance | undefined,
  usdPrice: number | undefined,
) {
  if (!balance || balance.status !== "ready" || balance.formatted === null) return null;
  if (usdPrice === undefined) return null;
  const amount = Number(balance.formatted);
  if (!Number.isFinite(amount)) return null;
  return `$${formatFluentLocaleAmount(amount * usdPrice, 2)}`;
}

function renderBalanceLabel({
  formatted,
  unavailable,
  failed,
  isLoading,
}: {
  formatted: string | null;
  unavailable: boolean;
  failed: boolean;
  isLoading: boolean;
}) {
  if (formatted) return formatted;
  if (unavailable) return "—";
  if (failed) return "Unavailable";
  if (isLoading) {
    return (
      <span
        className="inline-block h-4 w-16 animate-pulse rounded-md bg-white/10"
        aria-label="Loading balance"
      />
    );
  }
  return null;
}

function getComparableBalance(balance: FluentTokenBalance | undefined) {
  if (!balance || balance.status !== "ready" || balance.raw === null) return 0n;
  const decimals = BigInt(balance.decimals);
  if (decimals === 18n) return balance.raw;
  if (decimals < 18n) return balance.raw * 10n ** (18n - decimals);
  return balance.raw / 10n ** (decimals - 18n);
}
