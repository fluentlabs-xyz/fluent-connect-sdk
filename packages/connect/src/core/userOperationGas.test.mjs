import { afterEach, describe, expect, it, vi } from "vitest";
import { createKernelAccountClient } from "@zerodev/sdk";
import { BaseError, custom, numberToHex } from "viem";
import { setDebugLogging } from "./debugLogger";
import { sendUserOperationWithTiming } from "./userOperationTiming";
import { withUserOperationGas } from "./userOperationGas";

const address = "0x1111111111111111111111111111111111111111";
const factory = "0x2222222222222222222222222222222222222222";
const paymasterAddress = "0x3333333333333333333333333333333333333333";
const hash = `0x${"4".repeat(64)}`;
const signature = `0x${"5".repeat(130)}`;
const chain = { id: 20994, name: "Fluent", rpcUrls: { default: { http: [] } } };
const calls = [{ to: address, data: "0x1234", value: 0n }];
const gas = { callGasBuffer: { percentage: 50, fixed: 50_000n } };

afterEach(() => {
  setDebugLogging(false);
  vi.restoreAllMocks();
});

describe("UserOperation execution gas", () => {
  it.each([false, true])("buffers before preparation independently of diagnostics (%s)", async (debug) => {
    setDebugLogging(debug);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const account = { entryPoint: { address } };
    const args = { account, calls };
    const client = {
      request: vi.fn().mockResolvedValue({ callGasLimit: numberToHex(331_265n) }),
      sendUserOperation: vi.fn(async ({ account }) => {
        const estimated = await account.userOperation.estimateGas({ sender: address, callData: "0x1234" });
        expect(estimated.callGasLimit).toBe(546_898n);
        return hash;
      }),
    };
    expect(await sendUserOperationWithTiming(client, args, gas)).toBe(hash);
    expect(client.request).toHaveBeenCalledOnce();
    expect(client.sendUserOperation.mock.calls[0][0].calls).toBe(calls);
    expect(args).not.toHaveProperty("callGasLimit");
  });

  it.each([undefined, { callGasBuffer: {} }, { callGasLimit: 600_000n }])(
    "avoids the additional estimate without a nonzero buffer (case %#)",
    async (gas) => {
      const args = { account: {}, calls };
      const client = {
      request: vi.fn(),
        sendUserOperation: vi.fn().mockResolvedValue(hash),
      };
      await sendUserOperationWithTiming(client, args, gas);
      expect(client.request).not.toHaveBeenCalled();
      if (gas?.callGasLimit) {
        expect(client.sendUserOperation).toHaveBeenCalledWith(expect.objectContaining({ calls, callGasLimit: 600_000n }));
      } else expect(client.sendUserOperation).toHaveBeenCalledExactlyOnceWith(args);
    },
  );

  it.each([
    {},
    { callGasLimit: 0n },
    { callGasLimit: -1n },
    { callGasLimit: 100 },
    { callGasLimit: 1n << 128n },
    { callGasLimit: 1n, callGasBuffer: {} },
    { callGasBuffer: { percentage: -1 } },
    { callGasBuffer: { percentage: 0.5 } },
    { callGasBuffer: { percentage: Infinity } },
    { callGasBuffer: { percentage: Number.MAX_SAFE_INTEGER + 1 } },
    { callGasBuffer: { fixed: -1n } },
    { callGasBuffer: { fixed: 1 } },
    { callGasBuffer: { fixed: 1n << 128n } },
  ])("rejects invalid gas policies before estimation or sending (case %#)", async (gas) => {
    const client = { request: vi.fn(), sendUserOperation: vi.fn() };
    await expect(sendUserOperationWithTiming(client, { account: {}, calls }, gas)).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
    expect(client.sendUserOperation).not.toHaveBeenCalled();
  });

  it("propagates estimation failure and rejects a buffered uint128 overflow without sending", async () => {
    const error = new BaseError("estimation failed");
    const client = {
      request: vi.fn().mockRejectedValue(error),
      sendUserOperation: vi.fn(),
    };
    const operation = { sender: address, callData: "0x1234" };
    const sign = vi.fn();
    client.sendUserOperation.mockImplementation(async ({ account }) => {
      await account.userOperation.estimateGas(operation);
      sign();
      return hash;
    });
    const args = { account: { entryPoint: { address } }, calls };
    await expect(sendUserOperationWithTiming(client, args, gas)).rejects.toThrow("estimation failed");
    client.request.mockResolvedValue({ callGasLimit: numberToHex((1n << 128n) - 1n) });
    await expect(sendUserOperationWithTiming(client, args, gas)).rejects.toThrow("uint128");
    expect(sign).not.toHaveBeenCalled();
  });

  it("preserves the account's gas hook and an explicit execution limit takes precedence", async () => {
    const estimateGas = vi.fn().mockResolvedValue({ callGasLimit: 400_001n, preVerificationGas: 90_000n });
    const account = { entryPoint: { address }, userOperation: { estimateGas } };
    const args = { account, calls };
    const client = { request: vi.fn().mockResolvedValue({ callGasLimit: numberToHex(331_265n) }) };
    const operation = { sender: address, callData: "0x1234" };
    const buffered = withUserOperationGas(client, args, gas);
    expect(await buffered.account.userOperation.estimateGas(operation)).toMatchObject({
      callGasLimit: 650_002n, preVerificationGas: 90_000n,
    });
    expect(estimateGas).toHaveBeenCalledExactlyOnceWith(operation);
    const explicit = withUserOperationGas(client, args, { callGasLimit: 600_000n });
    expect(await explicit.account.userOperation.estimateGas(operation)).toMatchObject({
      callGasLimit: 600_000n, preVerificationGas: 90_000n,
    });
    expect(account.userOperation.estimateGas).toBe(estimateGas);
    expect(client.request).toHaveBeenCalledOnce();
  });

  const modes = [false, true].flatMap((debug) =>
    [false, true].flatMap((undeployed) =>
      ["none", "stub", "data-only"].map((paymasterMode) => ({ debug, undeployed, paymasterMode })),
    ),
  );
  it.each(modes)(
    "prepares and signs the buffered operation with real ZeroDev/viem ($debug, $undeployed, $paymasterMode)",
    async ({ debug, undeployed, paymasterMode }) => {
      const sponsored = paymasterMode !== "none";
      setDebugLogging(debug);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const account = {
        address,
        type: "smart",
        entryPoint: { address, version: "0.7" },
        getFactoryArgs: async () => undeployed ? { factory, factoryData: "0x4321" } : {},
        encodeCalls: vi.fn(async (batch) => {
          expect(batch).toEqual(calls);
          return "0x1234";
        }),
        getNonce: async () => 9n,
        getStubSignature: async () => signature,
        signUserOperation: vi.fn(async (operation) => {
          expect(operation.callGasLimit).toBe(546_898n);
          expect(operation.nonce).toBe(9n);
          if (sponsored) expect(operation.paymasterData).toBe(numberToHex(546_898n));
          return signature;
        }),
      };
      const getPaymasterData = vi.fn(async (operation) => ({
        paymaster: paymasterAddress,
        paymasterData: numberToHex(operation.callGasLimit ?? 331_265n),
        ...(paymasterMode === "data-only" ? {
          callGasLimit: operation.callGasLimit ?? 331_265n,
          preVerificationGas: operation.preVerificationGas ?? 80_000n,
          verificationGasLimit: operation.verificationGasLimit ?? 100_000n,
        } : {}),
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 50_000n,
      }));
      const request = vi.fn(async ({ method, params }) => {
        expect(params[0]).toMatchObject({
          sender: address,
          nonce: "0x9",
          callData: "0x1234",
          ...(undeployed ? { factory, factoryData: "0x4321" } : {}),
        });
        if (method === "eth_estimateUserOperationGas") return {
          callGasLimit: numberToHex(331_265n),
          preVerificationGas: numberToHex(80_000n),
          verificationGasLimit: numberToHex(100_000n),
          ...(sponsored ? {
            paymasterVerificationGasLimit: numberToHex(50_000n),
            paymasterPostOpGasLimit: numberToHex(50_000n),
          } : {}),
        };
        expect(method).toBe("eth_sendUserOperation");
        expect(params[0]).toMatchObject({
          callGasLimit: numberToHex(546_898n),
          maxFeePerGas: "0x1",
          maxPriorityFeePerGas: "0x1",
          signature,
          ...(sponsored ? { paymasterData: numberToHex(546_898n) } : {}),
        });
        return hash;
      });
      const client = createKernelAccountClient({
        account,
        chain,
        bundlerTransport: custom({ request }),
        ...(sponsored ? {
          paymaster: {
            ...(paymasterMode === "stub" ? { getPaymasterStubData: async () => ({
              paymaster: paymasterAddress, paymasterData: "0x1234", isFinal: true,
            }) } : {}),
            getPaymasterData,
          },
        } : {}),
        userOperation: {
          estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
        },
      });
      expect(await sendUserOperationWithTiming(client, { account, calls }, gas)).toBe(hash);
      expect(account.signUserOperation).toHaveBeenCalledOnce();
      expect(request.mock.calls.map(([args]) => args.method)).toEqual(
        paymasterMode === "data-only" ? ["eth_sendUserOperation"] : [
          "eth_estimateUserOperationGas", "eth_sendUserOperation",
        ],
      );
      if (sponsored) expect(getPaymasterData).toHaveBeenLastCalledWith(
        expect.objectContaining({ callGasLimit: 546_898n }),
      );
    },
  );
});
