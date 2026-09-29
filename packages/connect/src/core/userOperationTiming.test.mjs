import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKernelAccountClient } from "@zerodev/sdk";
import { custom, numberToHex } from "viem";
import ts from "typescript";
import { sendUserOperationWithTiming } from "./userOperationTiming";
import { setDebugLogging } from "./debugLogger";

const address = "0x1111111111111111111111111111111111111111";
const hash = `0x${"2".repeat(64)}`;
const signature = `0x${"3".repeat(130)}`;
const chain = { id: 20994, name: "Fluent", rpcUrls: { default: { http: [] } } };
const source = ts.transpileModule(
  readFileSync(new URL("../widget/zerodevSession.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;
const begin = source.indexOf("async function ensureWalletOnFluentChain(");
const end = source.length;
const ensureChain = runInNewContext(source.slice(begin, end) + "\nensureWalletOnFluentChain;", {
  numberToHex,
  debugLog() {},
});

afterEach(() => {
  vi.restoreAllMocks();
  setDebugLogging(false);
});

describe("Connect submission boundaries", () => {
  it("passes the original request through without instrumentation when diagnostics are off", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const args = { account: {}, calls: [] };
    const client = { sendUserOperation: vi.fn().mockResolvedValue(hash) };
    expect(await sendUserOperationWithTiming(client, args)).toBe(hash);
    expect(client.sendUserOperation.mock.calls[0][0]).toBe(args);
    expect(log).not.toHaveBeenCalled();
  });
  it("measures the real ZeroDev prepare/sign/send flow without repeating or changing it", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    setDebugLogging(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const nonce = vi.fn(async () => {
      now += 300;
      return 9n;
    });
    const sign = vi.fn(async function (operation) {
      expect(this).toBe(account);
      expect(operation.nonce).toBe(9n);
      now += 2000;
      return signature;
    });
    const account = {
      address,
      type: "smart",
      entryPoint: { address, version: "0.7" },
      getFactoryArgs: async () => ({}),
      encodeCalls: async () => "0x1234",
      getNonce: nonce,
      getStubSignature: async () => `0x${"4".repeat(130)}`,
      signUserOperation: sign,
    };
    const request = vi.fn(async ({ method, params }) => {
      if (method === "eth_estimateUserOperationGas") {
        now += 700;
        return {
          callGasLimit: "0x10000",
          preVerificationGas: "0x10000",
          verificationGasLimit: "0x10000",
        };
      }
      expect(method).toBe("eth_sendUserOperation");
      expect(params[0]).toMatchObject({
        sender: address,
        nonce: "0x9",
        callData: "0x1234",
        signature,
      });
      expect(params[1]).toBe(address);
      now += 700;
      return hash;
    });
    const client = createKernelAccountClient({
      account,
      chain,
      bundlerTransport: custom({ request }),
      userOperation: {
        estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      },
    });
    const calls = [{ to: address, data: "0x1234", value: 0n }];
    expect(await sendUserOperationWithTiming(client, { account, calls })).toBe(hash);
    expect(nonce).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledOnce();
    expect(account.signUserOperation).toBe(sign);
    expect(request.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_estimateUserOperationGas",
      "eth_sendUserOperation",
    ]);
    expect(log).toHaveBeenCalledWith("[fluent submission timing]", {
      success: true,
      preparationMs: 1000,
      signingMs: 2000,
      broadcastMs: 700,
      totalMs: 3700,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(signature);
    expect(JSON.stringify(log.mock.calls)).not.toContain("0x1234");
  });

  it.each(["preparing", "signing", "broadcasting"])(
    "propagates failures while %s without retrying the send",
    async (stage) => {
      const error = new Error("failure");
      setDebugLogging(true);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const account = {
        signUserOperation: vi.fn(async () => {
          if (stage === "signing") throw error;
          return signature;
        }),
      };
      const client = {
        sendUserOperation: vi.fn(async ({ account }) => {
          if (stage === "preparing") throw error;
          await account.signUserOperation({});
          throw error;
        }),
      };
      await expect(sendUserOperationWithTiming(client, { account })).rejects.toBe(error);
      expect(client.sendUserOperation).toHaveBeenCalledOnce();
      expect(log).toHaveBeenLastCalledWith(
        "[fluent submission timing]",
        expect.objectContaining({ success: false }),
      );
    },
  );
});

describe("Connect chain selection before signing", () => {
  it("does not switch wallets already on Fluent and rechecks the live provider on every call", async () => {
    const request = vi.fn().mockResolvedValue("0x5202");
    const wallet = { getEthereumProvider: async () => ({ request }), switchChain: vi.fn() };
    await ensureChain(wallet, chain);
    expect(wallet.switchChain).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: "eth_chainId" });
    request.mockResolvedValueOnce("0x1").mockResolvedValue("0x5202");
    await ensureChain(wallet, chain);
    expect(wallet.switchChain).toHaveBeenCalledExactlyOnceWith(20994);
  });

  it("keeps switch rejection and wrong-network failures", async () => {
    const rejected = new Error("User rejected");
    const wallet = {
      getEthereumProvider: async () => ({ request: vi.fn().mockResolvedValue("0x1") }),
      switchChain: vi.fn().mockRejectedValue(rejected),
    };
    await expect(ensureChain(wallet, chain)).rejects.toBe(rejected);
    wallet.switchChain.mockResolvedValue(undefined);
    await expect(ensureChain(wallet, chain)).rejects.toThrow("Unsupported chainId");
  });
});
