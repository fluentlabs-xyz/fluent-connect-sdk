import { formatAmount } from "../components/AmountForm";
import type { FluentDepositSwapState } from "../widget/hooks/useFluentDepositSwap";
import type { FluentBridgeRoute } from "./route";

/** A Two-step deposit the bridge leg has handed over: every phase but `idle`. */
export type DepositSwapInFlight = Exclude<FluentDepositSwapState, { phase: "idle" }>;

/** What the Two-step deposit's screen says, as heading and line beneath it. */
export function depositSwapCopy(
  state: DepositSwapInFlight,
  slow: boolean,
  route: FluentBridgeRoute,
): { heading: string; detail: string } {
  switch (state.phase) {
    case "bridging":
      return {
        heading: "Funds on the way",
        detail: slow
          ? "Your deposit went through, but the funds are taking longer than usual to arrive. " +
            "The swap is offered as soon as they land."
          : `Your ${state.deposit.from.symbol} is on its way to ${route.destination.name} — ` +
            "this usually takes a few minutes.",
      };
    case "bridge_failed":
      return { heading: "The deposit did not land", detail: state.message };
    case "ready":
      return state.leg.from.amount === 0n
        ? {
            heading: `${state.leg.from.symbol} landed on Fluent`,
            detail:
              "Too little landed to swap: the gas reserve kept back on Fluent would take all of " +
              `it. Your ${state.leg.from.symbol} stays on your Fluent account.`,
          }
        : {
            heading: `Swapping ${state.leg.from.symbol} to ${state.leg.to.symbol}`,
            detail:
              `${formatAmount(state.leg.from.amount, state.leg.from.decimals)} ` +
              `${state.leg.from.symbol} landed on your Fluent account. Getting the swap's price…`,
          };
    case "swapping":
      return {
        heading: `Swapping ${state.leg.from.symbol} to ${state.leg.to.symbol}`,
        detail: "Your Fluent account is swapping; the new balance appears once it is mined.",
      };
    case "settled":
      return {
        heading: "Success",
        detail:
          state.leg.to.amount === undefined
            ? `Your ${state.leg.to.symbol} is on Fluent.`
            : `${formatAmount(state.leg.to.amount, state.leg.to.decimals)} ` +
              `${state.leg.to.symbol} is on Fluent.`,
      };
    // Neither of the ways the swap can stop puts the deposit at risk, and the
    // copy must not suggest it does: the deposit landed, and only the swap after
    // it did not happen.
    case "declined":
      return {
        heading: "The swap is still waiting",
        detail: `Your ${state.leg.from.symbol} is on Fluent, unswapped. Confirm to trade it.`,
      };
    case "error":
      return {
        heading: "The swap did not go through",
        detail:
          `Your ${state.leg.from.symbol} is on Fluent — only the swap failed. ` + state.message,
      };
    case "unconfirmed":
      return { heading: "The swap's outcome is not known yet", detail: state.message };
  }
}
