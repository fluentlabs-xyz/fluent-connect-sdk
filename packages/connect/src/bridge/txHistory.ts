import { useInfiniteQuery } from "@tanstack/react-query";
import type { Address, Hash } from "viem";

/**
 * The bridge indexer — the same `indexer/v1/transactions` the Portal reads for
 * its transfer history. It is the authority on whether a deposit actually landed:
 * a balance that went up only says *something* arrived, this says which transfer
 * did, and whether the relay succeeded or failed.
 *
 * Shapes mirror the Portal's `getTxHistory.ts`; only the fields this SDK reads
 * are typed, the rest of the payload is passed through untouched.
 *
 * `address` filters on the **sender** — checked against the live payload: every
 * item comes back with `sender` equal to the queried address while `recipient`
 * varies. So the address to ask about is the wallet that signs deposits, not the
 * Fluent ID they are credited to.
 */
export const FLUENT_BRIDGE_INDEXER_URLS = {
  testnet: "https://api.gblend.xyz",
  mainnet: "https://api.fluent.xyz",
} as const;

export type BridgeTxStatus = "unconrirmed" | "relayed" | "pending" | "failed";

export type BridgeTxItem = {
  amount: string;
  asset_type: "native" | "token" | "erc721" | "erc1155" | "unknown";
  chain_id: string;
  direction: "l1_to_l2" | "l2_to_l1";
  fee: string;
  message_hash: Hash;
  /** Numeric, but serialised as a string by the indexer. */
  nonce: string;
  received_at: string;
  /** Empty until the relay lands the transfer on the other side. */
  received_tx_hash?: Hash | "";
  recipient: Address;
  sender: Address;
  sent_at: string;
  sent_tx_hash: Hash;
  status: BridgeTxStatus;
  successful_call: boolean;
  token_decimals?: number;
  token_symbol?: string;
  transfer_type: "deposit" | "withdrawal";
  value: string;
};

export type BridgeTxHistory = {
  has_more: boolean;
  limit: number;
  offset: number;
  next_offset?: number;
  l1_required_confirmations: number;
  l2_required_confirmations: number;
  items: BridgeTxItem[];
};

export function getBridgeIndexerUrl(network: "testnet" | "mainnet"): string {
  return FLUENT_BRIDGE_INDEXER_URLS[network];
}

export async function getBridgeTransactions({
  baseUrl,
  address,
  limit = 20,
  offset = 0,
  signal,
}: {
  baseUrl: string;
  address: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<BridgeTxHistory> {
  const query = new URLSearchParams({
    address,
    limit: String(limit),
    offset: String(offset),
  });

  const response = await fetch(`${baseUrl}/indexer/v1/transactions?${query}`, { signal });
  if (!response.ok) {
    throw new Error(
      (await response.text().catch(() => "")) || "Failed to read bridge transactions",
    );
  }

  return (await response.json()) as BridgeTxHistory;
}

/** The indexer entry for one deposit, matched on the transaction that sent it. */
export function findBridgeTxBySentHash(
  history: BridgeTxHistory,
  sentTxHash: Hash,
): BridgeTxItem | undefined {
  const target = sentTxHash.toLowerCase();
  return history.items.find((item) => item.sent_tx_hash?.toLowerCase() === target);
}

/** One page of the history list. */
export const BRIDGE_TX_HISTORY_PAGE_SIZE = 10;

/**
 * The connected wallet's bridge history, ten transfers at a time, on the app's
 * QueryClient. `next_offset` from the indexer drives the next page; `has_more`
 * says when there is none.
 */
export function useBridgeTxHistoryPages({
  baseUrl,
  address,
  pageSize = BRIDGE_TX_HISTORY_PAGE_SIZE,
}: {
  baseUrl: string;
  address?: Address;
  pageSize?: number;
}) {
  return useInfiniteQuery({
    queryKey: ["fluent-bridge-tx-history", baseUrl, address, pageSize],
    queryFn: ({ pageParam, signal }) =>
      getBridgeTransactions({
        baseUrl,
        address: address!,
        limit: pageSize,
        offset: pageParam,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.has_more ? (last.next_offset ?? last.offset + last.limit) : undefined,
    enabled: Boolean(address),
    staleTime: 15_000,
  });
}
