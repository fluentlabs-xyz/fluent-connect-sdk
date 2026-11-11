/**
 * An External wallet send reports `sponsored: false`: an External wallet pays its own native gas,
 * and no paymaster is in its path.
 *
 * Fakes:
 * - the wallet client, as viem 2.52.0's: `sendTransaction` resolves a hash;
 * - the public client, as viem 2.52.0's: `waitForTransactionReceipt` resolves that hash's receipt.
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

describe("sendCallsViaExternalWallet", () => {
  it("reports an External wallet send as not sponsored", async () => {
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
