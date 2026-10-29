/**
 * @vitest-environment jsdom
 *
 * Invariant (1) of FLU-1639, for generated values: any signing mode a host passes to a Batch
 * operation's `execute()` other than exactly `"silent"` shows the Review and signs in Prompt
 * mode, and exactly `"silent"` skips it. The widget's default is `"silent"` (Quick sign on) in
 * every run, so only the value the host passed can bring the Review back. An omitted value is
 * left out of the generator: it takes the widget's default by design.
 *
 * The path is the one `batchOperation.signingMode.test.ts` drives: `useWidgetExecution` builds
 * `widget.createBatchOp`, and the test calls `execute()` on what it returns, as a host does.
 * The Review is the hook's `confirmBatchOperation` parameter, which records that it was asked.
 *
 * The send's other caller of `normalizeSigningMode`, `ensureExecutionReady` in
 * `zerodevSession.ts`, picks the kernel that signs, so a value that is not exactly `"silent"`
 * must ready the prompting one; the second property calls it directly.
 *
 * Two things are faked: the smart account, a stand-in for what `useFluentZeroDevAccount` returns
 * (the Privy Signer and the ZeroDev kernel behind it), whose `ensureExecutionReady` and
 * `sendCalls` record the signing mode that reached them; and the readiness context
 * `ensureExecutionReady` reads, with one kernel handle per signing mode, both already built, so
 * no Privy or ZeroDev call is made. `useWidgetExecution`, `batchOperation.ts` and
 * `zerodevSession.ts` run for real.
 */
import { cleanup, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Chain, Hash, TransactionReceipt } from "viem";

import type { FluentSigningMode, FluentWidgetAccount } from "./batchOperation";
import { useWidgetExecution } from "./hooks/useWidgetExecution";
import { ensureExecutionReady, type FluentZeroDevReadinessContext } from "./zerodevSession";

type ExecutionParams = Parameters<typeof useWidgetExecution>[0];
type SmartAccount = ExecutionParams["smartAccount"];
type Kernel = NonNullable<SmartAccount["kernel"]>;
type SendOptions = Parameters<SmartAccount["sendCalls"]>[1];

const TARGET = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
const HASH = `0x${"1".repeat(64)}` as Hash;

const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.invalid"] } },
} as const satisfies Chain;

const SMART_ACCOUNT: FluentWidgetAccount = {
  address: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
  connected: true,
  executionReady: false,
  executionStatus: "unavailable",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

/** A handle only: the hook passes it to `sendCalls` and never reads it. */
const kernel = { signerMode: "prompt", signerSource: "privy" } as unknown as Kernel;

function widget(quickSignWhitelist: readonly Address[] | undefined) {
  const reviews: unknown[] = [];
  const readied: unknown[] = [];
  const sent: SendOptions[] = [];
  const smartAccount: SmartAccount = {
    smartAccountReady: false,
    kernel: null,
    ensureExecutionReady: async (readyOptions) => {
      readied.push(readyOptions?.confirmation);
      return kernel;
    },
    sendCalls: async (_calls, sendOptions) => {
      sent.push(sendOptions);
      return {
        hash: HASH,
        receipt: { transactionHash: HASH } as unknown as TransactionReceipt,
        userOpHash: HASH,
        sponsored: false,
      } as Awaited<ReturnType<SmartAccount["sendCalls"]>>;
    },
  };
  const { result, unmount } = renderHook(() =>
    useWidgetExecution({
      chain,
      fluentAccountReady: false,
      wallet: null,
      smartAccount,
      widgetAccount: SMART_ACCOUNT,
      defaultSigningMode: "silent",
      selectedGasPaymentToken: { symbol: "ETH", decimals: 18 },
      quickSignWhitelist,
      confirmBatchOperation: async (review) => {
        reviews.push(review);
      },
      confirmSignature: async () => {},
      refreshBalances: () => {},
      track: vi.fn(),
    }),
  );
  const operation = () => result.current.createBatchOp({ calls: [{ to: TARGET, data: "0x" }] });
  return {
    operation,
    reviews,
    unmount,
    /** The signing mode each step of the send was given: readiness, then the send. */
    modes: () => ({
      readied: [...readied],
      sent: sent.map((sendOptions) => sendOptions?.confirmation),
    }),
  };
}

/**
 * Values a JavaScript host can pass where the type says `FluentSigningMode`: near misses of
 * `"silent"`, 0.5's values, any string, and any value at all.
 */
const notSilent = fc
  .oneof(
    fc.constantFrom<unknown>(
      "prompt",
      "always",
      "session",
      "Silent",
      "SILENT",
      " silent",
      "silent ",
      "silent\u0000",
      "",
      null,
      Object("silent"),
      ["silent"],
      { toString: () => "silent" },
    ),
    fc.string(),
    fc.anything({ withBoxedValues: true, withNullPrototype: true, withBigInt: true }),
  )
  .filter((value) => value !== "silent" && value !== undefined);

/**
 * Exactly `"silent"` beside the values that are not, so each property states the rule both ways:
 * a check that let a near miss through fails on the near miss, and a harness that could not
 * tell the two modes apart fails on `"silent"`.
 */
const signingModeValue = fc.oneof(
  { arbitrary: fc.constant<unknown>("silent"), weight: 1 },
  { arbitrary: notSilent, weight: 4 },
);

afterEach(cleanup);

describe("invariant (1): a signing mode other than exactly \"silent\" fails closed", () => {
  it("shows the Review and signs prompted for any value but exactly \"silent\"", async () => {
    await fc.assert(
      fc.asyncProperty(
        signingModeValue,
        // Both allow Silent mode for the target: no whitelist, and one that lists it.
        fc.constantFrom<readonly Address[] | undefined>(undefined, [TARGET]),
        async (value, quickSignWhitelist) => {
          const { operation, reviews, modes, unmount } = widget(quickSignWhitelist);
          try {
            await operation().execute({ confirmation: value as FluentSigningMode });
            const mode = value === "silent" ? "silent" : "prompt";
            expect(reviews).toHaveLength(mode === "prompt" ? 1 : 0);
            expect(modes()).toEqual({ readied: [mode], sent: [mode] });
          } finally {
            unmount();
          }
        },
      ),
      { examples: [[null, undefined], ["silent", undefined], ["silent", [TARGET]]] },
    );
  });

  it("readies the prompting kernel for any value but exactly \"silent\"", async () => {
    const kernels = {
      prompt: { signerMode: "prompt", signerSource: "privy" },
      silent: { signerMode: "silent", signerSource: "privy" },
    } as unknown as FluentZeroDevReadinessContext["kernels"];
    const context: FluentZeroDevReadinessContext = {
      kernels,
      ready: true,
      authenticated: true,
      login: () => {},
      initialize: async () => {
        throw new Error("both kernels exist, so none is built");
      },
      error: null,
    };
    await fc.assert(
      fc.asyncProperty(signingModeValue, async (value) => {
        const kernel = await ensureExecutionReady(context, {
          confirmation: value as FluentSigningMode,
        });
        expect(kernel).toBe(value === "silent" ? kernels.silent : kernels.prompt);
      }),
      { examples: [[null], ["silent"]] },
    );
  });
});
