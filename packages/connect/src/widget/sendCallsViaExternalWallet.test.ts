/**
 * What an External wallet send reports as `sponsored` (FLU-1622, criterion 2.19): `false`, as
 * before 0.6.0. An External wallet pays its own native gas; there is no paymaster in its path.
 *
 * The wallet client and the public client are fakes of viem 2.x's: `sendTransaction` resolves a
 * hash, and `waitForTransactionReceipt` resolves that hash's receipt afterwards.
 */
import { describe, expect, it, vi } from "vitest";
import type { Chain, PublicClient } from "viem";

import type { FluentExternalWalletState } from "../core/types";
import { sendCallsViaExternalWallet } from "./sendCallsViaExternalWallet";

const ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"3".repeat(64)}` as const;

const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.invalid"] } },
} as const satisfies Chain;

describe("criterion 2.19: sponsored on an External wallet send", () => {
  it("is false", async () => {
    const wallet = {
      configured: true,
      connected: true,
      address: ADDRESS,
      walletClient: { account: { address: ADDRESS }, sendTransaction: vi.fn(async () => HASH) },
      open: () => {},
      disconnect: () => {},
      switchChain: async () => {},
    } as unknown as FluentExternalWalletState;
    const publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", transactionHash: HASH })),
    } as unknown as PublicClient;

    const result = await sendCallsViaExternalWallet(
      [{ to: ADDRESS, data: "0x", value: 0n }],
      wallet,
      chain,
      publicClient,
    );

    expect(result.hash).toBe(HASH);
    expect(result.atomic).toBe(false);
    expect(result.sponsored).toBe(false);
  });
});
