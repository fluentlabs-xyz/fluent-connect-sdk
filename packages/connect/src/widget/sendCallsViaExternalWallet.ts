import type { Chain, Hash, PublicClient } from "viem";

import type { FluentExternalWalletState } from "../core/types";
import type { FluentEncodedBatchCall, FluentExecuteResult } from "./batchOperation";

/**
 * Execute batch calls through an external EOA (e.g. MetaMask): no smart account,
 * so send each call as its own native-gas transaction, in order, waiting for
 * each receipt. Not atomic — `approve` then `deposit` are separate signatures.
 */
export async function sendCallsViaExternalWallet(
  calls: FluentEncodedBatchCall[],
  wallet: FluentExternalWalletState,
  chain: Chain,
  publicClient: PublicClient,
): Promise<FluentExecuteResult> {
  const walletClient = wallet.walletClient;
  if (!walletClient) throw new Error("External wallet client is not available");
  // Best-effort: ensure the wallet is on the widget chain (Reown's single-network
  // config can report the configured chain even when the wallet's real one differs).
  try {
    await wallet.switchChain(chain.id);
  } catch {
    // already on chain, or the wallet added/rejected it itself
  }
  const account = walletClient.account ?? (wallet.address as `0x${string}` | undefined);
  if (!account) throw new Error("External wallet has no active account");

  const hashes: Hash[] = [];
  for (const call of calls) {
    const hash = await walletClient.sendTransaction({
      to: call.to,
      data: call.data,
      value: call.value,
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    hashes.push(hash);
  }
  const hash = hashes[hashes.length - 1];
  if (!hash) throw new Error("A Fluent batch operation requires at least one call");
  // An EOA pays its own native gas by construction: there is no paymaster in the path.
  return { hash, hashes, atomic: false, sponsored: false };
}
