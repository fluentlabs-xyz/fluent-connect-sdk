import type { GasOptionId } from "../consts";

import type { BenchDecideResult } from "./decide";
import type { SendOutcome } from "../components/PayerBadge";

/**
 * One thing that happened on a row, kept forever.
 *
 * The page's subject is the difference between the ways of paying, and with one Send button
 * the only place that difference can still be seen is here: a dry run, a sponsored send and
 * a token send stand in one list, each saying what it asked for and what it got. Replacing
 * the previous result — which is what a single "outcome" per row does — deletes the
 * comparison a moment after it becomes available.
 */
export type RowEvent =
  | { kind: "dry-run"; at: number; result: BenchDecideResult }
  | { kind: "send"; at: number; requested: GasOptionId; outcome: SendOutcome };

/** Newest first: the thing that just happened is the thing being read. */
export function appendEvent(events: readonly RowEvent[], event: RowEvent): RowEvent[] {
  return [event, ...events];
}

/**
 * Replace the entry a row already holds for this exact moment, or add one.
 *
 * Identity is `kind` plus `at` — the instant the action started, chosen by the caller and
 * reused when the same action settles. Not "the newest of this kind": two sends of the same
 * kind are two entries, which is the comparison the log exists for.
 *
 * A send is entered the moment it is submitted and updated when it settles, so the entry a
 * reader is watching is the one that changes — an in-flight send that appended a second
 * line on settling would read as two sends.
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

/** What the reader asked for, in the words the button used. */
export function eventLabel(event: RowEvent, gasLabel: (id: GasOptionId) => string) {
  return event.kind === "dry-run" ? "Dry-run" : `Sent · ${gasLabel(event.requested)}`;
}
