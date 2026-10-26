/**
 * @vitest-environment jsdom
 *
 * What a smart-account send reports as `sponsored` (FLU-1622, criterion 2.18; FLU-1636): `true`
 * or `false` when the settled operation says which paymaster paid, `false` for a Gas token send
 * and for an ETH send that never went through the sponsored client, and `null` only for a send
 * through the sponsored client whose receipt names no paymaster.
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
  TRANSACTION_HASH,
  USER_OP_HASH,
  methodsAt,
  resetBoundary,
  stubNetwork,
  type Boundary,
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

type SendOptions = { gasPayment?: { symbol?: string; sponsorship?: "auto" | "never" } };

beforeEach(() => {
  resetAuthTokenSessions();
  stubNetwork();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The smart account, once the hook has rendered and Privy has a signed-in user. */
async function renderAccount(options: Parameters<typeof renderSmartAccount>[0] = {}) {
  const account = renderSmartAccount(options);
  await waitFor(() => expect(account.current.privyAuthenticated).toBe(true));
  return (sendOptions: SendOptions = {}) =>
    account.current.sendCalls(CALLS, { confirmation: "prompt", ...sendOptions } as never);
}

/** One send in Prompt mode, once the hook has rendered. */
async function send(
  options: Parameters<typeof renderSmartAccount>[0] = {},
  sendOptions: SendOptions = {},
) {
  return (await renderAccount(options))(sendOptions);
}

/**
 * The paths on which an ETH operation never goes through the sponsored client, each under the
 * default receipt source, so the receipt is read off the chain. The chain's `UserOperationEvent`
 * names the zero address, the EntryPoint's spelling of "the account paid", which the chain
 * reader turns into no paymaster at all: the receipt itself does not say who paid, and only the
 * way the operation was sent can.
 */
const OWN_GAS_PATHS: Array<{
  path: string;
  boundary: Partial<Boundary>;
  /** Every operation the case sends, in order; each one is an own-gas operation. */
  run: () => Promise<Array<Awaited<ReturnType<typeof send>>>>;
  /** What reached the sponsorship paymaster, which tells this path from the others. */
  sponsorshipRequests: string[];
  /** One `eth_sendUserOperation` per operation: no sponsored submission reached the bundler. */
  submissions: number;
  sponsorshipReasons: Array<string | undefined>;
}> = [
  {
    path: "the fallback after the sponsorship service denied the operation",
    boundary: { sponsorship: "denies" },
    run: async () => [await send({ sponsored: true })],
    sponsorshipRequests: ["zd_sponsorUserOperation"],
    submissions: 1,
    sponsorshipReasons: ["denied"],
  },
  {
    path: "the fallback for lack of an Auth token",
    boundary: { exchanges: [401] },
    run: async () => [await send({ sponsored: true })],
    sponsorshipRequests: [],
    submissions: 1,
    sponsorshipReasons: ["no_token"],
  },
  {
    path: "an operation that asked for sponsorship \"never\"",
    boundary: {},
    run: async () => [await send({ sponsored: true }, { gasPayment: { sponsorship: "never" } })],
    sponsorshipRequests: [],
    submissions: 1,
    sponsorshipReasons: ["not_requested"],
  },
  {
    path: "the fallback after an HTTP 403 and the operation after it, with Sponsorship unavailable",
    boundary: { sponsorship: 403 },
    run: async () => {
      const sendNext = await renderAccount({ sponsored: true });
      // The first operation meets the 403 and falls back; the second makes no sponsored
      // attempt at all, because the 403 left Sponsorship unavailable.
      const fallback = await sendNext();
      return [fallback, await sendNext()];
    },
    sponsorshipRequests: ["zd_sponsorUserOperation"],
    submissions: 2,
    sponsorshipReasons: ["unauthorized", "unauthorized"],
  },
  {
    path: "an App with no Sponsorship configured",
    boundary: {},
    run: async () => [await send()],
    sponsorshipRequests: [],
    submissions: 1,
    sponsorshipReasons: [undefined],
  },
];

/** The path each case claims, read off what reached the network. */
function expectOwnGasPath(ownGas: (typeof OWN_GAS_PATHS)[number]) {
  expect(methodsAt("sponsorship")).toEqual(ownGas.sponsorshipRequests);
  expect(methodsAt("bundler").filter((method) => method === "eth_sendUserOperation")).toHaveLength(
    ownGas.submissions,
  );
  expect(methodsAt("chain")).toContain("eth_getLogs");
  expect(methodsAt("bundler")).not.toContain("eth_getUserOperationReceipt");
}

describe("an ETH operation its own account paid for, under the default receipt source", () => {
  for (const ownGas of OWN_GAS_PATHS) {
    it(`reports sponsored false after ${ownGas.path}`, async () => {
      resetBoundary({ paidBy: zeroAddress, ...ownGas.boundary });
      const results = await ownGas.run();

      expectOwnGasPath(ownGas);
      // The receipt names no paymaster, so the receipt alone cannot decide this result.
      expect(results.map((result) => result.paymaster)).toEqual(results.map(() => undefined));
      expect(results.map((result) => result.sponsored)).toEqual(results.map(() => false));
    });
  }
});

describe("the rest of the result of an ETH operation its own account paid for", () => {
  for (const ownGas of OWN_GAS_PATHS) {
    it(`keeps paymaster absent and every other member as it was after ${ownGas.path}`, async () => {
      resetBoundary({ paidBy: zeroAddress, ...ownGas.boundary });
      const results = await ownGas.run();

      expectOwnGasPath(ownGas);
      for (const [index, result] of results.entries()) {
        expect(result.paymaster).toBeUndefined();
        expect(result.sponsorshipReason).toBe(ownGas.sponsorshipReasons[index]);
        expect(result.userOpHash).toBe(USER_OP_HASH);
        expect(result.hash).toBe(TRANSACTION_HASH);
        expect(result.receipt.transactionHash).toBe(TRANSACTION_HASH);
      }
    });
  }
});

describe("an operation Sponsorship paid for", () => {
  it("reports sponsored true off the chain's receipt, the default source", async () => {
    resetBoundary({ paidBy: PAYMASTER });
    const result = await send({ sponsored: true });

    expect(methodsAt("sponsorship")).toEqual(["zd_sponsorUserOperation"]);
    expect(methodsAt("chain")).toContain("eth_getLogs");
    expect(result.sponsored).toBe(true);
    expect(result.paymaster).toBe(PAYMASTER);
  });

  it("reports sponsored true off the bundler's receipt", async () => {
    resetBoundary({ paidBy: PAYMASTER });
    const result = await send({ sponsored: true, execution: { receiptSource: "bundler" } });

    expect(methodsAt("sponsorship")).toEqual(["zd_sponsorUserOperation"]);
    expect(methodsAt("bundler")).toContain("eth_getUserOperationReceipt");
    expect(result.sponsored).toBe(true);
    expect(result.paymaster).toBe(PAYMASTER);
  });
});

describe("a send through the sponsored client whose receipt names no paymaster", () => {
  it("reports sponsored null when the bundler's receipt and logs are silent", async () => {
    // A bundler is not obliged to fill the receipt's `paymaster`, and this one's logs hold no
    // `UserOperationEvent` either: nothing says who paid, and the send went through the
    // sponsored client, so neither does the way it was sent.
    resetBoundary({ paidBy: null });
    const result = await send({ sponsored: true, execution: { receiptSource: "bundler" } });

    // One sponsored submission and no fallback after it.
    const submissions = methodsAt("bundler").filter((method) => method === "eth_sendUserOperation");
    expect(methodsAt("sponsorship")).toEqual(["zd_sponsorUserOperation"]);
    expect(submissions).toHaveLength(1);
    expect(methodsAt("bundler")).toContain("eth_getUserOperationReceipt");
    expect(result.sponsorshipReason).toBeUndefined();
    expect(result.paymaster).toBeUndefined();
    expect(result.sponsored).toBeNull();
  });
});

describe("criterion 2.18: sponsored on a smart-account send", () => {
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
