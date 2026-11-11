import type { GasOptionId } from "../consts";

import type { BenchDecideResult } from "./decide";
import type { SendOutcome } from "../components/PayerBadge";

/**
 * One thing that happened on a row, kept for the life of the page.
 *
 * A dry run, a sponsored send and a token send stand in one list, each saying what it asked for
 * and what it got, because that list is the only place the ways of paying can be compared. A
 * send keeps its own timeline in its `outcome`, since each way of paying spends its time
 * differently.
 */
export type RowEvent =
  | { kind: "dry-run"; at: number; result: BenchDecideResult }
  | { kind: "send"; at: number; requested: GasOptionId; outcome: SendOutcome };

/** Newest first: the thing that just happened is the thing being read. */
export function appendEvent(events: readonly RowEvent[], event: RowEvent): RowEvent[] {
  return [event, ...events];
}

/**
 * Replaces the entry with the same `kind` and `at`, or adds one newest first.
 *
 * `at` is the instant the action started, which the caller reuses when it settles: a send is
 * entered when submitted and updated in place when it settles, and two sends are two entries.
 */
export function upsertEvent(events: readonly RowEvent[], event: RowEvent): RowEvent[] {
  const index = events.findIndex(
    (candidate) => candidate.kind === event.kind && candidate.at === event.at,
  );
  if (index === -1) return appendEvent(events, event);
  const next = [...events];
  next[index] = event;
  return next;
}

/**
 * Returns an entry's label: what the reader asked for, in the words the button used. It says
 * nothing about the outcome, before or after the send settles, because only the badge says who
 * paid.
 */
export function eventLabel(event: RowEvent, gasLabel: (id: GasOptionId) => string) {
  return event.kind === "dry-run" ? "Dry-run" : `Sent · asked for ${gasLabel(event.requested)}`;
}
