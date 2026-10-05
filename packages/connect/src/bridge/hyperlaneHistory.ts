import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import type { FluentBridgeRoute } from "./route";
import type { BridgeToken } from "./tokens";

/**
 * Transfers that never touch the canonical bridge — USDnr over the fast path
 * rides Hyperlane — so `indexer/v1/transactions` has no record of them. The
 * Hyperlane explorer does: its `message_view` is keyed by the wallet that sent
 * the message. Trimmed from the Portal's `hyperlaneHistory.ts` to the one route
 * this widget offers, Ethereum ↔ Fluent.
 */
const HYPERLANE_GRAPHQL_ENDPOINT = "https://api.hyperlane.xyz/v1/graphql";
const HYPERLANE_HISTORY_LIMIT = 25;

type HyperlaneMessageView = {
  msg_id: string;
  /** Hyperlane domains. For Ethereum and Fluent they equal the chain ids. */
  origin_chain_id: number;
  destination_chain_id: number;
  origin_tx_hash?: string | null;
  destination_tx_hash?: string | null;
  is_delivered: boolean;
  send_occurred_at: string;
  delivery_occurred_at?: string | null;
  message_body?: string | null;
};

export type HyperlaneTransfer = {
  msgId: string;
  originChainId: number;
  destinationChainId: number;
  originTxHash?: `0x${string}`;
  destinationTxHash?: `0x${string}`;
  isDelivered: boolean;
  sentAt: string;
  deliveredAt?: string;
  /** In the token's smallest unit; absent when the body could not be read. */
  amount?: bigint;
};

/** Postgres `bytea` comes back as `\\x…`; addresses go in the same way. */
function toBytea(address: Address): string {
  return `\\x${address.slice(2).toLowerCase()}`;
}

function fromBytea(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.startsWith("\\x") ? value.slice(2).toLowerCase() : value.replace(/^0x/, "").toLowerCase();
}

function toTxHash(value?: string | null): `0x${string}` | undefined {
  const hex = fromBytea(value);
  return hex ? `0x${hex}` : undefined;
}

// Hyperlane timestamps are UTC but may arrive without the suffix.
function toUtc(value?: string | null): string | undefined {
  if (!value) return undefined;
  return /[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

/** Standard Hyperlane TokenMessage: recipient word, then amount word. */
function parseWarpAmount(bodyHex: string): bigint | undefined {
  return bodyHex.length >= 128 ? BigInt(`0x${bodyHex.slice(64, 128)}`) : undefined;
}

/**
 * The fast-path portal uses its own body, not TokenMessage. The amount is the
 * word right before the padded token address; when that word packs two uint128
 * values, the amount is the low half. Lifted from the Portal.
 */
function parseFastPathAmount(bodyHex: string, tokenAddress: Address): bigint | undefined {
  const paddedToken = `${"0".repeat(24)}${tokenAddress.slice(2).toLowerCase()}`;
  const tokenIndex = bodyHex.indexOf(paddedToken);
  if (tokenIndex < 64) return undefined;

  const word = bodyHex.slice(tokenIndex - 64, tokenIndex);
  const high = BigInt(`0x${word.slice(0, 32)}`);
  const low = BigInt(`0x${word.slice(32)}`);
  if (high > 0n && low > 0n) return low;

  const amount = BigInt(`0x${word}`);
  return amount > 0n ? amount : undefined;
}

export async function getHyperlaneTransfers({
  address,
  route,
  token,
  signal,
}: {
  address: Address;
  route: FluentBridgeRoute;
  /** The token that rides Hyperlane on this route — its L1 address keys the body parser. */
  token?: BridgeToken;
  signal?: AbortSignal;
}): Promise<HyperlaneTransfer[]> {
  const response = await fetch(HYPERLANE_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      query: `
        query WalletHistory($originTxSenders: [bytea!]!, $limit: Int!) {
          message_view(
            limit: $limit
            order_by: { send_occurred_at: desc }
            where: { origin_tx_sender: { _in: $originTxSenders } }
          ) {
            msg_id
            origin_chain_id
            destination_chain_id
            origin_tx_hash
            destination_tx_hash
            is_delivered
            send_occurred_at
            delivery_occurred_at
            message_body
          }
        }
      `,
      variables: { originTxSenders: [toBytea(address)], limit: HYPERLANE_HISTORY_LIMIT },
    }),
  });

  const payload = (await response.json()) as {
    data?: { message_view?: HyperlaneMessageView[] };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || "Failed to read Hyperlane transfers");
  }

  const ours = new Set([route.source.id, route.destination.id]);
  const seen = new Map<string, HyperlaneTransfer>();

  for (const item of payload.data?.message_view ?? []) {
    // Only the pair this widget bridges. Fluent's and Ethereum's domains equal
    // their chain ids, so no domain table is needed for this route.
    if (!ours.has(item.origin_chain_id) || !ours.has(item.destination_chain_id)) continue;
    if (item.origin_chain_id === item.destination_chain_id) continue;

    const bodyHex = fromBytea(item.message_body);
    const amount = bodyHex
      ? (token?.l1Address ? parseFastPathAmount(bodyHex, token.l1Address) : undefined) ??
        parseWarpAmount(bodyHex)
      : undefined;

    const msgId = fromBytea(item.msg_id) ?? item.msg_id;
    seen.set(msgId, {
      msgId,
      originChainId: item.origin_chain_id,
      destinationChainId: item.destination_chain_id,
      originTxHash: toTxHash(item.origin_tx_hash),
      destinationTxHash: toTxHash(item.destination_tx_hash),
      isDelivered: item.is_delivered,
      sentAt: toUtc(item.send_occurred_at) ?? item.send_occurred_at,
      deliveredAt: toUtc(item.delivery_occurred_at),
      amount,
    });
  }

  return [...seen.values()];
}

export function useHyperlaneTransfers({
  address,
  route,
  token,
}: {
  address?: Address;
  route: FluentBridgeRoute;
  token?: BridgeToken;
}) {
  return useQuery({
    queryKey: ["fluent-bridge-hyperlane-history", route.source.id, route.destination.id, address],
    queryFn: ({ signal }) => getHyperlaneTransfers({ address: address!, route, token, signal }),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
}
