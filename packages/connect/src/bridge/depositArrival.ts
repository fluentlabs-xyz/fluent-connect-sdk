import { erc20Abi, type Address, type Hash, type PublicClient } from "viem";

import { debugError } from "../core/debugLogger";
import type { FluentSwapToken } from "../swap/tokens";
import { findBridgeTxBySentHash, getBridgeTransactions } from "./txHistory";

/** Where one Deposit stands, as far as the chains and the bridge indexer can tell. */
export type DepositArrival =
  | { status: "pending" }
  /** `received` is how far the Fluent ID's balance rose over the reading taken before. */
  | { status: "landed"; received: bigint }
  | { status: "failed"; message: string };

/** The Fluent ID's balance of `token`: the chain's own coin, or an ERC-20 by its address. */
export function readFluentTokenBalance(
  client: PublicClient,
  token: FluentSwapToken,
  account: Address,
): Promise<bigint> {
  return token.address
    ? client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      })
    : client.getBalance({ address: account });
}

/**
 * One reading of a Deposit already signed: has it failed, landed, or neither yet.
 *
 * Failure comes from either side: a deposit transaction that reverted on the source
 * chain, or an indexer entry saying the relay could not deliver it. Arrival comes
 * from the Fluent ID's balance alone, because what a Two-step deposit needs is the
 * amount that landed, and only the balance says that. A read that fails is not an
 * answer, so it reads as `pending` and the next poll asks again.
 *
 * @param baseline The Fluent ID's balance of `token` before the deposit could land.
 */
export async function checkDepositArrival({
  sourceClient,
  destinationClient,
  indexerUrl,
  sentHash,
  sender,
  recipient,
  token,
  baseline,
  signal,
}: {
  sourceClient: PublicClient;
  destinationClient: PublicClient;
  indexerUrl: string;
  /** The deposit transaction on the source chain. */
  sentHash: Hash;
  /** The External wallet that signed it: the indexer files deposits under the sender. */
  sender: Address;
  /** The Fluent ID the deposit is credited to. */
  recipient: Address;
  /** The Delivered token, as it is held on Fluent. */
  token: FluentSwapToken;
  baseline: bigint;
  signal?: AbortSignal;
}): Promise<DepositArrival> {
  const receipt = await sourceClient
    .getTransactionReceipt({ hash: sentHash })
    .catch(() => undefined);
  if (receipt?.status === "reverted") {
    return { status: "failed", message: "The deposit transaction reverted on Ethereum." };
  }

  try {
    const history = await getBridgeTransactions({ baseUrl: indexerUrl, address: sender, signal });
    const item = findBridgeTxBySentHash(history, sentHash);
    if (item && (item.status === "failed" || item.successful_call === false)) {
      return { status: "failed", message: "The bridge could not deliver this deposit on Fluent." };
    }
  } catch (error) {
    if (!signal?.aborted) debugError("[FluentBridge] indexer read failed", error);
  }

  try {
    const balance = await readFluentTokenBalance(destinationClient, token, recipient);
    return balance > baseline
      ? { status: "landed", received: balance - baseline }
      : { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}
