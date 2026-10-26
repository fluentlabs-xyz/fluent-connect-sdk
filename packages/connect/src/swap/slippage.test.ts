import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFluentSwapSlippage, getFluentSwapDeadline } from "./slippage";

describe("applyFluentSwapSlippage", () => {
  it("takes the basis points off the quote", () => {
    expect(applyFluentSwapSlippage(1_000_000n, 50n)).toBe(995_000n);
    expect(applyFluentSwapSlippage(1_000_000n, 100n)).toBe(990_000n);
  });

  it("rounds down, so the floor is never above what the swap may deliver", () => {
    expect(applyFluentSwapSlippage(999n, 50n)).toBe(994n);
  });

  it("leaves the quote alone when nothing is allowed to slip", () => {
    expect(applyFluentSwapSlippage(1_000_000n, 0n)).toBe(1_000_000n);
  });
});

describe("getFluentSwapDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the minutes from now, in unix seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));

    expect(getFluentSwapDeadline(30)).toBe(1_792_972_800n + 1_800n);
  });

  it("never asks the router to accept a swap it is already too late for", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));

    expect(getFluentSwapDeadline(0)).toBe(1_792_972_800n + 60n);
  });
});
