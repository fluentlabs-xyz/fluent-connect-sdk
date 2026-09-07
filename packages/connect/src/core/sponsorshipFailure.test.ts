import { BaseError, HttpRequestError } from "viem";
import { describe, expect, it } from "vitest";

import { getSponsorshipFailure } from "./sponsorshipFailure";

function httpError(status: number) {
  const cause = new HttpRequestError({ status, url: "https://sponsorship.example/paymaster/p" });
  const wrapper = new BaseError("send failed", { cause });
  return wrapper;
}

describe("getSponsorshipFailure", () => {
  it("treats a non-HTTP error as a per-operation policy denial", () => {
    expect(getSponsorshipFailure(new Error("rule refused the operation"))).toEqual({
      reason: "denied",
      disableSponsorship: false,
    });
  });

  it("disables sponsorship on 403 — the partner is not sponsored here", () => {
    expect(getSponsorshipFailure(httpError(403))).toEqual({
      reason: "unauthorized",
      disableSponsorship: true,
    });
  });

  it("keeps sponsorship on for a 401: an expired bearer refreshes on its own", () => {
    expect(getSponsorshipFailure(httpError(401))).toEqual({
      reason: "unauthorized",
      disableSponsorship: false,
    });
  });

  it("treats a 502 as transient", () => {
    expect(getSponsorshipFailure(httpError(502))).toEqual({
      reason: "unreachable",
      disableSponsorship: false,
    });
  });
});
