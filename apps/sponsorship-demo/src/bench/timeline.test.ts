import { describe, expect, it } from "vitest";
import type { FluentExecuteTiming } from "@fluent.xyz/connect";

import { timelineCaveat, timelineRows, TIMELINE_APPROXIMATE_NOTE } from "./timeline";

const complete: FluentExecuteTiming = {
  prepareMs: 180.4,
  signMs: 1_980.6,
  broadcastMs: 702,
  inclusionMs: 400,
  detectMs: 1_000,
  retryMs: 0,
  totalMs: 4_263,
  instants: {
    submittedAtEpochMs: 1_700_000_000_000,
    broadcastedAtEpochMs: 1_700_000_002_863,
    receivedAtEpochMs: 1_700_000_004_263,
    blockTimestampEpochMs: 1_700_000_003_000,
    attempts: 1,
  },
};

const rowFor = (timing: FluentExecuteTiming, label: string) => {
  const row = timelineRows(timing).find((candidate) => candidate.label === label);
  if (!row) throw new Error(`no ${label} row`);
  return row;
};

describe("timelineRows", () => {
  it("names every stage of a send, in the order they happened", () => {
    expect(timelineRows(complete).map((row) => row.label)).toEqual([
      "prepare",
      "sign",
      "broadcast",
      "inclusion",
      "detect",
      "retry",
      "total",
    ]);
  });

  it("shows whole milliseconds", () => {
    expect(rowFor(complete, "prepare").value).toBe("180 ms");
    expect(rowFor(complete, "sign").value).toBe("1981 ms");
    expect(rowFor(complete, "total").value).toBe("4263 ms");
  });

  /**
   * The page's own rule: the number the reader compares against "3-4 s" must not look like a sum
   * of the stages, because it is not one — the waiting between them is in it too.
   */
  it("keeps the total apart from the sum of the stages", () => {
    const stages =
      complete.prepareMs! + complete.signMs! + complete.broadcastMs! + complete.retryMs;
    expect(stages).toBeLessThan(complete.totalMs);
  });

  it("marks the two cross-clock estimates, and only those", () => {
    expect(rowFor(complete, "inclusion").value).toBe("≈ 400 ms");
    expect(rowFor(complete, "detect").value).toBe("≈ 1000 ms");
    expect(timelineRows(complete).filter((row) => row.approximate).map((row) => row.label)).toEqual([
      "inclusion",
      "detect",
    ]);
  });

  /** Unclamped by the SDK, and unclamped here: a negative estimate is shown as it was computed. */
  it("shows a negative estimate rather than hiding it", () => {
    const skewed = { ...complete, inclusionMs: -600, detectMs: 2_000 };
    expect(rowFor(skewed, "inclusion").value).toBe("≈ -600 ms");
  });

  /**
   * The one rounding this page must never make. A block that could not be read loses two stages,
   * and "absent" is a different fact from "took no time".
   */
  it("shows an unmeasured stage as absent, never as zero", () => {
    const unread: FluentExecuteTiming = {
      ...complete,
      inclusionMs: undefined,
      detectMs: undefined,
      instants: { ...complete.instants, blockTimestampEpochMs: undefined },
    };
    expect(rowFor(unread, "inclusion").value).toBeNull();
    expect(rowFor(unread, "detect").value).toBeNull();
    // And the distinction is visible in the same list: the retry row is a measured zero, which
    // is a different fact from the two rows above and reads differently.
    expect(rowFor(unread, "retry").value).toBe("0 ms");
    // Everything the block read did not feed survives it.
    expect(rowFor(unread, "prepare").value).toBe("180 ms");
    expect(rowFor(unread, "total").value).toBe("4263 ms");
  });

  /**
   * The same rule for the other cause of an absent stage. When the browser's own clock could not
   * be read at a boundary, the SDK reports that stage as unmeasured rather than stretching it
   * over its neighbours — so a row can be absent while the stages around it are exact.
   */
  it("shows a stage the SDK could not measure as absent, with its neighbours intact", () => {
    const unmeasured: FluentExecuteTiming = {
      ...complete,
      prepareMs: undefined,
      signMs: undefined,
    };
    expect(rowFor(unmeasured, "prepare").value).toBeNull();
    expect(rowFor(unmeasured, "sign").value).toBeNull();
    expect(rowFor(unmeasured, "broadcast").value).toBe("702 ms");
    // The total is measured end to end, so it is still the number to compare against "3-4 s".
    expect(rowFor(unmeasured, "total").value).toBe("4263 ms");
  });

  it("says a retry cost nothing when there was none, and what it cost when there was", () => {
    expect(rowFor(complete, "retry").value).toBe("0 ms");
    expect(rowFor(complete, "retry").note).toContain("Submitted once");
    const retried: FluentExecuteTiming = {
      ...complete,
      retryMs: 340,
      instants: { ...complete.instants, attempts: 2 },
    };
    expect(rowFor(retried, "retry").value).toBe("340 ms");
    expect(rowFor(retried, "retry").note).toContain("2 operations were submitted");
  });

  /** An in-flight send, a failed one and an external wallet all have nothing to show. */
  it("shows nothing at all without timing", () => {
    expect(timelineRows(undefined)).toEqual([]);
  });
});

describe("timelineCaveat", () => {
  it("explains the two clocks whenever an estimate is on screen", () => {
    expect(timelineCaveat(timelineRows(complete))).toBe(TIMELINE_APPROXIMATE_NOTE);
  });

  it("says nothing when no estimate could be computed", () => {
    const unread = { ...complete, inclusionMs: undefined, detectMs: undefined };
    expect(timelineCaveat(timelineRows(unread))).toBeNull();
    expect(timelineCaveat(timelineRows(undefined))).toBeNull();
  });
});
