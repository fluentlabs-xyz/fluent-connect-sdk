/**
 * Only fetch is faked. It follows the request IDs and AbortSignal contract used by viem 2.52.0;
 * viem and ZeroDev 5.5.10 prepare the RPC requests and decode their responses for real.
 */
import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { createPublicClient } from "viem";
import { createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFluentBundlerTransport, createFluentRpcTransport } from "./rpc";
import {
  createFluentZeroDevErc20Paymaster,
  createFluentZeroDevSponsoredPaymaster,
} from "./zerodevPaymaster";

const rpcUrl = "https://rpc.example.test";
const chain = { ...fluentTestnet, rpcUrls: { default: { http: [rpcUrl] } } };
const sender = "0x1111111111111111111111111111111111111111";
const paymaster = "0x2222222222222222222222222222222222222222";
const operation = {
  sender,
  nonce: 0n,
  callData: "0x1234",
  signature: "0x",
  callGasLimit: 12_000_000n,
  verificationGasLimit: 500_000n,
  preVerificationGas: 100_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  chainId: chain.id,
  entryPointAddress: entryPoint07Address,
} as const;
const gasResponse = {
  callGasLimit: "0xb71b00",
  verificationGasLimit: "0x7a120",
  preVerificationGas: "0x186a0",
};
const paymasterResponse = {
  ...gasResponse,
  paymaster,
  paymasterData: "0x1234",
  paymasterVerificationGasLimit: "0x186a0",
  paymasterPostOpGasLimit: "0x186a0",
};

const requests = [
  {
    name: "chain reads used during transaction preparation",
    run: () => createPublicClient({
      chain,
      transport: createFluentRpcTransport(chain),
    }).getBlockNumber({ cacheTime: 0 }),
    response: "0x1",
    expected: 1n,
    attempts: 4,
  },
  {
    name: "bundler gas estimation used by account-paid fallback",
    run: () => createBundlerClient({
      chain,
      transport: createFluentBundlerTransport(rpcUrl),
    }).estimateUserOperationGas(operation),
    response: gasResponse,
    expected: expect.objectContaining({ callGasLimit: operation.callGasLimit }),
    attempts: 4,
  },
  {
    name: "sponsored paymaster authorization",
    run: () => createFluentZeroDevSponsoredPaymaster({
      chain,
      rpcUrl,
      bearerToken: "test-auth-token",
    }).getPaymasterData(operation),
    response: paymasterResponse,
    expected: expect.objectContaining({ paymaster, paymasterData: "0x1234" }),
    attempts: 1,
  },
  {
    name: "ERC-20 paymaster authorization",
    run: () => createFluentZeroDevErc20Paymaster({
      chain,
      paymasterRpcUrl: rpcUrl,
    }).getPaymasterData(operation),
    response: paymasterResponse,
    expected: expect.objectContaining({ paymaster, paymasterData: "0x1234" }),
    attempts: 1,
  },
];

function rpcFetch(result: unknown, delay: number | undefined) {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      if (!signal) throw new Error("The RPC request must carry its timeout signal");
      signals.push(signal);
      const request = JSON.parse(String(init.body));
      const timer = delay === undefined ? undefined : setTimeout(() => {
        resolve(Response.json({ jsonrpc: "2.0", id: request.id, result }));
      }, delay);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The request was aborted", "AbortError"));
      }, { once: true });
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, signals };
}

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(requests)("$name", ({ run, response, expected, attempts }) => {
  it("returns a response after twelve seconds without retrying the request", async () => {
    vi.useFakeTimers();
    const { fetch } = rpcFetch(response, 12_000);
    let outcome: unknown;
    const finished = run().then(
      (value) => { outcome = { value }; },
      (error) => { outcome = { error }; },
    );

    await vi.advanceTimersByTimeAsync(12_000);

    expect(outcome).toEqual({ value: expected });
    expect(fetch).toHaveBeenCalledTimes(1);
    await finished;
  });

  it("aborts an unresponsive request after thirty seconds and keeps bounded retries", async () => {
    vi.useFakeTimers();
    const { fetch, signals } = rpcFetch(response, undefined);
    let failure: unknown;
    const finished = run().catch((error) => { failure = error; });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    await finished;

    expect(fetch).toHaveBeenCalledTimes(attempts);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("details", "The request timed out.");
  });
});
