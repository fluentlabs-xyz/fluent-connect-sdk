import type { FluentTokenBalance, FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { Copy } from "lucide-react";
import { useMemo } from "react";
import {
  formatFluentGasTokenBalance,
  formatFluentLocaleAmount,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
} from "../core/gasPayment";
import { fluentDefaultGasTokens } from "../hooks/useFluentTokenBalances";
import { copyAddressToClipboard } from "../utils/copyAddress";
import { formatAddress } from "../utils/formatAddress";
import { Icon, type IconName } from "./Icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

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
}: {
  accountAddress?: `0x${string}`;
  balances: readonly FluentTokenBalance[];
  busy: boolean;
  usdPrices?: Readonly<Record<string, number>>;
  bridgeUrl: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  tokens?: readonly FluentTokenDefinition[];
  selectedSymbol: FluentGasPaymentSymbol;
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
    <TooltipProvider delay={200}>
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
          const exactBalance =
            balance?.status === "ready" && balance.formatted?.includes(".")
              ? balance.formatted
              : null;

          return (
            <div
              className="flex w-full items-center gap-3 rounded-xl"
              key={symbol}
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
                  <Select
                    value={null}
                    onValueChange={(value) => {
                      if (value === "copy" && token.address) {
                        void copyAddressToClipboard(token.address);
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Token address actions for ${symbol}`}
                      className="!h-auto max-w-full gap-0.5 border-0 bg-transparent p-0 text-xs leading-4 opacity-100 shadow-none hover:opacity-80 dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3 [&_svg]:opacity-0 hover:[&_svg]:opacity-70 aria-expanded:opacity-80 aria-expanded:[&_svg]:opacity-70"
                    >
                      <span className="truncate">{formatAddress(token.address)}</span>
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      <SelectItem value="copy">
                        <Copy className="size-4" />
                        Copy address
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="shrink-0 text-xs leading-4 text-muted-foreground">
                    {symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </span>

              <span className="flex flex-col items-end gap-0.5 tabular-nums">
                <span className="text-sm font-medium leading-4">
                {exactBalance ? (
                  <Tooltip>
                    <TooltipTrigger
                      tabIndex={0}
                      aria-label={`${symbol} balance: ${exactBalance}`}
                      render={<span className="cursor-default rounded-sm" />}
                    >
                      {renderBalanceLabel({
                        formatted,
                        unavailable,
                        failed,
                        isLoading: busy,
                        hasAccount: Boolean(accountAddress),
                      })}
                    </TooltipTrigger>
                    <TooltipContent className="tabular-nums break-all">
                      {exactBalance} {symbol}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  renderBalanceLabel({
                    formatted,
                    unavailable,
                    failed,
                    isLoading: busy,
                    hasAccount: Boolean(accountAddress),
                  })
                )}
                </span>
                {usdValueLabel ? (
                  <span className="text-xs leading-4 opacity-50">{usdValueLabel}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
    </TooltipProvider>
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
  hasAccount,
}: {
  formatted: string | null;
  unavailable: boolean;
  failed: boolean;
  isLoading: boolean;
  hasAccount: boolean;
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
  if (hasAccount) return "0";
  return null;
}

function getComparableBalance(balance: FluentTokenBalance | undefined) {
  if (!balance || balance.status !== "ready" || balance.raw === null) return 0n;
  const decimals = BigInt(balance.decimals);
  if (decimals === 18n) return balance.raw;
  if (decimals < 18n) return balance.raw * 10n ** (18n - decimals);
  return balance.raw / 10n ** (decimals - 18n);
}
