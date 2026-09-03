import {
  findFluentSymbolCollisions,
  fluentTokenIdentity,
  isFluentDefaultToken,
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
  type FluentGasTokenSymbol,
  getFluentGasPaymentTokens,
} from "../core/gasPayment";
import type { FluentUserTokenAddResult } from "../core/userTokens";
import { copyAddressToClipboard } from "../utils/copyAddress";
import { AddTokenForm } from "./AddTokenForm";
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

/**
 * How each token Fluent ships is drawn: which glyph, how big, and what tile
 * sits behind it. Looked up by symbol, but only ever for a token that passed
 * `isFluentDefaultToken` first — the symbol comes off a contract, so without
 * that gate anything calling itself BLEND would inherit BLEND's icon and look
 * official.
 */
const VISUAL_BY_DEFAULT_SYMBOL: Record<
  string,
  { icon: IconName; iconClassName: string; bgClassName: string }
> = {
  // ETH/USDnr glyphs sit on fixed brand-colored tiles, so they stay white
  // regardless of the host's foreground override.
  ETH: { icon: "eth", iconClassName: "size-6 text-white", bgClassName: "bg-[#627EEA]" },
  USDnr: { icon: "usdnr", iconClassName: "size-6 text-white", bgClassName: "bg-[#7f52d0]" },
  BLEND: { icon: "fluent", iconClassName: "size-4", bgClassName: "bg-[#FFFFFF]/10" },
};

export function WalletMenuTokenList({
  accountAddress,
  balances,
  busy,
  usdPrices = {},
  tokens,
  selectedSymbol,
  onAddUserToken,
  onRemoveUserToken,
}: {
  accountAddress?: `0x${string}`;
  balances: readonly FluentTokenBalance[];
  busy: boolean;
  usdPrices?: Readonly<Record<string, number>>;
  /** The display tokens to list. Gas-capable ones get the "Gas" badge. */
  tokens: readonly FluentDisplayToken[];
  selectedSymbol: FluentGasTokenSymbol;
  onAddUserToken?: (token: FluentTokenDefinition) => FluentUserTokenAddResult;
  onRemoveUserToken?: (token: Pick<FluentTokenDefinition, "chainId" | "address">) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  // The badge has to be keyed on identity, not symbol: a token added by hand
  // could otherwise call itself BLEND and appear to be paying for gas.
  const gasTokenIdentities = useMemo(
    () => new Set(getFluentGasPaymentTokens(tokens).map((token) => token.identity)),
    [tokens],
  );
  const collidingSymbols = useMemo(() => findFluentSymbolCollisions(tokens), [tokens]);
  const existingSymbols = useMemo(
    () => new Set(tokens.map((token) => token.symbol.toLowerCase())),
    [tokens],
  );
  const listedIdentities = useMemo(() => new Set(tokens.map((token) => token.identity)), [tokens]);

  // Indexed once rather than a `find` per row: the list is defaults plus
  // integrator tokens plus up to FLUENT_USER_TOKEN_LIMIT user tokens, so the
  // pairwise form was quadratic in a render path.
  const balanceByIdentity = useMemo(
    () => new Map(balances.map((balance) => [fluentTokenIdentity(balance), balance])),
    [balances],
  );

  const sortedRows = useMemo(
    () =>
      tokens
        .map((token, index) => {
          const balance = balanceByIdentity.get(token.identity);
          return { token, balance, index, comparable: getComparableBalance(balance) };
        })
        .sort((left, right) => {
          if (left.comparable === right.comparable) return left.index - right.index;
          return right.comparable > left.comparable ? 1 : -1;
        }),
    [balanceByIdentity, tokens],
  );

  return (
    <TooltipProvider delay={200}>
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4" aria-label="Token balances">
        {sortedRows.map(({ token, balance }) => {
          const identity = token.identity;
          const symbol = token.symbol;
          const unavailable = balance?.status === "not-configured";
          const failed = balance?.status === "error";
          const visual = isFluentDefaultToken(token)
            ? VISUAL_BY_DEFAULT_SYMBOL[token.symbol]
            : undefined;
          const active = selectedSymbol === symbol && gasTokenIdentities.has(identity);
          const formatted =
            balance?.status === "ready"
              ? formatFluentGasTokenBalance(balance, 0) ??
                (balance.formatted ? formatFluentLocaleAmount(balance.formatted, 0) : null)
              : null;
          const usdValueLabel = formatTokenUsdValue(balance, usdPrices[identity]);
          const exactBalance =
            balance?.status === "ready" && balance.formatted?.includes(".")
              ? balance.formatted
              : null;

          return (
            <div
              className="flex w-full items-center gap-3 rounded-xl"
              key={identity}
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg ${visual?.bgClassName ?? "bg-foreground/10"}`}
              >
                {visual ? (
                  <Icon name={visual.icon} className={visual.iconClassName} />
                ) : token.logoURI ? (
                  // Rendered as an <img>, never inlined: a logo URL is data from
                  // an integrator or a stranger's contract, and inlining SVG
                  // from either would execute their markup in the widget.
                  <img
                    src={token.logoURI}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    className="size-10 object-contain"
                  />
                ) : (
                  <span className="text-xs font-medium">{symbol.slice(0, 1)}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium leading-4">
                  {symbol}
                  {active && (
                    <span className="rounded-md bg-foreground/15 px-1.5 leading-[18px] text-[10px] font-normal text-muted-foreground -my-px">
                      Gas
                    </span>
                  )}
                  {token.source === "user" && (
                    <span className="rounded-md bg-foreground/15 px-1.5 leading-[18px] text-[10px] font-normal text-muted-foreground -my-px">
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

        {onAddUserToken && !addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl text-left hover:opacity-80"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground/10">
              <Plus className="size-4" />
            </span>
            <span className="text-sm font-medium leading-4">Add token</span>
          </button>
        ) : null}

        {onAddUserToken && addOpen ? (
          <AddTokenForm
            existingSymbols={existingSymbols}
            listedIdentities={listedIdentities}
            onAdd={onAddUserToken}
            onClose={() => setAddOpen(false)}
          />
        ) : null}
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
        className="inline-block h-4 w-16 animate-pulse rounded-md bg-foreground/10"
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
