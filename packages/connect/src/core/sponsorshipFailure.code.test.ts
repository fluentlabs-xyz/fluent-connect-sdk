/**
 * @vitest-environment jsdom
 *
 * The error a send rejects with when both Sponsorship and the own-gas fallback failed (FLU-1622,
 * criterion 4.2): standard A3's shape, a `name` and a string `code`, the
 * `FluentSponsorshipReason`, beside the `sponsorshipReason` it already carried.
 *
 * Each case sends through `sendCalls` of `useFluentZeroDevAccount` with the App's Sponsorship
 * configured, rendered as the widget renders it (`test/fakes/smartAccountSend.ts`): the
 * sponsorship paymaster refuses the operation in one of the ways it can, and the bundler then
 * rejects the own-gas submission, so the rejection is the one a host's `execute()` receives.
 * `core/sponsoredClient.ts` and `core/sponsorshipFailure.ts` classify the refusal for real.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors): Privy 2.25.0 with
 * a signed-in user and one Signer; the smart account `@zerodev/sdk` 5.5.10 derives and its
 * `@zerodev/ecdsa-validator` 5.4.9 validator; and `fetch`, answering as the widget chain, the
 * ZeroDev bundler, the sponsorship paymaster and fluent-connect-service.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { methodsAt, resetBoundary, stubNetwork, type Boundary } from "../../test/fakes/fluentId";
import { renderSmartAccount } from "../../test/fakes/smartAccountSend";
import { resetAuthTokenSessions } from "../widget/hooks/useAuthToken";
import { FluentSponsorshipFallbackError, type FluentSponsorshipReason } from "./sponsorshipFailure";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

const CALLS = [{ to: "0x3333333333333333333333333333333333333333" as const, data: "0x" as const }];

beforeEach(() => {
  resetAuthTokenSessions();
  stubNetwork();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Read past the type: `code` is the field this criterion adds. */
function codeOf(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

describe("criterion 4.2: a sponsored send whose own-gas fallback failed too", () => {
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
