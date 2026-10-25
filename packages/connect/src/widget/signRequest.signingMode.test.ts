/**
 * @vitest-environment jsdom
 *
 * The signing mode of a signature (FLU-1622, criterion 2.17), through the widget object a host
 * holds: `useWidgetExecution` builds `widget.signMessage`, and the test calls it as a host does.
 * With Quick sign off a Fluent ID shows the Review and asks for the `"prompt"` kernel; with it
 * on it skips the Review and asks for the `"silent"` one. A silent kernel that is not the root
 * Signer falls back to the prompt kernel, which always is. A signature takes no signing mode
 * from the host: the mode is the widget's, set by Quick sign.
 *
 * One thing is faked: the smart account, a stand-in for what `useFluentZeroDevAccount` returns
 * (the Privy Signer and the ZeroDev kernels behind it), whose `ensureExecutionReady` records the
 * signing mode it was asked for and answers with a kernel from the root Signer (`"privy"`) or
 * from a permission session. The Review is the hook's `confirmSignature` parameter, which the
 * widget fills with its Review screen; here it records that it was asked. `useWidgetExecution`
 * and `signRequest.ts` run for real.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chain } from "viem";

import type { FluentSigningMode, FluentWidgetAccount } from "./batchOperation";
import { useWidgetExecution } from "./hooks/useWidgetExecution";

type ExecutionParams = Parameters<typeof useWidgetExecution>[0];
type SmartAccount = ExecutionParams["smartAccount"];
type Kernel = NonNullable<SmartAccount["kernel"]>;

const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.invalid"] } },
} as const satisfies Chain;

const SMART_ACCOUNT: FluentWidgetAccount = {
  address: "0x1111111111111111111111111111111111111111",
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

/** A kernel that signs, from the root Signer (`"privy"`) or from a permission session. */
function kernel(signerSource: string): Kernel {
  return {
    signerSource,
    account: {
      signMessage: async () => "0xaa",
      signTypedData: async () => "0xbb",
    },
  } as unknown as Kernel;
}

function widget(signingMode: FluentSigningMode, kernels: (mode: unknown) => Kernel) {
  const reviews: unknown[] = [];
  const readied: unknown[] = [];
  const smartAccount: SmartAccount = {
    smartAccountReady: true,
    kernel: null,
    ensureExecutionReady: async (options) => {
      readied.push(options?.confirmation);
      return kernels(options?.confirmation);
    },
    sendCalls: async () => {
      throw new Error("a signature sends nothing");
    },
  };
  const { result } = renderHook(() =>
    useWidgetExecution({
      chain,
      fluentAccountReady: true,
      wallet: null,
      smartAccount,
      widgetAccount: SMART_ACCOUNT,
      defaultSigningMode: signingMode,
      selectedGasPaymentToken: { symbol: "ETH", decimals: 18 },
      confirmBatchOperation: async () => {},
      confirmSignature: async (review) => {
        reviews.push(review);
      },
      refreshBalances: () => {},
      track: vi.fn(),
    }),
  );
  return { widget: () => result.current, reviews, readied };
}

afterEach(cleanup);

describe("criterion 2.17: a signature's signing mode", () => {
  it("shows the Review and asks for the prompt kernel with Quick sign off", async () => {
    const { widget: current, reviews, readied } = widget("prompt", () => kernel("privy"));
    await expect(current().signMessage({ message: "hello" })).resolves.toBe("0xaa");
    expect(reviews).toHaveLength(1);
    expect(readied).toEqual(["prompt"]);
  });

  it("skips the Review and asks for the silent kernel with Quick sign on", async () => {
    const { widget: current, reviews, readied } = widget("silent", () => kernel("privy"));
    await expect(current().signMessage({ message: "hello" })).resolves.toBe("0xaa");
    expect(reviews).toHaveLength(0);
    expect(readied).toEqual(["silent"]);
  });

  it("falls back to the prompt kernel when the silent one is not the root Signer", async () => {
    const { widget: current, readied } = widget("silent", (mode) =>
      kernel(mode === "silent" ? "session" : "privy"),
    );
    await expect(current().signMessage({ message: "hello" })).resolves.toBe("0xaa");
    expect(readied).toEqual(["silent", "prompt"]);
  });
});
