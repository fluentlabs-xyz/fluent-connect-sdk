/**
 * @vitest-environment jsdom
 *
 * A bridge deposit that lacks a value it needs fails with an Error that names the value: the
 * fast-path fee and the gas estimate without a public client for the source chain, and a
 * fast-path deposit of a token with no Fluent address, before anything is sent from the wallet.
 * The fee and the estimate are queries the hook keeps disabled without a public client and
 * returns no `refetch` for, so their tests fetch the query the hook registered, as a manual
 * refetch would.
 *
 * Fakes:
 * - `wagmi@2.19.5`'s hooks, as a wallet whose account is connected or not and whose own reads
 *   have not answered; `usePublicClient` returns the public client below, or `undefined` as wagmi
 *   does for a chain it cannot serve;
 * - the source chain's public client, answering the fast-path fee quote and the allowance read;
 * - `@rainbow-me/rainbowkit@2.2.8`'s `useConnectModal`, with no modal to open;
 * - `fetch`, standing for every RPC endpoint.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { maxUint256, type Address, type Hash, type PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFluentBridgeRoute } from "./route";
import { getBridgeToken } from "./tokens";
import { useBridgeDeposit } from "./useBridgeDeposit";

const fakes = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  publicClient: undefined as unknown,
  writeContractAsync: undefined as unknown as (...args: unknown[]) => Promise<`0x${string}`>,
  refetch: async () => ({}),
}));

vi.mock("wagmi", () => ({
  useAccount: () =>
    fakes.address
      ? { address: fakes.address, isConnected: true, connector: undefined, status: "connected" }
      : { address: undefined, isConnected: false, connector: undefined, status: "disconnected" },
  useBalance: () => ({ data: undefined, isLoading: false }),
  useDisconnect: () => ({ disconnect: () => {} }),
  usePublicClient: () => fakes.publicClient,
  useReadContract: () => ({
    data: undefined,
    isLoading: false,
    isPending: false,
    refetch: fakes.refetch,
  }),
  useSendTransaction: () => ({ sendTransactionAsync: async () => `0x${"0".repeat(64)}` }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isError: false }),
  useWriteContract: () => ({ writeContractAsync: fakes.writeContractAsync, isPending: false }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: undefined }),
}));

const route = getFluentBridgeRoute("mainnet")!;
const usdnr = getBridgeToken("mainnet", "USDnr");
const sender: Address = "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df";
const recipient: Address = "0x1ccF23916C572379630b067e9a0CbBddb56C5e72";
const hash: Hash = `0x${"4".repeat(64)}`;

function mount(token = usdnr) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useBridgeDeposit({ route, network: "mainnet", recipient, token }), {
    wrapper,
  });
  return { client, ...view };
}

beforeEach(() => {
  fakes.address = undefined;
  fakes.publicClient = undefined;
  fakes.writeContractAsync = vi.fn(async () => hash);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no request leaves this test");
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useBridgeDeposit without a public client for the source chain", () => {
  it("fails the fast-path fee read with an Error naming the missing public client and sends no request", async () => {
    const { client } = mount();

    const query = client
      .getQueryCache()
      .find({ queryKey: ["fluent-bridge-fast-path-fee"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useBridgeDeposit fast path fee: publicClient is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails the gas estimate with an Error naming the missing public client and sends no request", async () => {
    fakes.address = sender;
    const { client } = mount();

    const query = client.getQueryCache().find({ queryKey: ["fluent-bridge-gas"], exact: false });

    await expect(query!.fetch()).rejects.toEqual(
      new Error("useBridgeDeposit gas estimate: publicClient is missing"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("useBridgeDeposit for a fast-path token with no Fluent address", () => {
  it("fails the deposit with an Error naming the missing address and sends nothing", async () => {
    fakes.address = sender;
    // Safe: the deposit reads only these members of the public client before it fails.
    fakes.publicClient = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "allowance" ? maxUint256 : 10n ** 15n,
      ),
      estimateContractGas: vi.fn(async () => 100_000n),
      getGasPrice: vi.fn(async () => 1n),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    } as unknown as PublicClient;
    const { result } = mount({ ...usdnr, l2Address: undefined });

    act(() => result.current.form.setAmount("1"));
    await waitFor(() => expect(result.current.fee).toBeDefined());
    act(() => result.current.submit());

    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.message).toBe("USDnr has no Fluent token address on this network");
    expect(fakes.writeContractAsync).not.toHaveBeenCalled();
  });
});

describe("useBridgeDeposit's typed amount when the token changes", () => {
  it("clears the amount for a token with another symbol and keeps it for any other change", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </StrictMode>
    );
    const { result, rerender } = renderHook(
      ({ token }: { token: typeof usdnr }) =>
        useBridgeDeposit({ route, network: "mainnet", recipient, token }),
      { wrapper, initialProps: { token: usdnr } },
    );

    act(() => result.current.form.setAmount("1"));
    expect(result.current.form.amount).toBe("1");

    rerender({ token: usdnr });
    expect(result.current.form.amount).toBe("1");

    rerender({ token: { ...usdnr } });
    expect(result.current.form.amount).toBe("1");

    // Pins current behaviour: a token that changes its decimals but keeps its symbol keeps the amount.
    rerender({ token: { ...usdnr, decimals: 18 } });
    expect(result.current.form.amount).toBe("1");

    rerender({ token: getBridgeToken("mainnet", "BLEND") });
    expect(result.current.form.amount).toBe("");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
