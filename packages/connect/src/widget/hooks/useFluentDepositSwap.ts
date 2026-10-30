import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaseError, createPublicClient, type Address, type Hash, type PublicClient } from "viem";
import { WaitForUserOperationReceiptTimeoutError } from "viem/account-abstraction";

import { checkDepositArrival, readFluentTokenBalance } from "../../bridge/depositArrival";
import { getFluentBridgeRoute } from "../../bridge/route";
import type { FluentAnalyticsTrack } from "../../core/analytics";
import { resolveLocalStorage } from "../../core/browserStorage";
import { debugError } from "../../core/debugLogger";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { createFluentRpcTransport } from "../../core/rpc";
import { buildFluentSwapCalls, FLUENT_SWAP_OP_ID } from "../../swap/calls";
import { getFluentSwapContracts } from "../../swap/contracts";
import { FluentSwapError, getFluentSwapQuote, type FluentSwapQuote } from "../../swap/quote";
import {
  findFluentSwapToken,
  getFluentSwapInputAmount,
  type FluentSwapToken,
} from "../../swap/tokens";
import type { FluentBatchApi } from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import {
  readStoredTwoStepDeposit,
  twoStepDepositStorageKey,
  writeStoredTwoStepDeposit,
} from "./twoStepDepositStorage";

/** How often a Deposit still on its way is read again. */
export const FLUENT_DEPOSIT_ARRIVAL_POLL_MS = 5_000;
/** After this long on its way a Deposit is called slow, and the Portal is offered. */
export const FLUENT_DEPOSIT_SLOW_AFTER_MS = 120_000;

/** A token named well enough to draw an amount of it. */
export type FluentDepositSwapToken = { symbol: string; decimals: number };

/** The bridge leg of a Two-step deposit, from its signature until it lands. */
export type FluentDepositSwapBridge = {
  /** The deposit transaction on the source chain. */
  sentHash: Hash;
  /** The External wallet that signed it. */
  sender: Address;
  /** The Delivered token, which the swap sells. */
  from: FluentDepositSwapToken;
  /** The token the person asked to end up with. */
  to: FluentDepositSwapToken;
  /** What the deposit should deliver, in the Delivered token's smallest unit. */
  expected: bigint;
  /**
   * The Fluent ID's balance of the Delivered token before the deposit could land.
   * Absent until the first read after the signature comes back.
   */
  baseline?: bigint;
  /** When the deposit was signed, in epoch milliseconds. */
  startedAt: number;
};

/** The two sides of the swap leg, kept so a status can be drawn without its quote. */
export type FluentDepositSwapLeg = {
  /** What the swap sells: the part of what landed that is not kept back for gas. */
  from: FluentDepositSwapToken & { amount: bigint };
  /** What the swap buys, at the price the quote stood at when it was sent. Absent before. */
  to: FluentDepositSwapToken & { amount?: bigint };
  /**
   * The deposit that brought the input, carried over from `bridging`. Absent on a leg stored
   * by an SDK that did not keep it.
   */
  deposit?: { sentHash: Hash; startedAt: number };
};

export type FluentDepositSwapState =
  | { phase: "idle" }
  /** The deposit is signed and on its way to the Fluent ID. */
  | { phase: "bridging"; deposit: FluentDepositSwapBridge }
  /** The deposit itself failed, so there is nothing to swap. */
  | { phase: "bridge_failed"; deposit: FluentDepositSwapBridge; message: string }
  /**
   * The deposit landed and the swap is being priced, to be sent straight after
   * without a press. Stays here only when too little landed to swap.
   */
  | { phase: "ready"; leg: FluentDepositSwapLeg }
  | { phase: "swapping"; leg: FluentDepositSwapLeg }
  | {
      phase: "settled";
      leg: FluentDepositSwapLeg;
      hash: Hash;
      /** The swap's user operation, when the executor reported one. */
      userOpHash?: Hash;
    }
  /**
   * The review was dismissed, so nothing was sent — but the deposit is on the
   * Fluent ID and the swap is still what the person asked for, so the leg is
   * kept and can be confirmed again.
   */
  | { phase: "declined"; leg: FluentDepositSwapLeg }
  /** The swap was not sent, or was sent and reverted: trying again is safe. */
  | { phase: "error"; leg: FluentDepositSwapLeg; message: string }
  /**
   * The swap may have been sent and its outcome is not known, so it is not
   * offered again: a second one could sell the same token twice.
   */
  | { phase: "unconfirmed"; leg: FluentDepositSwapLeg; message: string };

export type FluentDepositSwap = {
  state: FluentDepositSwapState;
  /** The deposit has been on its way for longer than usual. Only ever true while `bridging`. */
  slow: boolean;
  /**
   * Whether a Two-step deposit can be offered at all: Fluent has a swap
   * deployment on this network, and the Widget account is a Fluent ID that can
   * execute. An External wallet cannot do this leg — the deposit is credited to
   * the Fluent ID, so the Fluent ID is the only account holding what the swap
   * would sell.
   */
  available: boolean;
  /**
   * Takes over a deposit the moment it is signed, so it is followed above the
   * drawer and across reloads rather than by the Bridge page. Returns `false`,
   * and takes nothing over, when `recipient` is not the current Fluent ID.
   */
  begin: (deposit: {
    sentHash: Hash;
    sender: Address;
    recipient: Address;
    from: FluentSwapToken;
    to: FluentSwapToken;
    expected: bigint;
  }) => boolean;
  /** Sends the swap leg for `quote`, crediting the Fluent ID that holds the input. */
  run: (quote: FluentSwapQuote) => Promise<void>;
  reset: () => void;
};

/** The phases in which the swap can be sent: on landing, or again from the Bridge page. */
function canRun(state: FluentDepositSwapState): boolean {
  return state.phase === "ready" || state.phase === "declined" || state.phase === "error";
}

function isInclusionTimeout(error: unknown): boolean {
  if (error instanceof WaitForUserOperationReceiptTimeoutError) return true;
  return (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof WaitForUserOperationReceiptTimeoutError) !== null
  );
}

/**
 * A Two-step deposit from the moment its bridge leg is signed: it follows the
 * deposit until it lands on the Fluent ID, then sends the swap that turns what
 * landed into the token the person asked for.
 *
 * Held above the drawer rather than inside the Bridge page, because the Bridge
 * page is unmounted by every other tab, and by the review the swap opens. The
 * state is also kept in `localStorage` per network and Fluent ID, so a reload
 * comes back to the same step rather than to an empty form.
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
  const contracts = getFluentSwapContracts(network);
  const route = useMemo(() => getFluentBridgeRoute(network), [network]);
  const clients = useMemo(() => {
    if (!route) return undefined;
    const client = (chain: typeof route.source) =>
      createPublicClient({ chain, transport: createFluentRpcTransport(chain) }) as PublicClient;
    return { source: client(route.source), destination: client(route.destination) };
  }, [route]);
  const storage = useMemo(() => resolveLocalStorage(), []);

  const { address, connected, type } = widget.account;
  // The subject is the Fluent ID on this network; everything below is kept per subject.
  const subjectKey = address ? twoStepDepositStorageKey(network, address) : undefined;
  const subjectRef = useRef(subjectKey);
  subjectRef.current = subjectKey;

  // Read on the first render too, so a reload does not flash the empty form first.
  const [state, setState] = useState<FluentDepositSwapState>(() =>
    subjectKey ? readStoredTwoStepDeposit(storage, subjectKey) : { phase: "idle" },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // A new Fluent ID inherits nothing from the previous one, and picks up its own
  // deposit where it was left.
  useEffect(() => {
    setState(subjectKey ? readStoredTwoStepDeposit(storage, subjectKey) : { phase: "idle" });
  }, [storage, subjectKey]);

  /**
   * Applies `next` only while `key` is still the current subject, and keeps it
   * in storage. Returns whether it was applied.
   */
  const commit = useCallback(
    (key: string | undefined, next: FluentDepositSwapState): boolean => {
      if (!key || subjectRef.current !== key) return false;
      stateRef.current = next;
      setState(next);
      writeStoredTwoStepDeposit(storage, key, next);
      return true;
    },
    [storage],
  );

  // Guards the second of two presses. A phase is a state update, and the press
  // that follows it in the same tick has not seen it yet; a ref is written and
  // read within the tick, so exactly one operation is ever created.
  const inFlight = useRef(false);

  const begin = useCallback<FluentDepositSwap["begin"]>(
    ({ sentHash, sender, recipient, from, to, expected }) => {
      if (!address || recipient.toLowerCase() !== address.toLowerCase()) return false;
      return commit(subjectKey, {
        phase: "bridging",
        deposit: {
          sentHash,
          sender,
          from: { symbol: from.symbol, decimals: from.decimals },
          to: { symbol: to.symbol, decimals: to.decimals },
          expected,
          startedAt: Date.now(),
        },
      });
    },
    [address, commit, subjectKey],
  );

  const bridging = state.phase === "bridging" ? state.deposit : undefined;

  useEffect(() => {
    if (!bridging || !route || !clients || !address || !subjectKey) return;
    const token = findFluentSwapToken(network, bridging.from.symbol);
    if (!token) return;

    let active = true;
    let reading = false;
    const controller = new AbortController();

    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        if (bridging.baseline === undefined) {
          const baseline = await readFluentTokenBalance(
            clients.destination,
            token,
            address,
          ).catch(() => undefined);
          // Committing the baseline restarts this effect, which reads the arrival.
          if (active && baseline !== undefined) {
            commit(subjectKey, { phase: "bridging", deposit: { ...bridging, baseline } });
          }
          return;
        }
        const arrival = await checkDepositArrival({
          sourceClient: clients.source,
          destinationClient: clients.destination,
          indexerUrl: route.indexerUrl,
          sentHash: bridging.sentHash,
          sender: bridging.sender,
          recipient: address,
          token,
          baseline: bridging.baseline,
          signal: controller.signal,
        });
        if (!active) return;
        if (arrival.status === "failed") {
          const { message } = arrival;
          commit(subjectKey, { phase: "bridge_failed", deposit: bridging, message });
          track("bridge_deposit_swap_failed", { reason: "bridge_failed" });
        } else if (arrival.status === "landed") {
          // What landed, but never more than this deposit was to deliver: a rise
          // past that is someone else's money arriving at the same time, and the
          // swap must not sell it.
          const landed =
            arrival.received < bridging.expected ? arrival.received : bridging.expected;
          commit(subjectKey, {
            phase: "ready",
            leg: {
              from: { ...bridging.from, amount: getFluentSwapInputAmount(landed, token) ?? 0n },
              to: bridging.to,
              deposit: { sentHash: bridging.sentHash, startedAt: bridging.startedAt },
            },
          });
        }
      } finally {
        reading = false;
      }
    };

    const timer = setInterval(() => void poll(), FLUENT_DEPOSIT_ARRIVAL_POLL_MS);
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [address, bridging, clients, commit, network, route, subjectKey, track]);

  const [slow, setSlow] = useState(false);
  const bridgingSince = bridging?.startedAt;
  useEffect(() => {
    if (bridgingSince === undefined) {
      setSlow(false);
      return;
    }
    const left = bridgingSince + FLUENT_DEPOSIT_SLOW_AFTER_MS - Date.now();
    setSlow(left <= 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setSlow(true), left);
    return () => clearTimeout(timer);
  }, [bridgingSince]);

  const reset = useCallback(() => {
    commit(subjectRef.current, { phase: "idle" });
  }, [commit]);

  const run = useCallback(
    async (quote: FluentSwapQuote) => {
      if (!contracts || !clients || !address || inFlight.current) return;
      const current = stateRef.current;
      if (!canRun(current)) return;
      inFlight.current = true;
      const key = subjectKey;
      const leg: FluentDepositSwapLeg = {
        deposit: "leg" in current ? current.leg.deposit : undefined,
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
      commit(key, { phase: "swapping", leg });

      try {
        // A Fluent ID that no longer holds what the swap sells has either swapped
        // it already, through a send whose outcome never came back, or moved it.
        // Either way another swap would sell other money, so none is sent. A read
        // that fails decides nothing: the swap reverts on its own if the money is gone.
        const held = await readFluentTokenBalance(
          clients.destination,
          quote.tokenIn,
          address,
        ).catch(() => undefined);
        if (subjectRef.current !== key) return;
        if (held !== undefined && held < quote.amountIn) {
          commit(key, {
            phase: "unconfirmed",
            leg,
            message:
              `Your Fluent account holds less ${leg.from.symbol} than this swap sells. ` +
              "It may have been swapped already, so check Activity before swapping again.",
          });
          track("bridge_deposit_swap_failed", { reason: "insufficient_input" });
          return;
        }

        const { calls } = buildFluentSwapCalls({ quote, contracts, recipient: address });
        const operation = widget.createBatchOp({
          id: FLUENT_SWAP_OP_ID,
          reviewTitle: `Swap to ${quote.tokenOut.symbol}`,
          calls,
        });
        // Always explicit, never left to the executor's default: this operation
        // is the person's own, so the token they chose in User settings is the
        // answer whichever one it is.
        const { hash, userOpHash } = await operation.execute({
          gasPayment: { symbol: gasSymbol },
        });
        if (!commit(key, { phase: "settled", leg, hash, userOpHash })) return;
        refreshBalances();
        track("bridge_deposit_swapped", {
          from_symbol: leg.from.symbol,
          to_symbol: leg.to.symbol,
          gas_symbol: gasSymbol,
        });
      } catch (error) {
        if (subjectRef.current !== key) return;
        if (error instanceof FluentReviewRejectedError) {
          // A refused review is a decision, not a failure, and nothing was
          // sent. The page keeps offering the swap rather than dropping back to
          // an empty form: the money the swap was for has already landed.
          commit(key, { phase: "declined", leg });
          track("bridge_deposit_swap_failed", { reason: "rejected" });
          return;
        }
        debugError("[FluentBridge] deposit swap failed", error);
        if (isInclusionTimeout(error)) {
          // The bundler took the operation and no receipt came back in time: it
          // may still land, so it is not offered again.
          commit(key, {
            phase: "unconfirmed",
            leg,
            message:
              "The swap was sent, but no confirmation came back in time. " +
              "Check Activity before swapping again.",
          });
          track("bridge_deposit_swap_failed", { reason: "unconfirmed" });
          return;
        }
        commit(key, {
          phase: "error",
          leg,
          message: error instanceof Error ? error.message : "The swap was not sent.",
        });
        track("bridge_deposit_swap_failed", { reason: "execution_failed" });
      } finally {
        inFlight.current = false;
      }
    },
    [
      address,
      clients,
      commit,
      contracts,
      gasSymbol,
      refreshBalances,
      subjectKey,
      track,
      widget,
    ],
  );

  // The deposit landing is the go-ahead: the person picked the token to end up
  // with before signing the bridge, so the swap is priced and sent without a
  // second press. It still goes through the widget's confirmation — with Quick
  // sign off the review opens by itself — and a dismissed review or a failure
  // leaves `declined` or `error`, which only the Bridge page sends again.
  const runRef = useRef(run);
  runRef.current = run;
  const readyLeg = state.phase === "ready" ? state.leg : undefined;
  useEffect(() => {
    if (!readyLeg || readyLeg.from.amount === 0n) return;
    if (!contracts || !clients || !subjectKey) return;
    const tokenIn = findFluentSwapToken(network, readyLeg.from.symbol);
    const tokenOut = findFluentSwapToken(network, readyLeg.to.symbol);
    if (!tokenIn || !tokenOut) return;
    const key = subjectKey;
    let active = true;

    void (async () => {
      let quote: FluentSwapQuote;
      try {
        quote = await getFluentSwapQuote({
          client: clients.destination,
          network,
          contracts,
          tokenIn,
          tokenOut,
          amountIn: readyLeg.from.amount,
        });
      } catch (error) {
        if (!active || subjectRef.current !== key) return;
        debugError("[FluentBridge] deposit swap could not be priced", error);
        commit(key, {
          phase: "error",
          leg: readyLeg,
          message:
            error instanceof FluentSwapError && error.code === "no_route"
              ? `There is no ${tokenIn.symbol} to ${tokenOut.symbol} pool on Fluent right now.`
              : "The swap could not be priced.",
        });
        track("bridge_deposit_swap_failed", { reason: "unpriced" });
        return;
      }
      if (!active || subjectRef.current !== key) return;
      await runRef.current(quote);
    })();

    return () => {
      active = false;
    };
  }, [clients, commit, contracts, network, readyLeg, subjectKey, track]);

  return {
    state,
    slow: state.phase === "bridging" && slow,
    available: Boolean(contracts && route) && connected && type === "smart",
    begin,
    run,
    reset,
  };
}
