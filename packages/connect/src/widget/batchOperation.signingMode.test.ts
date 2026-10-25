/**
 * @vitest-environment jsdom
 *
 * The signing mode of a Batch operation (FLU-1622, criteria 2.15 and 2.17), through the widget
 * object a host holds: `useWidgetExecution` builds `widget.createBatchOp`, and the test calls
 * `execute()` on what it returns, as a host does. `"prompt"` shows the Review before a Fluent ID
 * signs, `"silent"` does not, and a Quick sign allowlist turns a silent operation with a call
 * outside it into a prompted one. A JavaScript host can still pass 0.5's `"always"` or
 * `"session"`, any other string, or `null`: each fails closed to Prompt mode, with the Review,
 * and only an omitted value takes the widget's default.
 *
 * One thing is faked: the smart account, a stand-in for what `useFluentZeroDevAccount` returns
 * (the Privy Signer and the ZeroDev kernel behind it), whose `ensureExecutionReady` and
 * `sendCalls` record the signing mode that reached them. The Review is the hook's
 * `confirmBatchOperation` parameter, which the widget fills with its Review screen; here it
 * records that it was asked. `useWidgetExecution` and `batchOperation.ts` run for real.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Chain, Hash, TransactionReceipt } from "viem";

import type { FluentSigningMode, FluentWidgetAccount } from "./batchOperation";
import { useWidgetExecution } from "./hooks/useWidgetExecution";

type ExecutionParams = Parameters<typeof useWidgetExecution>[0];
type SmartAccount = ExecutionParams["smartAccount"];
type Kernel = NonNullable<SmartAccount["kernel"]>;
type SendOptions = Parameters<SmartAccount["sendCalls"]>[1];

const TARGET = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
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

/**
 * A value a JavaScript host can pass where the type says `FluentSigningMode`: the type rules
 * out the 0.5 values and `null`, so a TypeScript test reaches them only through `unknown`.
 */
const untyped = (value: string | null) => value as unknown as FluentSigningMode;

function widget(options: {
  /** The widget's default: `"silent"` while the person's Quick sign is on. */
  signingMode?: FluentSigningMode;
  quickSignWhitelist?: readonly Address[];
} = {}) {
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
  const { result } = renderHook(() =>
    useWidgetExecution({
      chain,
      fluentAccountReady: false,
      wallet: null,
      smartAccount,
      widgetAccount: SMART_ACCOUNT,
      defaultSigningMode: options.signingMode ?? "prompt",
      selectedGasPaymentToken: { symbol: "ETH", decimals: 18 },
      quickSignWhitelist: options.quickSignWhitelist,
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
    /** The signing mode each step of the send was given: readiness, then the send. */
    modes: () => ({
      readied: [...readied],
      sent: sent.map((sendOptions) => sendOptions?.confirmation),
    }),
  };
}

afterEach(cleanup);

describe("criterion 2.17: a Batch operation's signing mode", () => {
  it("shows the Review and signs prompted for \"prompt\"", async () => {
    const { operation, reviews, modes } = widget();
    await operation().execute({ confirmation: "prompt" });
    expect(reviews).toHaveLength(1);
    expect(modes()).toEqual({ readied: ["prompt"], sent: ["prompt"] });
  });

  it("skips the Review and signs silently for \"silent\"", async () => {
    const { operation, reviews, modes } = widget();
    await operation().execute({ confirmation: "silent" });
    expect(reviews).toHaveLength(0);
    expect(modes()).toEqual({ readied: ["silent"], sent: ["silent"] });
  });

  it("prompts a silent operation with a call outside the Quick sign allowlist", async () => {
    const { operation, reviews, modes } = widget({
      signingMode: "silent",
      quickSignWhitelist: [OTHER],
    });
    await operation().execute();
    expect(reviews).toHaveLength(1);
    expect(modes()).toEqual({ readied: ["prompt"], sent: ["prompt"] });
  });

  it("keeps a silent operation silent when every call is on the allowlist", async () => {
    const { operation, reviews, modes } = widget({
      signingMode: "silent",
      quickSignWhitelist: [TARGET.toLowerCase() as Address],
    });
    await operation().execute();
    expect(reviews).toHaveLength(0);
    expect(modes()).toEqual({ readied: ["silent"], sent: ["silent"] });
  });

  it("follows the widget's signing mode when the caller names none", async () => {
    const prompted = widget();
    await prompted.operation().execute();
    expect(prompted.reviews).toHaveLength(1);
    expect(prompted.modes()).toEqual({ readied: ["prompt"], sent: ["prompt"] });

    const silent = widget({ signingMode: "silent" });
    await silent.operation().execute();
    expect(silent.reviews).toHaveLength(0);
    expect(silent.modes()).toEqual({ readied: ["silent"], sent: ["silent"] });
  });
});

describe("criterion 2.17: a signing mode outside the type fails closed", () => {
  // Quick sign is on in every case: the widget's own default would sign silently, so only the
  // value the host passed can be what brings the Review back.
  for (const value of ["always", "session", "skip-review", null]) {
    it(`shows the Review and signs prompted for ${JSON.stringify(value)}`, async () => {
      const { operation, reviews, modes } = widget({ signingMode: "silent" });
      await operation().execute({ confirmation: untyped(value) });
      expect(reviews).toHaveLength(1);
      expect(modes()).toEqual({ readied: ["prompt"], sent: ["prompt"] });
    });
  }

  it("shows the Review for \"session\" with a call outside the Quick sign allowlist", async () => {
    const { operation, reviews, modes } = widget({
      signingMode: "silent",
      quickSignWhitelist: [OTHER],
    });
    await operation().execute({ confirmation: untyped("session") });
    expect(reviews).toHaveLength(1);
    expect(modes()).toEqual({ readied: ["prompt"], sent: ["prompt"] });
  });
});
