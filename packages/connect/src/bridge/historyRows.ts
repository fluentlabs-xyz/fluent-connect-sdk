import type { Address, Hash } from "viem";

import type { HyperlaneTransfer } from "./hyperlaneHistory";
import type { FluentBridgeRoute } from "./route";
import type { BridgeToken } from "./tokens";
import type { BridgeTxItem } from "./txHistory";

export type BridgeHistoryStatus = "completed" | "pending" | "confirming" | "failed";

/**
 * One transfer as the history list shows it, whichever system recorded it: the
 * canonical bridge indexer (ETH, BLEND) or the Hyperlane explorer (USDnr over
 * the fast path). The two agree on what a row needs — when it left, the hash
 * that delivered it, how it ended — and on nothing else, so they meet here.
 * A Deposit the widget saw signed is a third source, until the indexer lists it.
 */
export type BridgeHistoryRow = {
  id: string;
  source: "indexer" | "hyperlane" | "widget";
  sentAt: string;
  status: BridgeHistoryStatus;
  direction: "l1_to_l2" | "l2_to_l1";
  sentTxHash: string;
  /** Present once the transfer has landed on the target chain. */
  receivedTxHash?: string;
  tokenSymbol?: string;
  amount?: bigint;
  decimals?: number;
};

/** A row the user opened from the list, with the wallet it was listed for. */
export type BridgeActivitySelection = { row: BridgeHistoryRow; account: string };

const INDEXER_STATUS: Record<BridgeTxItem["status"], BridgeHistoryStatus> = {
  relayed: "completed",
  pending: "pending",
  // The indexer's own spelling — a fresh transfer still waiting for confirmations.
  unconrirmed: "confirming",
  failed: "failed",
};

export function rowFromIndexer(item: BridgeTxItem): BridgeHistoryRow {
  return {
    id: `indexer:${item.sent_tx_hash}:${item.nonce ?? ""}`,
    source: "indexer",
    sentAt: item.sent_at,
    status: INDEXER_STATUS[item.status] ?? "pending",
    direction: item.direction,
    sentTxHash: item.sent_tx_hash,
    receivedTxHash: item.received_tx_hash || undefined,
    tokenSymbol: item.token_symbol,
    amount: item.amount ? BigInt(item.amount) : undefined,
    decimals: item.token_decimals,
  };
}

/**
 * A Deposit signed on the Bridge page, as the widget recorded it at the signature. The indexer
 * lists a deposit only once it has seen the transaction, and the Bridge page that follows it
 * may be gone by then, so the widget keeps this until the indexer's row for the same hash
 * takes over.
 */
export type SentBridgeDeposit = {
  sentTxHash: Hash;
  /** The External wallet that signed it: the indexer lists deposits by sender. */
  sender: Address;
  tokenSymbol: string;
  /** In the Delivered token's smallest unit. */
  amount: bigint;
  decimals: number;
  /** ISO 8601, like the indexer's `sent_at`. */
  sentAt: string;
};

export function rowFromSentDeposit(deposit: SentBridgeDeposit): BridgeHistoryRow {
  return {
    id: `widget:${deposit.sentTxHash}`,
    source: "widget",
    sentAt: deposit.sentAt,
    status: "pending",
    direction: "l1_to_l2",
    sentTxHash: deposit.sentTxHash,
    tokenSymbol: deposit.tokenSymbol,
    amount: deposit.amount,
    decimals: deposit.decimals,
  };
}

/** Whether a row still has an outcome to wait for. */
export function rowInFlight(row: BridgeHistoryRow): boolean {
  return row.status === "pending" || row.status === "confirming";
}

export function rowFromHyperlane(
  transfer: HyperlaneTransfer,
  route: FluentBridgeRoute,
  token?: BridgeToken,
): BridgeHistoryRow {
  return {
    id: `hyperlane:${transfer.msgId}`,
    source: "hyperlane",
    sentAt: transfer.sentAt,
    status: transfer.isDelivered ? "completed" : "pending",
    direction: transfer.originChainId === route.source.id ? "l1_to_l2" : "l2_to_l1",
    sentTxHash: transfer.originTxHash ?? transfer.msgId,
    receivedTxHash: transfer.isDelivered ? transfer.destinationTxHash : undefined,
    tokenSymbol: token?.symbol,
    amount: transfer.amount,
    decimals: token?.decimals,
  };
}

/** Explorer link for the row's arrival on the target chain, once it has one. */
export function rowTargetUrl(row: BridgeHistoryRow, route: FluentBridgeRoute): string | undefined {
  if (!row.receivedTxHash) return undefined;
  // A deposit lands on Fluent, a withdrawal lands back on L1.
  const chain = row.direction === "l1_to_l2" ? route.destination : route.source;
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${row.receivedTxHash}` : undefined;
}

/** Newest first, whichever system a row came from. */
/** Explorer link for the transaction the user signed, on the chain it left from. */
export function rowSentUrl(row: BridgeHistoryRow, route: FluentBridgeRoute): string | undefined {
  const chain = row.direction === "l1_to_l2" ? route.source : route.destination;
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${row.sentTxHash}` : undefined;
}

/** What the list calls a transfer: deposits land on Fluent, withdrawals leave it. */
export function rowTitle(row: BridgeHistoryRow): string {
  return row.direction === "l1_to_l2" ? "Bridge deposit" : "Bridge withdrawal";
}

export function sortRows(rows: BridgeHistoryRow[]): BridgeHistoryRow[] {
  return [...rows].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

/**
 * Runs of consecutive rows that left on the same local calendar day, in the
 * order given — meant for `sortRows` output, where that puts each day together
 * once. `day` is local midnight, for a heading to format; rows keep their times.
 */
export function groupRowsByDay(
  rows: BridgeHistoryRow[],
): { day: Date; rows: BridgeHistoryRow[] }[] {
  const groups: { day: Date; rows: BridgeHistoryRow[] }[] = [];
  for (const row of rows) {
    const sent = new Date(row.sentAt);
    const day = new Date(sent.getFullYear(), sent.getMonth(), sent.getDate());
    const last = groups[groups.length - 1];
    if (last && last.day.getTime() === day.getTime()) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}
