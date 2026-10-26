/**
 * @vitest-environment jsdom
 *
 * How a Sponsorship refusal is classified, and the error a send rejects with when both
 * Sponsorship and the own-gas fallback failed.
 *
 * `getSponsorshipFailure` is called directly with the errors viem raises for the sponsorship
 * paymaster's answers; it needs no fake.
 *
 * The fallback cases (FLU-1622, criterion 4.2) check standard A3's shape: a `name` and a string
 * `code`, the `FluentSponsorshipReason`, beside the `sponsorshipReason` it already carried. Each
 * sends through `sendCalls` of `useFluentZeroDevAccount` with the App's Sponsorship configured,
 * rendered as the widget renders it (`test/fakes/smartAccountSend.ts`): the sponsorship
 * paymaster refuses the operation in one of the ways it can, and the bundler then rejects the
 * own-gas submission, so the rejection is the one a host's `execute()` receives.
 * `core/sponsoredClient.ts` and `core/sponsorshipFailure.ts` classify the refusal for real.
 *
 * Fakes, and nothing else, for the fallback cases (`test/fakes/fluentId.ts` says what each
 * mirrors): Privy 2.25.0 with a signed-in user and one Signer; the smart account `@zerodev/sdk`
 * 5.5.10 derives and its `@zerodev/ecdsa-validator` 5.4.9 validator; and `fetch`, answering as
 * the widget chain, the ZeroDev bundler, the sponsorship paymaster and fluent-connect-service.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { BaseError, HttpRequestError } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { methodsAt, resetBoundary, stubNetwork, type Boundary } from "../../test/fakes/fluentId";
import { renderSmartAccount } from "../../test/fakes/smartAccountSend";
import { resetAuthTokenSessions } from "../widget/hooks/useAuthToken";
import {
  FluentSponsorshipFallbackError,
  type FluentSponsorshipReason,
  getSponsorshipFailure,
} from "./sponsorshipFailure";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

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

  it("disables sponsorship on 403 — the App is not sponsored here", () => {
    expect(getSponsorshipFailure(httpError(403))).toEqual({
      reason: "unauthorized",
      disableSponsorship: true,
    });
  });

  it("keeps sponsorship on for a 401: one fresh Fluent token and one retry answer it", () => {
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

const CALLS = [{ to: "0x3333333333333333333333333333333333333333" as const, data: "0x" as const }];

/** Read past the type: `code` is the field this criterion adds. */
function codeOf(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

describe("criterion 4.2: a sponsored send whose own-gas fallback failed too", () => {
  beforeEach(() => {
    resetAuthTokenSessions();
    stubNetwork();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each<[string, Partial<Boundary>, FluentSponsorshipReason]>([
    ["the paymaster denies the operation", { sponsorship: "denies" }, "denied"],
    ["the paymaster refuses the App (403)", { sponsorship: 403 }, "unauthorized"],
    ["the paymaster is not there (404)", { sponsorship: 404 }, "unreachable"],
    [
      "the paymaster rejects the token (401) and no fresh one is issued",
      { sponsorship: 401, exchanges: ["token", 401] },
      "no_token",
    ],
  ])("rejects with code %s → %s beside the same sponsorshipReason", async (_, script, reason) => {
    resetBoundary({ ...script, submissions: ["reject"] });
    const account = renderSmartAccount({ sponsored: true });
    await waitFor(() => expect(account.current.privyAuthenticated).toBe(true));

    const error = await account.current
      .sendCalls(CALLS, { confirmation: "prompt" })
      .then(() => undefined, (caught: unknown) => caught);

    expect(methodsAt("sponsorship")[0]).toBe("zd_sponsorUserOperation");
    expect(methodsAt("bundler")).toContain("eth_sendUserOperation");
    expect(error).toBeInstanceOf(FluentSponsorshipFallbackError);
    const fallback = error as FluentSponsorshipFallbackError;
    expect(fallback.name).toBe("FluentSponsorshipFallbackError");
    expect(fallback.sponsorshipReason).toBe(reason);
    expect(codeOf(fallback)).toBe(reason);
  });
});
