import {
  fluentTokenIdentity,
  getFluentDefaultWidgetDisplayTokens,
  mergeFluentDisplayTokens,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient } from "viem";

import { createFluentRpcTransport } from "../core/rpc";
import { getFluentGasPaymentTokens } from "../core/gasPayment";
import { FLUENT_DECIMAL_SEPARATOR, formatFluentLocaleAmount } from "../utils";
import type { UserTokenStore } from "../core/userTokens";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import { useFluentUserTokens } from "./useFluentUserTokens";

/**
 * How often the wallet menu re-reads balances while it is on screen. A transfer
 * that arrives from outside the widget gives it no signal, so this is the
 * longest such a transfer stays unseen with the menu open.
 */
export const FLUENT_BALANCE_POLL_INTERVAL_MS = 10_000;

export function useFluentTokenBalances(params: {
  accountAddress?: `0x${string}`;
  tokens?: readonly FluentTokenDefinition[];
  /** Incremented after a confirmed transaction to read the balances again. */
  revisionCounter?: number;
  userTokenStore?: UserTokenStore;
  /**
   * Re-read the balances this often, for as long as the hook is mounted and has
   * an account. A scheduled read is quiet: it shows no loading state, keeps the
   * last balances when it fails, and waits its turn behind a read already in
   * flight. Off when omitted.
   */
  pollIntervalMs?: number;
}) {
  const { network, chain } = useFluentWidgetNetwork();
  const defaultTokens = useMemo(() => getFluentDefaultWidgetDisplayTokens(network), [network]);
  const {
    tokens: userTokens,
    add: addUserToken,
    remove: removeUserToken,
  } = useFluentUserTokens({ store: params.userTokenStore });
  const displayTokens = useMemo(
    () =>
      mergeFluentDisplayTokens({
        defaults: defaultTokens,
        integrator: params.tokens,
        user: userTokens,
      }),
    [defaultTokens, params.tokens, userTokens],
  );
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain,
        transport: createFluentRpcTransport(chain),
      }),
    [chain],
  );
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(displayTokens), [displayTokens]);
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a Fluent account");

  // Each run aborts the previous controller, so a late read (the previous account's, say) skips
  // its setState. The RPC request itself is not cancelled: neither the SDK nor viem's read
  // actions take a signal, so this guards completion, not the network.
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (options?: { quiet?: boolean }) => {
      // A quiet read must not take over from a read that is showing a loading
      // state: nothing would clear that state once the first read is abandoned.
      if (options?.quiet && inFlight.current) return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const { signal } = controller;

      if (!params.accountAddress) {
        setBalances([]);
        setStatus("Connect a Fluent account");
        return;
      }

      if (!options?.quiet) {
        setBusy(true);
        setStatus("Checking token balances");
      }
      try {
        const next = await readFluentTokenBalances({
          client: publicClient,
          account: params.accountAddress,
          tokens: displayTokens,
        });
        if (signal.aborted) return;
        setBalances(next);
        setStatus("Balances updated");
      } catch {
        if (signal.aborted) return;
        // A quiet read that fails leaves the last balances up: they are still
        // the best answer, and a blank list would read as an emptied wallet.
        if (options?.quiet) return;
        setBalances([]);
        setStatus("Could not load balances");
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        if (!signal.aborted && !options?.quiet) setBusy(false);
      }
    },
    [displayTokens, params.accountAddress, publicClient],
  );

  // Keyed on the account only, so the previous account's balances do not show during the new
  // account's read, while a read after a transaction (`revisionCounter`) keeps the current ones
  // up until it answers.
  useEffect(() => {
    setBalances([]);
    setStatus(params.accountAddress ? "Checking token balances" : "Connect a Fluent account");
  }, [params.accountAddress]);

  // Reads on mount, when `refresh` changes, and after each confirmed transaction (the caller
  // bumps `revisionCounter`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: revisionCounter is the caller's request for a new read, not a value the read uses
  useEffect(() => {
    refresh();
    return () => inFlight.current?.abort();
  }, [refresh, params.revisionCounter]);

  // The schedule follows `refresh`: a new account or token set restarts it, and
  // the effect above has already abandoned any read the old one left in flight.
  // A tab nobody is looking at is left alone.
  const { pollIntervalMs } = params;
  useEffect(() => {
    if (!pollIntervalMs || !params.accountAddress) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh({ quiet: true });
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollIntervalMs, params.accountAddress, refresh]);

  return {
    /** Balances for every Display token, in display order. */
    balances,
    busy,
    /** The Display tokens the balances correspond to. */
    displayTokens,
    /** The Gas tokens among them, lowest `gasPriority` first. */
    gasTokens,
    refresh,
    status,
    addUserToken,
    removeUserToken,
  };
}

/** Returns the USD value of the ready balances that have a price, or `null` when none has. */
export function sumFluentTokenBalancesUsd(
  balances: readonly FluentTokenBalance[],
  usdPrices: Readonly<Record<string, number>>,
) {
  let sum = 0;
  let hasPriced = false;

  for (const balance of balances) {
    if (balance.status !== "ready" || balance.formatted === null) continue;
    const price = usdPrices[fluentTokenIdentity(balance)];
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
    previousTotal === 0 ? (currentTotal === 0 ? 0 : null) : (delta / previousTotal) * 100;

  return { delta, percent };
}

export function formatFluentPortfolioPnlAbsolute(delta: number) {
  const { whole, fraction, separator } = formatFluentPortfolioTotal(Math.abs(delta));
  const sign = delta >= 0 ? "+" : "−";
  return `$ ${sign}${whole}${separator}${fraction}`;
}

export function formatFluentPortfolioPnlPercent(percent: number) {
  const sign = percent >= 0 ? "+" : "−";
  return `${sign}${formatFluentLocaleAmount(Math.abs(percent), 2)}%`;
}
