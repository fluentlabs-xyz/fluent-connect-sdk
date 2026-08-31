import {
  getFluentDefaultWidgetGasTokens,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient } from "viem";

import { createFluentRpcTransport } from "../core/rpc";
import { getFluentGasPaymentTokens } from "../core/gasPayment";
import { FLUENT_DECIMAL_SEPARATOR, formatFluentLocaleAmount } from "../utils";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";

export function useFluentTokenBalances(params: {
  accountAddress?: `0x${string}`;
  tokens?: readonly FluentTokenDefinition[];
  /** Increment after a confirmed tx to refetch on-chain balances. */
  revisionCounter?: number;
}) {
  const { network, chain } = useFluentWidgetNetwork();
  const defaultTokens = useMemo(
    () => getFluentDefaultWidgetGasTokens(network),
    [network],
  );
  const tokens = params.tokens ?? defaultTokens;
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain,
        transport: createFluentRpcTransport(chain),
      }),
    [chain],
  );
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(tokens), [tokens]);
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a Fluent account");

  // Guards against stale responses: each run aborts the previous controller, so a
  // late-resolving fetch (e.g. the prior account's slow read) skips its setState
  // and can't overwrite the current account's balances. Note the underlying RPC
  // request is not truly cancelled — neither the SDK nor viem's read actions
  // forward a signal — so this acts as a completion guard, not a network abort.
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;

    if (!params.accountAddress) {
      setBalances([]);
      setStatus("Connect a Fluent account");
      return;
    }

    setBusy(true);
    setStatus("Checking gas token balances");
    try {
      const next = await readFluentTokenBalances({
        client: publicClient,
        account: params.accountAddress,
        tokens: gasTokens,
      });
      if (signal.aborted) return;
      setBalances(next);
      setStatus("Gas route updated");
    } catch {
      if (signal.aborted) return;
      setBalances([]);
      setStatus("Could not load balances");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, [gasTokens, params.accountAddress, publicClient]);

  // Drop the previous account's balances the moment the account changes, so
  // they never flash while the new account's fetch is in flight. Keyed on
  // accountAddress only — a post-tx refetch (revisionCounter) keeps the current
  // balances visible until the fresh data arrives.
  useEffect(() => {
    setBalances([]);
    setStatus(
      params.accountAddress ? "Checking gas token balances" : "Connect a Fluent account",
    );
  }, [params.accountAddress]);

  // Refetch on mount, when `refresh` identity changes, and after each confirmed
  // transaction (host bumps `revisionCounter`).
  useEffect(() => {
    refresh();
    return () => inFlight.current?.abort();
  }, [refresh, params.revisionCounter]);

  return {
    balances,
    busy,
    gasTokens,
    refresh,
    status,
  };
}

/** @deprecated Use `getFluentDefaultWidgetGasTokens(network)` from `@fluent.xyz/connect-sdk`. */
export const fluentDefaultGasTokens = getFluentDefaultWidgetGasTokens("testnet");

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
  return { whole, fraction, separator: FLUENT_DECIMAL_SEPARATOR };
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
  const { whole, fraction, separator } = formatFluentPortfolioTotal(Math.abs(delta));
  const sign = delta >= 0 ? "+" : "−";
  return `$ ${sign}${whole}${separator}${fraction}`;
}

export function formatFluentPortfolioPnlPercent(percent: number) {
  return `${formatFluentLocaleAmount(Math.abs(percent), 2)}%`;
}
