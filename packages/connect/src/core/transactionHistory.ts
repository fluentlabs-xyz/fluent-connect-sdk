import { fluentTokenIdentity, type FluentDisplayToken } from "@fluent.xyz/connect-sdk";
import { formatUnits } from "viem";

import {
  FLUENT_AMOUNT_LOCALE,
  FLUENT_DECIMAL_SEPARATOR,
  formatFluentLocaleAmount,
} from "../utils";

/**
 * A row in the account's history, read from FluentScan.
 *
 * Two shapes, because the explorer answers two different kinds of question. A
 * movement is a balance change with an amount and a counterparty. An operation
 * is something the smart account did — a user operation — which may have moved
 * nothing at all. Forcing the second into the first's fields would mean
 * inventing an amount for it.
 */
export type FluentTransactionHistoryEntry =
  | FluentTransactionMovementEntry
  | FluentTransactionOperationEntry;

type FluentTransactionEntryBase = {
  /** Unique per row. The hash is not: one transaction can produce several rows. */
  id: string;
  status: FluentTransactionStatus;
  /** When it was mined, in unix milliseconds. */
  timestamp: number;
};

export type FluentTransactionMovementEntry = FluentTransactionEntryBase & {
  kind: "movement";
  /** The transaction that moved the value. */
  hash: `0x${string}`;
  direction: FluentTransactionDirection;
  /**
   * `fluentTokenIdentity` for the token that moved, so a row can be matched
   * against the Display tokens. Keyed on identity and never on `symbol`: two
   * tokens may call themselves the same thing.
   */
  tokenIdentity: string;
  symbol: string;
  /** Decimal amount, unsigned: `direction` carries the sign. */
  amount: string;
  /** The other side of the movement — who it went to, or who it came from. */
  counterparty: `0x${string}`;
};

export type FluentTransactionOperationEntry = FluentTransactionEntryBase & {
  kind: "operation";
  /** The user-operation hash, which has its own explorer page — not a tx hash. */
  hash: `0x${string}`;
  /** The transaction that carried this operation on-chain. */
  transactionHash: `0x${string}`;
  /**
   * The balance changes this operation caused, in the order the endpoints
   * reported them (token transfers first, then internal calls). Empty for an
   * operation that moved nothing, such as an approval.
   */
  movements: readonly FluentTransactionMovementEntry[];
};

/** A user operation before its movements have been attached to it. */
type UngroupedOperation = Omit<FluentTransactionOperationEntry, "movements">;

export type FluentTransactionDirection = "sent" | "received";

/**
 * Only settled states: every endpoint below answers about mined transactions,
 * so nothing here is ever in flight.
 */
export type FluentTransactionStatus = "confirmed" | "failed";

export const FLUENT_TRANSACTION_DIRECTION_LABELS: Record<FluentTransactionDirection, string> = {
  sent: "Sent",
  received: "Received",
};

export const FLUENT_TRANSACTION_STATUS_LABELS: Record<FluentTransactionStatus, string | null> = {
  // A confirmed transaction is the ordinary case and says nothing worth a badge.
  confirmed: null,
  failed: "Failed",
};

/**
 * How many rows the screen reveals at a time. Independent of the network page
 * size: Blockscout hands back 50 rows per source per request whatever we ask,
 * so one request already covers several screenfuls. Scrolling walks through
 * what has been fetched first and only then asks for more.
 */
export const FLUENT_TRANSACTION_HISTORY_PAGE_SIZE = 25;

/**
 * FluentScan runs Blockscout, whose v2 API is served from the explorer origin.
 * These are the three tabs the screen mirrors: `?tab=token_transfers`,
 * `?tab=internal_txns` and `?tab=user_ops`.
 */
function blockscoutApiUrl(
  explorerBaseUrl: string,
  path: string,
  params?: BlockscoutPageParams,
) {
  const url = new URL(`${explorerBaseUrl.replace(/\/+$/, "")}/api/v2${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Blockscout's cursor: an opaque bag of query params it hands back as
 * `next_page_params` and expects returned verbatim. The keys differ per
 * endpoint — block/index for the address tabs, a page token for the
 * account-abstraction proxy — so nothing here reads them.
 */
export type BlockscoutPageParams = Record<string, string | number | boolean>;

/**
 * Where each of the three sources got to. They run out at different times, so
 * one cursor per source rather than one for the merged list; a source whose
 * entry is null is finished and stops being asked.
 */
export type FluentTransactionHistoryCursor = {
  transfers: BlockscoutPageParams | null;
  internals: BlockscoutPageParams | null;
  operations: BlockscoutPageParams | null;
};

type BlockscoutAddressRef = { hash?: string | null } | null | undefined;

type BlockscoutTokenTransfer = {
  transaction_hash?: string | null;
  log_index?: number | null;
  timestamp?: string | null;
  from?: BlockscoutAddressRef;
  to?: BlockscoutAddressRef;
  token?: { symbol?: string | null; address_hash?: string | null } | null;
  total?: { value?: string | null; decimals?: string | null } | null;
};

type BlockscoutInternalTransaction = {
  transaction_hash?: string | null;
  index?: number | null;
  timestamp?: string | null;
  success?: boolean | null;
  value?: string | null;
  from?: BlockscoutAddressRef;
  to?: BlockscoutAddressRef;
};

type BlockscoutUserOperation = {
  /** The user-operation hash. */
  hash?: string | null;
  transaction_hash?: string | null;
  timestamp?: string | null;
  status?: boolean | null;
};

type BlockscoutPage<T> = { items?: T[] | null; next_page_params?: BlockscoutPageParams | null };

type FetchedPage<T> = { items: T[]; nextPageParams: BlockscoutPageParams | null };

/** A source that is already exhausted, so its slot resolves without a request. */
const EXHAUSTED_PAGE = { items: [], nextPageParams: null };

async function fetchBlockscoutPage<T>(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedPage<T>> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    throw new Error(`FluentScan request failed: ${response.status}`);
  }
  const payload = (await response.json()) as BlockscoutPage<T>;
  return { items: payload.items ?? [], nextPageParams: payload.next_page_params ?? null };
}

function sameAddress(left: string | null | undefined, right: string) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/**
 * Which way the money went, from this account's point of view. A transfer whose
 * sender is the account is "sent" even when it is also the recipient, so a
 * self-transfer reads as one row rather than contradicting itself.
 */
function resolveMovement(params: {
  from: BlockscoutAddressRef;
  to: BlockscoutAddressRef;
  account: string;
}) {
  const { from, to, account } = params;
  const fromHash = from?.hash ?? null;
  const toHash = to?.hash ?? null;

  if (sameAddress(fromHash, account)) {
    return { direction: "sent" as const, counterparty: toHash };
  }
  if (sameAddress(toHash, account)) {
    return { direction: "received" as const, counterparty: fromHash };
  }
  // Neither side is this account: the endpoints are address-scoped, so this only
  // happens on a shape we did not expect. Drop the row rather than guess.
  return null;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function mapTokenTransfer(
  transfer: BlockscoutTokenTransfer,
  params: { account: string; chainId: number },
): FluentTransactionMovementEntry | null {
  const { account, chainId } = params;
  const hash = transfer.transaction_hash;
  const value = transfer.total?.value;
  const timestamp = parseTimestamp(transfer.timestamp);
  const symbol = transfer.token?.symbol;
  if (!hash || !value || !symbol || timestamp === null) return null;

  // NFT transfers come back with a `token_id` and no `decimals`; this screen is
  // about amounts, so they are not rows it can draw. Tested for presence before
  // conversion: `Number(undefined ?? "")` is 0, which is a legitimate decimals
  // value and would let every NFT through as a whole-number amount.
  const rawDecimals = transfer.total?.decimals;
  if (rawDecimals === null || rawDecimals === undefined) return null;
  const decimals = Number(rawDecimals);
  if (!Number.isInteger(decimals) || decimals < 0) return null;

  const movement = resolveMovement({ from: transfer.from, to: transfer.to, account });
  if (!movement?.counterparty) return null;

  return {
    kind: "movement",
    id: `transfer:${hash}:${transfer.log_index ?? 0}`,
    hash: hash as `0x${string}`,
    direction: movement.direction,
    // The endpoint only lists transfers that were actually emitted, so a row
    // reaching here succeeded.
    status: "confirmed",
    tokenIdentity: fluentTokenIdentity({
      chainId,
      address: (transfer.token?.address_hash ?? undefined) as `0x${string}` | undefined,
    }),
    symbol,
    amount: formatUnits(BigInt(value), decimals),
    counterparty: movement.counterparty as `0x${string}`,
    timestamp,
  };
}

function mapInternalTransaction(
  internal: BlockscoutInternalTransaction,
  params: { account: string; chainId: number; nativeSymbol: string; nativeDecimals: number },
): FluentTransactionMovementEntry | null {
  const { account, chainId, nativeSymbol, nativeDecimals } = params;
  const hash = internal.transaction_hash;
  const timestamp = parseTimestamp(internal.timestamp);
  if (!hash || timestamp === null) return null;

  // Most internal calls move nothing — contract-to-contract plumbing that the
  // explorer lists because it happened, not because it changed a balance. A
  // history of "Received 0 ETH" is noise, so only value-bearing calls are rows.
  let value: bigint;
  try {
    value = BigInt(internal.value ?? "0");
  } catch {
    return null;
  }
  if (value === 0n) return null;

  const movement = resolveMovement({ from: internal.from, to: internal.to, account });
  if (!movement?.counterparty) return null;

  return {
    kind: "movement",
    id: `internal:${hash}:${internal.index ?? 0}`,
    hash: hash as `0x${string}`,
    direction: movement.direction,
    status: internal.success === false ? "failed" : "confirmed",
    // An internal call moves the chain's own currency, never a contract token.
    tokenIdentity: fluentTokenIdentity({ chainId, native: true }),
    symbol: nativeSymbol,
    amount: formatUnits(value, nativeDecimals),
    counterparty: movement.counterparty as `0x${string}`,
    timestamp,
  };
}

function mapUserOperation(operation: BlockscoutUserOperation): UngroupedOperation | null {
  const hash = operation.hash;
  const transactionHash = operation.transaction_hash;
  const timestamp = parseTimestamp(operation.timestamp);
  if (!hash || !transactionHash || timestamp === null) return null;

  return {
    kind: "operation",
    id: `operation:${hash}`,
    hash: hash as `0x${string}`,
    transactionHash: transactionHash as `0x${string}`,
    status: operation.status === false ? "failed" : "confirmed",
    timestamp,
  };
}

export type FluentTransactionHistoryPage = {
  movements: FluentTransactionMovementEntry[];
  operations: UngroupedOperation[];
  /** Where to resume, or null once every source is exhausted. */
  cursor: FluentTransactionHistoryCursor | null;
};

/**
 * One page of this account's token transfers, internal transactions and user
 * operations.
 *
 * Deliberately returns the two kinds apart and ungrouped. An operation's
 * movements can land on a later page than the operation itself, so grouping has
 * to run over everything fetched so far rather than page by page — see
 * `groupFluentTransactionHistory`, which the caller applies to the accumulation.
 *
 * Every source still in play is fetched together and none is allowed to fail
 * quietly: a history silently missing part of what happened is worse than one
 * that says it could not load.
 */
export async function fetchFluentTransactionHistoryPage(params: {
  address: string;
  /** The explorer origin, e.g. `https://fluentscan.xyz`. */
  explorerBaseUrl: string;
  /** Half of a Token identity, so rows can be matched against Display tokens. */
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Omitted for the first page. */
  cursor?: FluentTransactionHistoryCursor | null;
  signal?: AbortSignal;
}): Promise<FluentTransactionHistoryPage> {
  const { address, explorerBaseUrl, chainId, nativeSymbol, nativeDecimals, cursor, signal } =
    params;
  const first = !cursor;

  const [transfers, internals, operations] = await Promise.all([
    first || cursor.transfers
      ? fetchBlockscoutPage<BlockscoutTokenTransfer>(
          blockscoutApiUrl(explorerBaseUrl, `/addresses/${address}/token-transfers`, {
            type: "ERC-20",
            ...(cursor?.transfers ?? {}),
          }),
          signal,
        )
      : EXHAUSTED_PAGE,
    first || cursor.internals
      ? fetchBlockscoutPage<BlockscoutInternalTransaction>(
          blockscoutApiUrl(explorerBaseUrl, `/addresses/${address}/internal-transactions`, {
            ...(cursor?.internals ?? {}),
          }),
          signal,
        )
      : EXHAUSTED_PAGE,
    first || cursor.operations
      ? fetchBlockscoutPage<BlockscoutUserOperation>(
          blockscoutApiUrl(explorerBaseUrl, "/proxy/account-abstraction/operations", {
            sender: address,
            ...(cursor?.operations ?? {}),
          }),
          signal,
        )
      : EXHAUSTED_PAGE,
  ]);

  const nextCursor: FluentTransactionHistoryCursor = {
    transfers: transfers.nextPageParams,
    internals: internals.nextPageParams,
    operations: operations.nextPageParams,
  };
  const exhausted =
    !nextCursor.transfers && !nextCursor.internals && !nextCursor.operations;

  return {
    movements: [
      ...transfers.items.map((transfer) =>
        mapTokenTransfer(transfer, { account: address, chainId }),
      ),
      ...internals.items.map((internal) =>
        mapInternalTransaction(internal, {
          account: address,
          chainId,
          nativeSymbol,
          nativeDecimals,
        }),
      ),
    ].filter((entry): entry is FluentTransactionMovementEntry => entry !== null),
    operations: operations.items
      .map(mapUserOperation)
      .filter((operation): operation is UngroupedOperation => operation !== null),
    cursor: exhausted ? null : nextCursor,
  };
}

/** The first page, grouped and sorted — the whole history when it fits in one. */
export async function fetchFluentTransactionHistory(
  params: Parameters<typeof fetchFluentTransactionHistoryPage>[0],
): Promise<FluentTransactionHistoryEntry[]> {
  const page = await fetchFluentTransactionHistoryPage(params);
  return sortFluentTransactionHistory(groupFluentTransactionHistory(page));
}

/**
 * One row per action.
 *
 * A smart account does everything through a user operation, so the movements an
 * operation caused belong to it rather than beside it: listing both would print
 * a single swap as four rows sharing one timestamp, with a bare "Operation"
 * among them adding nothing. Movements no operation claims — an incoming
 * transfer, anything an external wallet did — stay rows of their own.
 */
export function groupFluentTransactionHistory(params: {
  operations: readonly UngroupedOperation[];
  movements: readonly FluentTransactionMovementEntry[];
}): FluentTransactionHistoryEntry[] {
  const { operations, movements } = params;

  const movementsByTransaction = new Map<string, FluentTransactionMovementEntry[]>();
  for (const movement of movements) {
    const key = movement.hash.toLowerCase();
    const group = movementsByTransaction.get(key);
    if (group) group.push(movement);
    else movementsByTransaction.set(key, [movement]);
  }

  const claimed = new Set(
    operations.map((operation) => operation.transactionHash.toLowerCase()),
  );

  return [
    ...operations.map((operation) => ({
      ...operation,
      movements: orderOperationMovements(
        movementsByTransaction.get(operation.transactionHash.toLowerCase()) ?? [],
      ),
    })),
    ...movements.filter((movement) => !claimed.has(movement.hash.toLowerCase())),
  ];
}

/**
 * Dust last. An operation's movements share one line that truncates, and a swap
 * routed through a rebasing token leads with a sub-display-threshold amount —
 * so in API order the one part of the row guaranteed to survive truncation is
 * the one part that says nothing. Stable otherwise, keeping the reported order.
 */
function orderOperationMovements(movements: readonly FluentTransactionMovementEntry[]) {
  return [...movements].sort(
    (left, right) =>
      Number(isFluentDustAmount(left.amount)) - Number(isFluentDustAmount(right.amount)),
  );
}

/**
 * Narrows the history to the tokens this person lists.
 *
 * Matched on Token identity, never on symbol — a hand-added token calling
 * itself USDnr must not pull the real one's transfers into view, or drop out of
 * its own. An operation keeps only its matching movements and disappears once
 * none are left, because at that point it is entirely about tokens this person
 * does not track. An operation that moved nothing at all survives: an approval
 * is account activity, not activity in some token.
 */
export function filterFluentTransactionHistory(
  entries: readonly FluentTransactionHistoryEntry[],
  tokens: readonly Pick<FluentDisplayToken, "identity">[],
): FluentTransactionHistoryEntry[] {
  const listed = new Set(tokens.map((token) => token.identity));

  return entries.flatMap<FluentTransactionHistoryEntry>((entry) => {
    if (entry.kind === "movement") {
      return listed.has(entry.tokenIdentity) ? [entry] : [];
    }
    if (entry.movements.length === 0) return [entry];

    const movements = entry.movements.filter((movement) => listed.has(movement.tokenIdentity));
    return movements.length > 0 ? [{ ...entry, movements }] : [];
  });
}

/**
 * Newest first, with `id` breaking ties: the endpoints are merged and one block
 * timestamp covers every movement in it, so without a tiebreak the order of
 * equal-timestamped rows would depend on fetch order.
 */
export function sortFluentTransactionHistory(
  entries: readonly FluentTransactionHistoryEntry[],
): FluentTransactionHistoryEntry[] {
  return [...entries].sort(
    (left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id),
  );
}

const AMOUNT_FRACTION_DIGITS = 6;
const SMALLEST_SHOWN_AMOUNT = 10 ** -AMOUNT_FRACTION_DIGITS;

/**
 * True when an amount really moved but is too small to print at the precision
 * a row uses. Not the same as zero, and not the same as small.
 */
export function isFluentDustAmount(amount: string): boolean {
  const numeric = Number(amount);
  return Number.isFinite(numeric) && numeric > 0 && numeric < SMALLEST_SHOWN_AMOUNT;
}

/** `+250 USDnr` / `−0.045 ETH`, with the same typographic minus the portfolio pnl uses. */
export function formatFluentTransactionAmount(
  entry: Pick<FluentTransactionMovementEntry, "amount" | "direction" | "symbol">,
): string {
  const sign = entry.direction === "sent" ? "−" : "+";

  // Dust is still a movement. Rounding it to six places would print a real
  // transfer as `+0 BLEND`, which reads as "nothing happened" — and on a token
  // with 18 decimals that is a whole class of rows.
  if (isFluentDustAmount(entry.amount)) {
    return `${sign}<0${FLUENT_DECIMAL_SEPARATOR}000001 ${entry.symbol}`;
  }

  return `${sign}${formatFluentLocaleAmount(entry.amount, AMOUNT_FRACTION_DIGITS)} ${entry.symbol}`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago a transaction happened, in the shortest form that still says it:
 * minutes for the last hour, then hours, then days, and a date once "N days ago"
 * stops being something anyone counts.
 */
export function formatFluentTransactionAge(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return new Date(timestamp).toLocaleDateString(FLUENT_AMOUNT_LOCALE, {
    month: "short",
    day: "numeric",
  });
}
