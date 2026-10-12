import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { debugWarn } from "../core/debugLogger";
import { getFluentExplorerBaseUrl } from "../core/network";
import {
  fetchFluentTransactionHistoryPage,
  filterFluentTransactionHistory,
  FLUENT_TRANSACTION_HISTORY_PAGE_SIZE,
  groupFluentTransactionHistory,
  sortFluentTransactionHistory,
  type FluentTransactionHistoryCursor,
  type FluentTransactionHistoryPage,
} from "../core/transactionHistory";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import type { FluentDisplayToken } from "@fluent.xyz/connect-sdk";

/**
 * Everything fetched so far, kept ungrouped.
 *
 * Raw rather than grouped because an operation's movements can arrive a page
 * after the operation: grouping the accumulation on every render is what lets a
 * later page complete an earlier row instead of stranding it.
 */
type Accumulated = Pick<FluentTransactionHistoryPage, "movements" | "operations"> & {
  cursor: FluentTransactionHistoryCursor | null;
  /** False until the first page lands, so "empty" and "not asked yet" stay distinct. */
  loaded: boolean;
};

const EMPTY: Accumulated = { movements: [], operations: [], cursor: null, loaded: false };

/**
 * This account's transactions, read from FluentScan a page at a time.
 *
 * `enabled` is how the caller says the history screen is actually open. The
 * wallet menu card mounts the moment an account connects, and three explorer
 * requests per connect for a screen nobody opened is a cost the widget imposes
 * on its host.
 */
export function useFluentTransactionHistory(params: {
  accountAddress?: `0x${string}`;
  /**
   * The Display tokens the wallet menu lists. History is narrowed to these, so
   * the screen answers for the same set of tokens the token list does.
   */
  tokens: readonly Pick<FluentDisplayToken, "identity">[];
  enabled?: boolean;
  /** Bump after a confirmed tx to start the history over, the way balances refetch. */
  revisionCounter?: number;
}) {
  const { accountAddress, tokens, enabled = true, revisionCounter } = params;
  const { network, chain } = useFluentWidgetNetwork();
  const explorerBaseUrl = getFluentExplorerBaseUrl(network);
  const nativeSymbol = chain.nativeCurrency.symbol;
  const nativeDecimals = chain.nativeCurrency.decimals;

  const [accumulated, setAccumulated] = useState<Accumulated>(EMPTY);
  const [visibleCount, setVisibleCount] = useState(FLUENT_TRANSACTION_HISTORY_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One request at a time. Without this the scroll sentinel can fire again
  // while a page is still in flight and fetch the same cursor twice.
  const inFlight = useRef<AbortController | null>(null);

  const source = useMemo(
    () => ({ accountAddress, explorerBaseUrl, chainId: chain.id, nativeSymbol, nativeDecimals }),
    [accountAddress, chain.id, explorerBaseUrl, nativeDecimals, nativeSymbol],
  );

  // Starting over: a different account, network, or a confirmed transaction.
  // Keyed on the source rather than written inside the fetch so the old rows
  // can never be shown under the new address.
  useEffect(() => {
    inFlight.current?.abort();
    // Released here, not left to the aborted request's own `finally`. That runs
    // a microtask later, while the effect below re-runs in this same commit and
    // bails on a guard that is still set — and nothing afterwards changes a
    // dependency of it, so the first page would never be asked for again. The
    // `finally` checks identity before clearing, so it cannot undo this.
    inFlight.current = null;
    setAccumulated(EMPTY);
    setVisibleCount(FLUENT_TRANSACTION_HISTORY_PAGE_SIZE);
    setError(null);
    setBusy(false);
  }, [source, revisionCounter]);

  const fetchPage = useCallback(
    async (cursor: FluentTransactionHistoryCursor | null) => {
      if (!source.accountAddress) return;
      if (!source.explorerBaseUrl) {
        // A network whose explorer is not wired yet: there is nowhere to read
        // history from, and an empty list would claim the account has none.
        setError("Transaction history is not available on this network");
        setAccumulated((current) => ({ ...current, loaded: true }));
        return;
      }
      if (inFlight.current) return;

      const controller = new AbortController();
      inFlight.current = controller;
      setBusy(true);
      setError(null);

      try {
        const page = await fetchFluentTransactionHistoryPage({
          address: source.accountAddress,
          explorerBaseUrl: source.explorerBaseUrl,
          chainId: source.chainId,
          nativeSymbol: source.nativeSymbol,
          nativeDecimals: source.nativeDecimals,
          cursor,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setAccumulated((current) => ({
          movements: [...current.movements, ...page.movements],
          operations: [...current.operations, ...page.operations],
          cursor: page.cursor,
          loaded: true,
        }));
      } catch (cause) {
        if (controller.signal.aborted) return;
        debugWarn("[fluent widget] could not load transaction history", cause);
        // Keep what already loaded: losing five screens of history because the
        // sixth page failed is worse than showing them under an error.
        setAccumulated((current) => ({ ...current, loaded: true }));
        setError("Could not load transaction history");
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [source],
  );

  useEffect(() => () => inFlight.current?.abort(), []);

  const transactions = useMemo(
    () =>
      filterFluentTransactionHistory(
        sortFluentTransactionHistory(
          groupFluentTransactionHistory({
            operations: accumulated.operations,
            movements: accumulated.movements,
          }),
        ),
        tokens,
      ),
    [accumulated.movements, accumulated.operations, tokens],
  );

  // Fetch until the window the reader has asked for is full, or the explorer
  // runs out. One request per page is not enough on its own: filtering to the
  // Display tokens can leave a whole page with nothing to show, and the scroll
  // sentinel would not fire again because it never left the viewport.
  useEffect(() => {
    if (!enabled || busy || error) return;
    if (!accumulated.loaded) {
      fetchPage(null);
      return;
    }
    if (transactions.length < visibleCount && accumulated.cursor) {
      fetchPage(accumulated.cursor);
    }
  }, [
    accumulated.cursor,
    accumulated.loaded,
    busy,
    enabled,
    error,
    fetchPage,
    transactions.length,
    visibleCount,
  ]);

  const visible = useMemo(
    () => transactions.slice(0, visibleCount),
    [transactions, visibleCount],
  );

  // More to show if rows are already held back, or if a source can still be
  // asked for another page. An error stops the scroll from retrying forever.
  const hasMore =
    !error && (visibleCount < transactions.length || (accumulated.loaded && !!accumulated.cursor));

  /**
   * Widen the window. Fetching is left to the effect above, which reacts to a
   * window bigger than the rows on hand — so revealing already-fetched rows
   * costs nothing and only a genuine shortfall reaches the network.
   */
  const loadMore = useCallback(() => {
    if (!hasMore) return;
    setVisibleCount((count) => count + FLUENT_TRANSACTION_HISTORY_PAGE_SIZE);
  }, [hasMore]);

  return {
    transactions: visible,
    /** True only for the first page; later pages keep the list on screen. */
    busy: busy && !accumulated.loaded,
    loadingMore: busy && accumulated.loaded,
    hasMore,
    loadMore,
    error,
  };
}
