import { createKernelAccountClient } from "@zerodev/sdk";
import { custom, numberToHex, type Address, type Hash, type Hex } from "viem";
import type { GetPaymasterDataParameters } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";

import { createFluentBatchOp } from "../widget/batchOperation";
import type { FluentUserOperationGas } from "../index";
import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import { sendWithSponsorship } from "./sponsoredClient";
import { sendUserOperationWithTiming } from "./userOperationTiming";

// ZeroDev 5.5.10 and viem 2.52.0 prepare, sign and submit for real. Only the Signer,
// account reads, bundler transport and paymaster responses are local test boundaries.
const address: Address = "0x1111111111111111111111111111111111111111";
const factory: Address = "0x2222222222222222222222222222222222222222";
const paymasterAddress: Address = "0x3333333333333333333333333333333333333333";
const hash: Hash = `0x${"4".repeat(64)}`;
const signature: Hex = `0x${"5".repeat(130)}`;
const chain = {
  id: 20994,
  name: "Fluent",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
};
const calls = [{ to: address, data: "0x1234" as Hex, value: 0n }];
const limits = {
  callGasLimit: 12_000_000n,
  verificationGasLimit: 500_000n,
  preVerificationGas: 100_000n,
};
const paymasterLimits = {
  paymasterVerificationGasLimit: 100_000n,
  paymasterPostOpGasLimit: 50_000n,
};
const gas = { skipEstimation: true as const, ...limits, ...paymasterLimits };
type PaymasterMode = "none" | "stub" | "final-stub" | "data-only" | "rpc";

function harness(mode: PaymasterMode, undeployed = false) {
  const estimateGas = vi.fn(async () => ({}));
  const sign = vi.fn(async (_operation: unknown) => signature);
  const originalAccount = {
    address,
    type: "smart",
    entryPoint: { address, version: "0.7" },
    encodeCalls: vi.fn(async () => "0x1234"),
    getFactoryArgs: vi.fn(async () => undeployed ? { factory, factoryData: "0x4321" } : {}),
    getNonce: vi.fn(async () => 9n),
    getStubSignature: vi.fn(async () => signature),
    signUserOperation: sign,
    userOperation: { estimateGas },
  };
  // Safe: this boundary implements the SmartAccount members viem 2.52.0 uses below;
  // the real ZeroDev client, preparation and timing wrapper receive it unchanged.
  const account = originalAccount as unknown as FluentZeroDevKernel["account"];
  const authorization = {
    paymaster: paymasterAddress,
    paymasterData: "0xabcd" as Hex,
    ...limits,
    ...paymasterLimits,
  };
  const getPaymasterData = vi.fn(async (_operation: GetPaymasterDataParameters) => authorization);
  const getPaymasterStubData = vi.fn(async (_operation: GetPaymasterDataParameters) => ({
    ...authorization,
    isFinal: mode === "final-stub",
  }));
  const request = vi.fn(async ({ method }: { method: string; params?: readonly unknown[] }) => {
    if (method === "pm_getPaymasterStubData" || method === "pm_getPaymasterData") {
      return {
        paymaster: paymasterAddress,
        paymasterData: "0xabcd",
        paymasterVerificationGasLimit: numberToHex(paymasterLimits.paymasterVerificationGasLimit),
        paymasterPostOpGasLimit: numberToHex(paymasterLimits.paymasterPostOpGasLimit),
      };
    }
    if (method === "eth_estimateUserOperationGas") {
      return Object.fromEntries(Object.entries(limits).map(([key, value]) => [
        key, numberToHex(value),
      ]));
    }
    expect(method).toBe("eth_sendUserOperation");
    return hash;
  });
  const client = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: custom({ request }, { retryCount: 0 }),
    ...(mode === "rpc" ? { paymaster: true } : mode !== "none" ? {
      paymaster: {
        getPaymasterData,
        ...(mode !== "data-only" ? { getPaymasterStubData } : {}),
      },
    } : {}),
    userOperation: {
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    },
  });
  const op = createFluentBatchOp({ calls }, {
    smartAccountReady: true,
    defaultConfirmation: "session",
    async sendCalls(batch, options) {
      const result = await sendUserOperationWithTiming(
        client, { account, calls: batch }, options?.userOperationGas,
      );
      return {
        hash: result.userOpHash, hashes: [result.userOpHash],
        atomic: true, sponsored: mode !== "none",
      };
    },
  });
  return {
    op, client, account, request, sign, estimateGas,
    getPaymasterData, getPaymasterStubData, originalAccount, authorization,
  };
}

describe("execute with gas estimation disabled", () => {
  const modes: PaymasterMode[] = ["none", "stub", "final-stub", "data-only"];
  it.each(modes.flatMap((mode) => [false, true].map((undeployed) => ({ mode, undeployed }))))(
    "signs the supplied gas without estimation ($mode, undeployed=$undeployed)",
    async ({ mode, undeployed }) => {
      const h = harness(mode, undeployed);
      await expect(h.op.execute({ userOperationGas: gas })).resolves.toMatchObject({ hash });
      expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
        "eth_sendUserOperation",
      ]);
      expect(h.estimateGas).not.toHaveBeenCalled();
      expect(h.sign).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(limits));
      expect(h.originalAccount.userOperation.estimateGas).toBe(h.estimateGas);
      expect(h.request.mock.calls[0]?.[0].params?.[0]).toMatchObject({
        ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [
          key, numberToHex(value),
        ])),
        signature,
        ...(undeployed ? { factory, factoryData: "0x4321" } : {}),
      });
      if (mode !== "none") {
        const authorize = mode === "data-only" ? h.getPaymasterData : h.getPaymasterStubData;
        expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(gasFields()));
        expect(h.getPaymasterData).toHaveBeenCalledTimes(mode === "final-stub" ? 0 : 1);
        expect(h.sign).toHaveBeenCalledWith(expect.objectContaining(paymasterLimits));
      }
    },
  );

  it("uses ERC-7677 RPC authorization without bundler gas estimation", async () => {
    const h = harness("rpc");
    await h.op.execute({ userOperationGas: gas });
    expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
      "pm_getPaymasterStubData", "pm_getPaymasterData", "eth_sendUserOperation",
    ]);
    expect(h.estimateGas).not.toHaveBeenCalled();
    expect(h.sign).toHaveBeenCalledWith(expect.objectContaining(gasFields()));
  });

  it("needs no paymaster limits when the Fluent ID pays native gas", async () => {
    const h = harness("none");
    await h.op.execute({ userOperationGas: { skipEstimation: true, ...limits } });
    expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
      "eth_sendUserOperation",
    ]);
    expect(h.sign).toHaveBeenCalledWith(expect.not.objectContaining({
      paymasterVerificationGasLimit: expect.anything(),
    }));
  });

  it.each([undefined, { callGasLimit: limits.callGasLimit, skipEstimation: false as const }])(
    "keeps normal estimation when the opt-out is absent or false (case %#)",
    async (policy) => {
      const h = harness("none");
      await h.op.execute({ userOperationGas: policy });
      expect(h.estimateGas).toHaveBeenCalledOnce();
      expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
        "eth_estimateUserOperationGas", "eth_sendUserOperation",
      ]);
    },
  );

  it("requires paymaster limits before authorization or signing", async () => {
    const h = harness("data-only");
    await expect(h.op.execute({
      userOperationGas: { skipEstimation: true, ...limits },
    })).rejects.toMatchObject({ name: "FluentUserOperationGasError", code: "invalid_policy" });
    expect(h.getPaymasterData).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it.each(["stub", "final-stub", "data-only"] as const)(
    "rejects changed authorized gas before signing (%s)",
    async (mode) => {
      const h = harness(mode);
      const changed = { ...h.authorization, callGasLimit: 1n };
      if (mode === "final-stub") {
        h.getPaymasterStubData.mockResolvedValueOnce({ ...changed, isFinal: true });
      } else {
        h.getPaymasterData.mockResolvedValueOnce(changed);
      }
      await expect(h.op.execute({ userOperationGas: gas })).rejects.toMatchObject({
        name: "FluentUserOperationGasError", code: "paymaster_gas_mismatch",
      });
      expect(h.sign).not.toHaveBeenCalled();
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("keeps fixed gas after a nonfinal stub and obtains matching final authorization", async () => {
    const h = harness("stub");
    h.getPaymasterStubData.mockResolvedValueOnce({
      ...h.authorization, callGasLimit: 1n, isFinal: false,
    });
    await h.op.execute({ userOperationGas: gas });
    expect(h.getPaymasterData).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(gasFields()),
    );
    expect(h.sign).toHaveBeenCalledWith(expect.objectContaining(gasFields()));
    expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
      "eth_sendUserOperation",
    ]);
  });

  it("accepts a zero post-operation budget without triggering estimation", async () => {
    const h = harness("data-only");
    h.getPaymasterData.mockResolvedValueOnce({
      ...h.authorization, paymasterPostOpGasLimit: 0n,
    });
    await h.op.execute({ userOperationGas: { ...gas, paymasterPostOpGasLimit: 0n } });
    expect(h.sign).toHaveBeenCalledWith(expect.objectContaining({ paymasterPostOpGasLimit: 0n }));
    expect(h.request.mock.calls.map(([request]) => request.method)).toEqual([
      "eth_sendUserOperation",
    ]);
  });

  it("keeps fixed gas through sponsorship failure and native-gas fallback", async () => {
    const sponsored = harness("data-only");
    const ownGas = harness("none");
    sponsored.getPaymasterData.mockRejectedValueOnce(new Error("paymaster unavailable"));
    const op = createFluentBatchOp({ calls }, {
      smartAccountReady: true,
      defaultConfirmation: "session",
      async sendCalls(batch, options) {
        const submit = async (h: ReturnType<typeof harness>) => (
          await sendUserOperationWithTiming(
            h.client, { account: h.account, calls: batch }, options.userOperationGas,
          )
        ).userOpHash;
        const outcome = await sendWithSponsorship({
          resolveBearer: async () => ({ token: "test.auth" }),
          buildClient: () => sponsored.client,
          sendSponsored: () => submit(sponsored),
          sendOwnGas: () => submit(ownGas),
          ownGasClient: ownGas.client,
          waitFor: async () => ({}),
          disableSponsorship: vi.fn(),
          log: { debug: vi.fn(), warn: vi.fn() },
        });
        return {
          hash: outcome.userOpHash, hashes: [outcome.userOpHash],
          atomic: true, sponsored: outcome.sponsored,
        };
      },
    });
    await expect(op.execute({ userOperationGas: gas })).resolves.toMatchObject({
      hash, sponsored: false,
    });
    expect(sponsored.request).not.toHaveBeenCalled();
    expect(sponsored.sign).not.toHaveBeenCalled();
    expect(ownGas.request.mock.calls.map(([request]) => request.method)).toEqual([
      "eth_sendUserOperation",
    ]);
    expect(ownGas.estimateGas).not.toHaveBeenCalled();
  });

  const invalid = [
    { ...gas, skipEstimation: "true" },
    { ...gas, callGasBuffer: { percentage: 50 } },
    { ...gas, callGasLimit: undefined },
    { ...gas, verificationGasLimit: undefined },
    { ...gas, preVerificationGas: undefined },
    { ...gas, verificationGasLimit: 0n },
    { ...gas, verificationGasLimit: 1 },
    { ...gas, verificationGasLimit: 1n << 128n },
    { ...gas, preVerificationGas: -1n },
    { ...gas, preVerificationGas: 1n << 256n },
    { ...gas, paymasterVerificationGasLimit: 0n },
    { ...gas, paymasterPostOpGasLimit: -1n },
  ];
  it.each(invalid)("rejects an invalid policy before review or setup (case %#)", async (policy) => {
    const confirm = vi.fn();
    const ensureReady = vi.fn();
    const sendCalls = vi.fn();
    const op = createFluentBatchOp({ calls }, { confirm, ensureReady, sendCalls });
    // Safe: malformed JavaScript input is deliberate; this test exercises runtime validation.
    const userOperationGas = policy as unknown as FluentUserOperationGas;
    await expect(op.execute({ userOperationGas })).rejects.toMatchObject({
      name: "FluentUserOperationGasError", code: "invalid_policy",
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(ensureReady).not.toHaveBeenCalled();
    expect(sendCalls).not.toHaveBeenCalled();
  });
});

function gasFields() {
  return { ...limits, ...paymasterLimits };
}
