import type { StorageLike } from "@fluent.xyz/connect-sdk";

import { readStoredValue, removeStoredValue, writeStoredValue } from "../../core/browserStorage";
import type { FluentWidgetNetwork } from "../../core/network";
import type { FluentDepositSwapState } from "./useFluentDepositSwap";

const KEY_PREFIX = "fluent-connect:two-step-deposit:v1";

const STORED_PHASES = new Set<FluentDepositSwapState["phase"]>([
  "bridging",
  "bridge_failed",
  "ready",
  "swapping",
  "declined",
  "error",
  "unconfirmed",
]);

/** One Two-step deposit is kept per network and Fluent ID. */
export function twoStepDepositStorageKey(network: FluentWidgetNetwork, fluentId: string): string {
  return `${KEY_PREFIX}:${network}:${fluentId.toLowerCase()}`;
}

/** Bigints do not survive `JSON.stringify`, so they are written as tagged strings. */
function encode(state: FluentDepositSwapState): string {
  return JSON.stringify(state, (_key, value: unknown) =>
    typeof value === "bigint" ? { $bigint: value.toString() } : value,
  );
}

function decode(raw: string): unknown {
  return JSON.parse(raw, (_key, value: unknown) =>
    value && typeof value === "object" && "$bigint" in value
      ? BigInt((value as { $bigint: string }).$bigint)
      : value,
  );
}

/**
 * The Two-step deposit stored under `key`, or `idle` when there is none this SDK
 * can read.
 *
 * A swap stored as `swapping` belonged to a page that is gone, and whether its
 * operation went out is not known, so it comes back `unconfirmed` and is not
 * offered again.
 */
export function readStoredTwoStepDeposit(
  storage: StorageLike | null,
  key: string,
): FluentDepositSwapState {
  const raw = readStoredValue(storage, key);
  if (!raw) return { phase: "idle" };
  try {
    const state = decode(raw) as FluentDepositSwapState;
    if (!state || !STORED_PHASES.has(state.phase)) return { phase: "idle" };
    if (state.phase === "swapping") {
      return {
        phase: "unconfirmed",
        leg: state.leg,
        message:
          "The page was closed while the swap was out. Check Activity before swapping again.",
      };
    }
    return state;
  } catch {
    return { phase: "idle" };
  }
}

/** Keeps `state` under `key`; a deposit that is over, or none, removes the entry. */
export function writeStoredTwoStepDeposit(
  storage: StorageLike | null,
  key: string,
  state: FluentDepositSwapState,
): void {
  if (STORED_PHASES.has(state.phase)) {
    writeStoredValue(storage, key, encode(state));
  } else {
    removeStoredValue(storage, key);
  }
}
