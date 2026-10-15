import { describe, expect, it } from "vitest";
import type { FluentExecuteTiming } from "@fluent.xyz/connect";

import { appendEvent, eventLabel, upsertEvent, type RowEvent } from "./rowEvent";

const timing = (totalMs: number): FluentExecuteTiming => ({
  prepareMs: 100,
  signMs: 200,
  broadcastMs: 300,
  retryMs: 0,
  totalMs,
  instants: {
    submittedAtEpochMs: 1_700_000_000_000,
    broadcastedAtEpochMs: 1_700_000_000_600,
    receivedAtEpochMs: 1_700_000_000_000 + totalMs,
    attempts: 1,
  },
});

const dryRun: RowEvent = {
  kind: "dry-run",
  at: 1,
  result: { status: "failed", message: "no session" },
};
const sponsoredSend: RowEvent = { kind: "send", at: 2, requested: "sponsored", outcome: {} };
const blendSend: RowEvent = { kind: "send", at: 3, requested: "BLEND", outcome: {} };

const gasLabel = (symbol: string) => (symbol === "sponsored" ? "sponsored" : symbol);

describe("appendEvent", () => {
  it("keeps every earlier event, newest first", () => {
    const events = appendEvent(appendEvent([dryRun], sponsoredSend), blendSend);
    expect(events.map((event) => event.at)).toEqual([3, 2, 1]);
  });

  /** The comparison between the ways of paying is the page's whole subject. */
  it("does not replace a send of one gas token with a send of another", () => {
    const events = appendEvent([sponsoredSend], blendSend);
    expect(events).toHaveLength(2);
  });
});

describe("upsertEvent", () => {
  it("updates the entry in place when a send settles, rather than adding a second", () => {
    const settled: RowEvent = {
      kind: "send",
      at: 3,
      requested: "BLEND",
      outcome: { payer: "user-token" },
    };
    const events = upsertEvent([blendSend, sponsoredSend], settled);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(settled);
  });

  it("adds the entry when nothing matches it yet", () => {
    expect(upsertEvent([sponsoredSend], blendSend)).toHaveLength(2);
  });
});

/**
 * The comparison the log exists for, now extended to the stage breakdown: whether sponsorship
 * costs the extra second is a question only two timelines side by side can answer.
 */
describe("the send timeline on an event", () => {
  it("keeps each send's own timeline rather than the newest one", () => {
    const sponsored: RowEvent = {
      kind: "send",
      at: 2,
      requested: "sponsored",
      outcome: { payer: "app-budget", timing: timing(4_200) },
    };
    const token: RowEvent = {
      kind: "send",
      at: 3,
      requested: "BLEND",
      outcome: { payer: "user-token", timing: timing(2_100) },
    };
    const events = appendEvent([sponsored], token);
    expect(
      events.map((event) => (event.kind === "send" ? event.outcome.timing?.totalMs : null)),
    ).toEqual([2_100, 4_200]);
  });

  it("fills in the timeline when the send it is watching settles", () => {
    const settled: RowEvent = {
      kind: "send",
      at: 3,
      requested: "BLEND",
      outcome: { payer: "user-token", timing: timing(2_100) },
    };
    const events = upsertEvent([blendSend], settled);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(settled);
  });
});

describe("eventLabel", () => {
  it("names the gas token a send asked for, so two sends can be told apart", () => {
    expect(eventLabel(blendSend, gasLabel)).toBe("Sent · BLEND");
    expect(eventLabel(sponsoredSend, gasLabel)).toBe("Sent · sponsored");
  });

  it("names a dry run as the question it is", () => {
    expect(eventLabel(dryRun, gasLabel)).toBe("Dry-run");
  });
});
