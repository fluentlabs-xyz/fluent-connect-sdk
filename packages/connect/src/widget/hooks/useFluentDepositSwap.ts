import { useCallback, useEffect, useRef, useState } from "react";
import type { Hash } from "viem";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import { debugError } from "../../core/debugLogger";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { buildFluentSwapCalls, FLUENT_SWAP_OP_ID } from "../../swap/calls";
import { getFluentSwapContracts } from "../../swap/contracts";
import type { FluentSwapQuote } from "../../swap/quote";
import type { FluentBatchApi } from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";

/** The two sides of the swap leg, kept so a status can be drawn without its quote. */
export type FluentDepositSwapLeg = {
  /** What the deposit delivered on Fluent, and what the swap sells. */
  from: { symbol: string; decimals: number; amount: bigint };
  /** What the swap buys, at the price the quote stood at when it was sent. */
  to: { symbol: string; decimals: number; amount: bigint };
};

export type FluentDepositSwapState =
  | { phase: "idle" }
  | { phase: "swapping"; leg: FluentDepositSwapLeg }
  | { phase: "settled"; leg: FluentDepositSwapLeg; hash: Hash }
  /**
   * The review was dismissed, so nothing was sent — but the deposit is on the
   * Fluent ID and the swap is still what the person asked for, so the leg is
   * kept and can be confirmed again.
   */
  | { phase: "declined"; leg: FluentDepositSwapLeg }
  /** The deposit is on the Fluent ID; only the swap did not go through. */
  | { phase: "error"; leg: FluentDepositSwapLeg; message: string };

export type FluentDepositSwap = {
  state: FluentDepositSwapState;
  /**
   * Whether a Two-step deposit can be offered at all: Fluent has a swap
   * deployment on this network, and the Widget account is a Fluent ID that can
   * execute. An External wallet cannot do this leg — the deposit is credited to
   * the Fluent ID, so the Fluent ID is the only account holding what the swap
   * would sell.
   */
  available: boolean;
  /** Sends the swap leg for `quote`, crediting the Fluent ID that holds the input. */
  run: (quote: FluentSwapQuote) => Promise<void>;
  reset: () => void;
};

/**
 * The swap leg of a Two-step deposit: once the bridge has credited the Fluent
 * ID, this turns what landed into the token the person asked for, on Fluent.
 *
 * Held above the drawer rather than inside the Bridge page, because the review
 * this operation opens *is* a page of the drawer: it replaces the Bridge page
 * on its way in, which unmounts the form, and a phase kept down there would
 * come back `idle` with the swap still in flight. The Bridge page reads the
 * state back and redraws the stepper from it.
 */
export function useFluentDepositSwap({
  widget,
  network,
  gasSymbol,
  track,
  refreshBalances,
}: {
  widget: FluentBatchApi;
  network: FluentWidgetNetwork;
  /** The Gas token from User settings, as it stands at the press. */
  gasSymbol: FluentGasTokenSymbol;
  track: FluentAnalyticsTrack;
  /** Called once the swap has settled, so the token list stops showing the old figures. */
  refreshBalances: () => void;
}): FluentDepositSwap {
  const [state, setState] = useState<FluentDepositSwapState>({ phase: "idle" });
  // Guards the second of two presses. A phase is a state update, and the press
  // that follows it in the same tick has not seen it yet; a ref is written and
  // read within the tick, so exactly one operation is ever created.
  const inFlight = useRef(false);
  const contracts = getFluentSwapContracts(network);
  const { address, connected, type } = widget.account;
  // Read after an await to tell whether the Fluent ID is still the one this
  // swap was started for.
  const currentAddress = useRef(address);
  currentAddress.current = address;

  // A new Fluent ID inherits nothing: the previous one's swap says nothing
  // about this account's money.
  useEffect(() => {
    setState({ phase: "idle" });
  }, [address]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  const run = useCallback(
    async (quote: FluentSwapQuote) => {
      if (!contracts || !address || inFlight.current) return;
      inFlight.current = true;
      const subject = address;
      const leg: FluentDepositSwapLeg = {
        from: {
          symbol: quote.tokenIn.symbol,
          decimals: quote.tokenIn.decimals,
          amount: quote.amountIn,
        },
        to: {
          symbol: quote.tokenOut.symbol,
          decimals: quote.tokenOut.decimals,
          amount: quote.amountOut,
        },
      };
      setState({ phase: "swapping", leg });

      try {
        const { calls } = buildFluentSwapCalls({ quote, contracts, recipient: subject });
        const operation = widget.createBatchOp({
          id: FLUENT_SWAP_OP_ID,
          reviewTitle: `Swap to ${quote.tokenOut.symbol}`,
          calls,
        });
        // Always explicit, never left to the executor's default: this operation
        // is the person's own, so the token they chose in User settings is the
        // answer whichever one it is.
        const { hash } = await operation.execute({ gasPayment: { symbol: gasSymbol } });
        if (currentAddress.current !== subject) return;
        setState({ phase: "settled", leg, hash });
        refreshBalances();
        track("bridge_deposit_swapped", {
          from_symbol: leg.from.symbol,
          to_symbol: leg.to.symbol,
          gas_symbol: gasSymbol,
        });
      } catch (error) {
        if (currentAddress.current !== subject) return;
        if (error instanceof FluentReviewRejectedError) {
          // A refused review is a decision, not a failure, and nothing was
          // sent. The page keeps offering the swap rather than dropping back to
          // an empty form: the money the swap was for has already landed.
          setState({ phase: "declined", leg });
          track("bridge_deposit_swap_failed", { reason: "rejected" });
          return;
        }
        debugError("[FluentBridge] deposit swap failed", error);
        setState({
          phase: "error",
          leg,
          message: error instanceof Error ? error.message : "The swap was not sent.",
        });
        track("bridge_deposit_swap_failed", { reason: "execution_failed" });
      } finally {
        inFlight.current = false;
      }
    },
    [address, contracts, gasSymbol, refreshBalances, track, widget],
  );

  return {
    state,
    available: Boolean(contracts) && connected && type === "smart",
    run,
    reset,
  };
}
