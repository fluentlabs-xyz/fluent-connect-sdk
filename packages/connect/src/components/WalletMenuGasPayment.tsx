import {
  findFluentSymbolCollisions,
  fluentTokenKey,
  isFluentNativeToken,
  type FluentDisplayToken,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatFluentGasTokenBalance,
  formatFluentLocaleAmount,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
} from "../core/gasPayment";
import type { FluentUserTokenAddResult } from "../core/userTokens";
import { copyAddressToClipboard } from "../utils/copyAddress";
import { AddTokenDialog } from "./AddTokenDialog";
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
  tokens,
  selectedSymbol,
  onAddUserToken,
  onRemoveUserToken,
}: {
  accountAddress?: `0x${string}`;
  balances: readonly FluentTokenBalance[];
  busy: boolean;
  usdPrices?: Readonly<Record<string, number>>;
  bridgeUrl: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  /** The display tokens to list. Gas-capable ones get the "Gas" badge. */
  tokens: readonly FluentDisplayToken[];
  selectedSymbol: FluentGasPaymentSymbol;
  onAddUserToken?: (token: FluentTokenDefinition) => FluentUserTokenAddResult;
  onRemoveUserToken?: (token: Pick<FluentTokenDefinition, "chainId" | "address">) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  // The badge has to be keyed on identity, not symbol: a token added by hand
  // could otherwise call itself BLEND and appear to be paying for gas.
  const gasTokenKeys = useMemo(
    () => new Set(getFluentGasPaymentTokens(tokens).map(fluentTokenKey)),
    [tokens],
  );
  const collidingSymbols = useMemo(() => findFluentSymbolCollisions(tokens), [tokens]);
  const existingSymbols = useMemo(
    () => new Set(tokens.map((token) => token.symbol.toLowerCase())),
    [tokens],
  );
  const existingKeys = useMemo(() => new Set(tokens.map(fluentTokenKey)), [tokens]);

  const sortedRows = useMemo(
    () =>
      tokens
        .map((token, index) => ({
          token,
          balance: balances.find((item) => fluentTokenKey(item) === fluentTokenKey(token)),
          index,
        }))
        .sort((left, right) => {
          const leftRaw = getComparableBalance(left.balance);
          const rightRaw = getComparableBalance(right.balance);
          if (leftRaw === rightRaw) return left.index - right.index;
          return rightRaw > leftRaw ? 1 : -1;
        }),
    [balances, tokens],
  );

  return (
    <TooltipProvider delay={200}>
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4" aria-label="Token balances">
        {sortedRows.map(({ token, balance }) => {
          const key = fluentTokenKey(token);
          const symbol = token.symbol;
          const unavailable = balance?.status === "not-configured";
          const failed = balance?.status === "error";
          const iconName = tokenIcons[symbol];
          const active = selectedSymbol === symbol && gasTokenKeys.has(key);
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
              key={key}
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
                  {token.source === "user" && (
                    <span className="rounded-md bg-white/15 px-1.5 leading-[18px] text-[10px] font-normal text-muted-foreground -my-px">
                      Added by you
                    </span>
                  )}
                  {collidingSymbols.has(symbol.toLowerCase()) && (
                    <Tooltip>
                      <TooltipTrigger
                        tabIndex={0}
                        aria-label={`More than one token on this list calls itself ${symbol}`}
                        render={<span className="cursor-default rounded-sm" />}
                      >
                        <AlertTriangle className="size-3.5 text-destructive" />
                      </TooltipTrigger>
                      <TooltipContent>
                        More than one token here calls itself {symbol}. Check the address.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
                {token.address ? (
                  <Select
                    value={null}
                    onValueChange={(value) => {
                      if (value === "copy" && token.address) {
                        void copyAddressToClipboard(token.address);
                      }
                      if (value === "remove" && token.address) {
                        onRemoveUserToken?.({ chainId: token.chainId, address: token.address });
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
                      {token.source === "user" && onRemoveUserToken ? (
                        <SelectItem value="remove">
                          <Trash2 className="size-4" />
                          Remove token
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="shrink-0 text-xs leading-4 text-muted-foreground">
                    {isFluentNativeToken(token) ? "Native" : "No address"}
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

        {onAddUserToken ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl text-left hover:opacity-80"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Plus className="size-4" />
            </span>
            <span className="text-sm font-medium leading-4">Add token</span>
          </button>
        ) : null}
      </div>
    </div>

    {onAddUserToken ? (
      <AddTokenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingSymbols={existingSymbols}
        existingKeys={existingKeys}
        onAdd={onAddUserToken}
      />
    ) : null}
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
