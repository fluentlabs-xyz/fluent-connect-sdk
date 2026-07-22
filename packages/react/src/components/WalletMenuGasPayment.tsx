import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent/connect-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import {
  formatFluentGasTokenBalance,
  getFluentGasPaymentEthValue,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
  selectFluentGasPaymentToken,
} from "../gasPayment";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const fluentPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

const defaultTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.ETH,
];

const tokenMarkClassName: Record<string, string> = {
  ETH: "bg-[#627EEA]/20 text-[#aeb5ff]",
  USDnr: "bg-[#FF8FDA]/20 text-[#ff8fda]",
  BLEND: "bg-[#49EDED]/20 text-[#49eded]",
};

const balanceTierClassName: Record<string, string> = {
  green: "text-[#56f39a]",
  yellow: "text-[#fecd07]",
  red: "text-[#ff8f8f]",
};

export function WalletMenuGasPayment({
  accountAddress,
  bridgeUrl,
  ethValueByToken,
  tokens = defaultTokens,
}: {
  accountAddress?: `0x${string}`;
  bridgeUrl: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  tokens?: readonly FluentTokenDefinition[];
}) {
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(tokens), [tokens]);
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a Fluent account");

  const refresh = useCallback(async () => {
    if (!accountAddress) {
      setBalances([]);
      setStatus("Connect a Fluent account");
      return;
    }

    setBusy(true);
    setStatus("Checking gas token balances");
    const next = await readFluentTokenBalances({
      client: fluentPublicClient,
      account: accountAddress,
      tokens: gasTokens,
    });
    setBalances(next);
    setStatus("Gas route updated");
    setBusy(false);
  }, [accountAddress, gasTokens]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selection = selectFluentGasPaymentToken({ balances, loading: busy });
  const activeSymbol =
    selection.status === "ready"
      ? selection.symbol
      : selection.status === "loading"
        ? "Checking"
        : "Bridge";
  const sortedRows = useMemo(
    () => gasTokens
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
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-medium leading-none">Gas payment</strong>
          <span className="text-[10px] text-muted-foreground">{activeSymbol}</span>
        </div>
      </div>

      <div className="flex flex-col" aria-label="Gas payment priority">
        {sortedRows.map(({ token, balance }) => {
          const symbol = token.symbol as FluentGasPaymentSymbol;
          const value = getFluentGasPaymentEthValue({ balance, ethValueByToken });
          const active = selection.status === "ready" && selection.symbol === symbol;
          return (
            <div
              className={cn(
                "grid grid-cols-[30px_minmax(70px,1fr)_minmax(64px,auto)] items-center gap-2 border-t border-white/10 py-2.5 first:border-t-0",
                active && "opacity-100",
              )}
              key={symbol}
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg text-[11px] font-semibold",
                  tokenMarkClassName[symbol] ?? "bg-white/10 text-white",
                )}
              >
                {symbol.slice(0, 1)}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-sm font-medium leading-none">{symbol}</strong>
                <small className="text-[10px] text-muted-foreground">Balance</small>
              </span>
              <strong
                className={cn(
                  "truncate text-right text-sm font-semibold tabular-nums",
                  balanceTierClassName[value.tier] ?? "text-foreground",
                )}
              >
                {formatGasBalance(balance, accountAddress)}
              </strong>
            </div>
          );
        })}
      </div>

      {selection.status === "bridge-required" ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto justify-start px-0 text-[10px] text-[#49eded]"
          href={bridgeUrl}
          target="_blank"
          rel="noreferrer"
        >
          Bridge assets to Fluent
        </Button>
      ) : (
        <p className="text-[10px] leading-[14px] text-muted-foreground">
          {selection.status === "ready"
            ? `Using ${selection.symbol} for gas when supported.`
            : status}
        </p>
      )}
    </div>
  );
}

function getComparableBalance(balance: FluentTokenBalance | undefined) {
  if (!balance || balance.status !== "ready" || balance.raw === null) return 0n;
  const decimals = BigInt(balance.decimals);
  if (decimals === 18n) return balance.raw;
  if (decimals < 18n) return balance.raw * 10n ** (18n - decimals);
  return balance.raw / 10n ** (decimals - 18n);
}

function formatGasBalance(balance: FluentTokenBalance | undefined, accountAddress: `0x${string}` | undefined) {
  if (balance?.status === "ready") return formatFluentGasTokenBalance(balance) ?? "0";
  if (balance?.status === "not-configured") return "Not configured";
  if (balance?.status === "error") return "Unavailable";
  return accountAddress ? "Loading" : "Connect";
}
