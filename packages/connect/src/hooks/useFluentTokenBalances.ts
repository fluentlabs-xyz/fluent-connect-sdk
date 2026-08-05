import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { formatFluentLocaleAmount, getFluentGasPaymentTokens } from "../gasPayment";

const fluentPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(fluentTestnet.rpcUrls.default.http[0]),
});

export const fluentDefaultGasTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.ETH,
];

export function useFluentTokenBalances(params: {
  accountAddress?: `0x${string}`;
  tokens?: readonly FluentTokenDefinition[];
}) {
  const tokens = params.tokens ?? fluentDefaultGasTokens;
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(tokens), [tokens]);
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a Fluent account");

  const refresh = useCallback(async () => {
    if (!params.accountAddress) {
      setBalances([]);
      setStatus("Connect a Fluent account");
      return;
    }

    setBusy(true);
    setStatus("Checking gas token balances");
    try {
      const next = await readFluentTokenBalances({
        client: fluentPublicClient,
        account: params.accountAddress,
        tokens: gasTokens,
      });
      setBalances(next);
      setStatus("Gas route updated");
    } catch {
      setBalances([]);
      setStatus("Could not load balances");
    } finally {
      setBusy(false);
    }
  }, [gasTokens, params.accountAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    balances,
    busy,
    gasTokens,
    refresh,
    status,
  };
}

/** Sum ready balances using USD prices (Coinbase spot / fixed pegs). */
export function sumFluentTokenBalancesUsd(
  balances: readonly FluentTokenBalance[],
  usdPrices: Readonly<Record<string, number>>,
) {
  let sum = 0;
  let hasPriced = false;

  for (const balance of balances) {
    if (balance.status !== "ready" || balance.formatted === null) continue;
    const price = usdPrices[balance.symbol];
    if (price === undefined) continue;
    const amount = Number(balance.formatted);
    if (!Number.isFinite(amount)) continue;
    sum += amount * price;
    hasPriced = true;
  }

  return hasPriced ? sum : null;
}

export function formatFluentPortfolioTotal(total: number) {
  const [wholeRaw, fraction = "00"] = total.toFixed(2).split(".");
  const whole = formatFluentLocaleAmount(Number(wholeRaw), 0);
  return { whole, fraction };
}

export function getFluentPortfolioPnl(params: {
  currentTotal: number | null;
  previousTotal: number | null;
}) {
  const { currentTotal, previousTotal } = params;
  if (currentTotal === null || previousTotal === null) return null;

  const delta = currentTotal - previousTotal;
  const percent =
    previousTotal === 0
      ? currentTotal === 0
        ? 0
        : null
      : (delta / previousTotal) * 100;

  return { delta, percent };
}

export function formatFluentPortfolioPnlAbsolute(delta: number) {
  const { whole, fraction } = formatFluentPortfolioTotal(Math.abs(delta));
  const sign = delta >= 0 ? "+" : "−";
  return `$ ${sign}${whole},${fraction}`;
}

export function formatFluentPortfolioPnlPercent(percent: number) {
  return `${formatFluentLocaleAmount(Math.abs(percent), 2)}%`;
}
