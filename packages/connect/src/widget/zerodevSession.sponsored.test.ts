/**
 * @vitest-environment jsdom
 *
 * What a smart-account send reports as `sponsored` (FLU-1622, criterion 2.18): `true` or `false`
 * when the settled operation says which paymaster paid, `false` for a Gas token send, and `null`
 * when nothing says, where it used to return the send's own guess.
 *
 * Each case sends through `sendCalls` of `useFluentZeroDevAccount`, rendered as the widget
 * renders it (`test/fakes/smartAccountSend.ts`): the kernel is derived, the operation prepared,
 * signed, submitted and waited for by this repository's code, `@zerodev/sdk`'s
 * `createKernelAccountClient` and viem's user-operation actions.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors): Privy 2.25.0 with
 * a signed-in user and one Signer; the smart account `@zerodev/sdk` 5.5.10 derives and its
 * `@zerodev/ecdsa-validator` 5.4.9 validator; and `fetch`, answering as the widget chain, the
 * ZeroDev bundler and ERC-20 paymaster, the sponsorship paymaster and fluent-connect-service.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";

import {
  ERC20_PAYMASTER,
  PAYMASTER,
  methodsAt,
  resetBoundary,
  stubNetwork,
} from "../../test/fakes/fluentId";
import { renderSmartAccount } from "../../test/fakes/smartAccountSend";
import { resetAuthTokenSessions } from "./hooks/useAuthToken";

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

/** One send in Prompt mode, once the hook has rendered. */
async function send(
  options: Parameters<typeof renderSmartAccount>[0] = {},
  sendOptions: { gasPayment?: { symbol: string } } = {},
) {
  const account = renderSmartAccount(options);
  await waitFor(() => expect(account.current.privyAuthenticated).toBe(true));
  return account.current.sendCalls(CALLS, { confirmation: "prompt", ...sendOptions } as never);
}

describe("criterion 2.18: sponsored on a smart-account send", () => {
  it("is null when the receipt yields no paymaster and no gas token was chosen", async () => {
    // A bundler is not obliged to fill the receipt's `paymaster`, and this one's logs hold no
    // `UserOperationEvent` either: nothing says who paid.
    resetBoundary({ paidBy: null });
    const result = await send({ execution: { receiptSource: "bundler" } });

    expect(methodsAt("bundler")).toContain("eth_getUserOperationReceipt");
    expect(result.sponsored).toBeNull();
    expect(result.paymaster).toBeUndefined();
  });

  it("is true when the sponsorship paymaster paid, as the settled operation shows", async () => {
    resetBoundary({ paidBy: PAYMASTER });
    const result = await send({ sponsored: true });

    expect(methodsAt("sponsorship")).toEqual(["zd_sponsorUserOperation"]);
    expect(result.sponsored).toBe(true);
    expect(result.paymaster).toBe(PAYMASTER);
  });

  it("is false when the bundler's receipt names the zero address as the paymaster", async () => {
    // A bundler that fills `paymaster` spells "the account paid itself" as the zero address.
    resetBoundary({ paidBy: zeroAddress });
    const result = await send({ execution: { receiptSource: "bundler" } });

    expect(result.sponsored).toBe(false);
  });

  it("is false for a Gas token send, whose own paymaster is not a Sponsorship", async () => {
    resetBoundary({ paidBy: ERC20_PAYMASTER });
    const result = await send({ sponsored: true }, { gasPayment: { symbol: "BLEND" } });

    expect(methodsAt("bundler")).toContain("zd_sponsorUserOperation");
    expect(methodsAt("sponsorship")).toEqual([]);
    expect(result.sponsored).toBe(false);
  });
});
