import { afterEach, describe, expect, it, vi } from "vitest";

import { FLUENT_DECIMAL_SEPARATOR } from "../utils";
import {
  fetchFluentTransactionHistory,
  fetchFluentTransactionHistoryPage,
  filterFluentTransactionHistory,
  formatFluentTransactionAge,
  formatFluentTransactionAmount,
  groupFluentTransactionHistory,
  sortFluentTransactionHistory,
  type FluentTransactionHistoryEntry,
  type FluentTransactionMovementEntry,
} from "./transactionHistory";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ACCOUNT = "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df";
const EXPLORER = "https://fluentscan.xyz";
const PEER = "0x61ffc3DaF0534ad6e06411478C880e5249e0cA06";
const CHAIN_ID = 20993;
const USDNR = "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9";

function tokenTransfer(overrides: Record<string, unknown> = {}) {
  return {
    transaction_hash: "0xaaa1",
    log_index: 1,
    timestamp: "2026-09-29T13:27:18.000000Z",
    from: { hash: ACCOUNT },
    to: { hash: PEER },
    token: { symbol: "USDnr", address_hash: USDNR },
    total: { value: "2000000", decimals: "6" },
    ...overrides,
  };
}

function internalTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transaction_hash: "0xbbb1",
    index: 14,
    timestamp: "2026-09-29T13:27:18.000000Z",
    success: true,
    value: "734085017414669",
    from: { hash: PEER },
    to: { hash: ACCOUNT },
    ...overrides,
  };
}

function userOperation(overrides: Record<string, unknown> = {}) {
  return {
    hash: "0xopp1",
    transaction_hash: "0xccc1",
    timestamp: "2026-09-29T13:27:18.000000Z",
    status: true,
    ...overrides,
  };
}

type Source = "transfers" | "internals" | "operations";

function sourceOf(url: string): Source {
  if (url.includes("/token-transfers")) return "transfers";
  if (url.includes("/account-abstraction/operations")) return "operations";
  return "internals";
}

/** Answers the three endpoints by path, so a test only states what it cares about. */
function stubExplorer(pages: {
  transfers?: unknown[];
  internals?: unknown[];
  operations?: unknown[];
  /** `next_page_params` per source; absent means that source is exhausted. */
  next?: Partial<Record<Source, Record<string, string | number>>>;
}) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const source = sourceOf(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: pages[source] ?? [],
        next_page_params: pages.next?.[source] ?? null,
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The URL a stubbed run requested for one source. */
function urlFor(fetchMock: { mock: { calls: unknown[][] } }, source: Source) {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .find((url) => sourceOf(url) === source);
}

/** Narrows the union so a test can assert on amounts and symbols. */
function onlyMovements(entries: readonly FluentTransactionHistoryEntry[]) {
  return entries.filter(
    (entry): entry is FluentTransactionMovementEntry => entry.kind === "movement",
  );
}

function fetchHistory() {
  return fetchFluentTransactionHistory({
    address: ACCOUNT,
    explorerBaseUrl: EXPLORER,
    chainId: CHAIN_ID,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading history from the explorer", () => {
  it("asks the three Blockscout endpoints the screen mirrors, ERC-20 only", async () => {
    const fetchMock = stubExplorer({});
    await fetchHistory();

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(3);
    expect(urls).toContainEqual(
      `${EXPLORER}/api/v2/addresses/${ACCOUNT}/token-transfers?type=ERC-20`,
    );
    expect(urls).toContainEqual(
      `${EXPLORER}/api/v2/addresses/${ACCOUNT}/internal-transactions`,
    );
    // User operations are not address-scoped by path: the account is the sender.
    expect(urls).toContainEqual(
      `${EXPLORER}/api/v2/proxy/account-abstraction/operations?sender=${ACCOUNT}`,
    );
  });

  it("reads direction and counterparty from this account's point of view", async () => {
    stubExplorer({
      transfers: [
        tokenTransfer({ from: { hash: ACCOUNT }, to: { hash: PEER }, log_index: 1 }),
        tokenTransfer({ from: { hash: PEER }, to: { hash: ACCOUNT }, log_index: 2 }),
      ],
    });

    const [sent, received] = await fetchHistory();
    expect(sent).toMatchObject({ direction: "sent", counterparty: PEER, symbol: "USDnr" });
    expect(received).toMatchObject({ direction: "received", counterparty: PEER });
  });

  it("scales amounts by the decimals each source reports", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ total: { value: "2000000", decimals: "6" } })],
      internals: [internalTransaction({ value: "734085017414669" })],
    });

    const entries = onlyMovements(await fetchHistory());
    expect(entries.find((entry) => entry.symbol === "USDnr")?.amount).toBe("2");
    expect(entries.find((entry) => entry.symbol === "ETH")?.amount).toBe("0.000734085017414669");
  });

  // The account address is checksummed in our config but the explorer echoes its
  // own casing; comparing raw would make every row fall through as "neither side".
  it("matches addresses case-insensitively", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ from: { hash: ACCOUNT.toLowerCase() }, to: { hash: PEER } })],
    });
    expect((await fetchHistory())[0]).toMatchObject({ direction: "sent" });
  });

  it("marks a reverted internal call failed", async () => {
    stubExplorer({ internals: [internalTransaction({ success: false })] });
    expect((await fetchHistory())[0]!.status).toBe("failed");
  });

  // Contract plumbing the explorer lists because it happened, not because it
  // moved anything. Rows of "Received 0 ETH" would bury the real history.
  it("drops internal calls that move nothing", async () => {
    stubExplorer({ internals: [internalTransaction({ value: "0" }), internalTransaction()] });
    expect(await fetchHistory()).toHaveLength(1);
  });

  it("drops NFT transfers, which have no decimals to scale by", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ total: { token_id: "7", value: "1" } }), tokenTransfer()],
    });
    expect(await fetchHistory()).toHaveLength(1);
  });

  // A swap is one transaction and two movements, so the hash cannot key a row.
  it("keeps both movements of one transaction, under distinct ids", async () => {
    const hash = "0xc0ffee";
    stubExplorer({
      transfers: [tokenTransfer({ transaction_hash: hash })],
      internals: [internalTransaction({ transaction_hash: hash })],
    });

    const entries = await fetchHistory();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.hash === hash)).toBe(true);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("merges both sources newest first", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ timestamp: "2026-09-01T00:00:00.000000Z" })],
      internals: [internalTransaction({ timestamp: "2026-09-20T00:00:00.000000Z" })],
    });

    expect(onlyMovements(await fetchHistory()).map((entry) => entry.symbol)).toEqual([
      "ETH",
      "USDnr",
    ]);
  });

  it("returns everything a page holds, leaving the windowing to the caller", async () => {
    stubExplorer({
      transfers: Array.from({ length: 40 }, (_unused, index) =>
        tokenTransfer({ log_index: index }),
      ),
      internals: Array.from({ length: 40 }, (_unused, index) =>
        internalTransaction({ index }),
      ),
    });

    expect(await fetchHistory()).toHaveLength(80);
  });

  it("keeps an operation that moved nothing, which no other endpoint reports", async () => {
    stubExplorer({ operations: [userOperation({ hash: "0xop", transaction_hash: "0xtx" })] });

    const [entry] = await fetchHistory();
    expect(entry).toMatchObject({
      kind: "operation",
      hash: "0xop",
      transactionHash: "0xtx",
      status: "confirmed",
      movements: [],
    });
  });

  it("marks a reverted operation failed", async () => {
    stubExplorer({ operations: [userOperation({ status: false })] });
    expect((await fetchHistory())[0]!.status).toBe("failed");
  });

  // A smart account does everything through a user operation. Without grouping,
  // one swap prints as four rows sharing a timestamp.
  it("folds the movements of a transaction into the operation that caused them", async () => {
    const hash = "0xshared";
    stubExplorer({
      transfers: [
        tokenTransfer({ transaction_hash: hash, log_index: 1, token: { symbol: "BLEND" } }),
        tokenTransfer({
          transaction_hash: hash,
          log_index: 2,
          token: { symbol: "sBLEND" },
          from: { hash: PEER },
          to: { hash: ACCOUNT },
        }),
      ],
      internals: [internalTransaction({ transaction_hash: hash })],
      operations: [userOperation({ transaction_hash: hash })],
    });

    const entries = await fetchHistory();
    expect(entries).toHaveLength(1);
    const [operation] = entries;
    expect(operation!.kind).toBe("operation");
    expect(
      operation!.kind === "operation" ? operation!.movements.map((m) => m.symbol) : [],
    ).toEqual(["BLEND", "sBLEND", "ETH"]);
  });

  // The operation's movements share one truncating line, so leading with dust
  // would hide the amounts that matter behind the one that does not.
  it("orders an operation's dust last", async () => {
    const hash = "0xswap";
    stubExplorer({
      transfers: [
        tokenTransfer({
          transaction_hash: hash,
          log_index: 1,
          token: { symbol: "DUST" },
          total: { value: "30527113", decimals: "18" },
        }),
        tokenTransfer({
          transaction_hash: hash,
          log_index: 2,
          token: { symbol: "sBLEND" },
          total: { value: "104636754633424997", decimals: "18" },
        }),
      ],
      operations: [userOperation({ transaction_hash: hash })],
    });

    const [operation] = await fetchHistory();
    expect(
      operation!.kind === "operation" ? operation!.movements.map((m) => m.symbol) : [],
    ).toEqual(["sBLEND", "DUST"]);
  });

  it("matches that transaction case-insensitively too", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ transaction_hash: "0xABCDEF" })],
      operations: [userOperation({ transaction_hash: "0xabcdef" })],
    });

    const entries = await fetchHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind === "operation" && entries[0]!.movements).toHaveLength(1);
  });

  // An incoming transfer has no operation of this account behind it, so folding
  // must not swallow it.
  it("leaves a movement no operation claims as its own row", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ transaction_hash: "0xlonely" })],
      operations: [userOperation({ transaction_hash: "0xelsewhere" })],
    });

    const entries = await fetchHistory();
    expect(entries.map((entry) => entry.kind).sort()).toEqual(["movement", "operation"]);
  });

  // Half a history shown as if it were all of it is worse than saying so.
  it("fails rather than returning half the history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).includes("/internal-transactions")
          ? ({ ok: false, status: 502, json: async () => ({}) } as Response)
          : ({ ok: true, status: 200, json: async () => ({ items: [tokenTransfer()] }) } as Response),
      ),
    );

    await expect(fetchHistory()).rejects.toThrow(/502/);
  });
});

describe("filtering by the listed tokens", () => {
  const listed = (...identities: string[]) => identities.map((identity) => ({ identity }));

  function movement(
    tokenIdentity: string,
    overrides: Partial<FluentTransactionMovementEntry> = {},
  ) {
    return {
      kind: "movement",
      id: `transfer:0x1:${tokenIdentity}`,
      hash: "0x1",
      direction: "sent",
      status: "confirmed",
      tokenIdentity,
      symbol: "T",
      amount: "1",
      counterparty: PEER,
      timestamp: NOW,
      ...overrides,
    } as FluentTransactionMovementEntry;
  }

  function operation(movements: FluentTransactionMovementEntry[]) {
    return {
      kind: "operation",
      id: "operation:0xop",
      hash: "0xop",
      transactionHash: "0x1",
      status: "confirmed",
      timestamp: NOW,
      movements,
    } as FluentTransactionHistoryEntry;
  }

  it("keeps movements in a listed token and drops the rest", () => {
    const kept = movement("1:0xaaa");
    const dropped = movement("1:0xbbb");

    expect(filterFluentTransactionHistory([kept, dropped], listed("1:0xaaa"))).toEqual([kept]);
  });

  // The trap CONTEXT.md names: a hand-added token can call itself USDnr, and
  // matching on the label would pull the real one's history into its place.
  it("matches on identity, not on symbol", () => {
    const real = movement("1:0xreal", { symbol: "USDnr" });
    const impostor = movement("1:0xfake", { symbol: "USDnr" });

    expect(filterFluentTransactionHistory([real, impostor], listed("1:0xreal"))).toEqual([real]);
  });

  it("narrows an operation to its listed movements", () => {
    const kept = movement("1:0xaaa");
    const filtered = filterFluentTransactionHistory(
      [operation([kept, movement("1:0xbbb")])],
      listed("1:0xaaa"),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind === "operation" && filtered[0]!.movements).toEqual([kept]);
  });

  it("drops an operation once none of its movements are listed", () => {
    expect(
      filterFluentTransactionHistory([operation([movement("1:0xbbb")])], listed("1:0xaaa")),
    ).toEqual([]);
  });

  // An approval is account activity, not activity in a token, so no token list
  // can make it irrelevant.
  it("keeps an operation that moved nothing", () => {
    const bare = operation([]);
    expect(filterFluentTransactionHistory([bare], listed("1:0xaaa"))).toEqual([bare]);
  });

  it("hides everything when nothing is listed", () => {
    expect(filterFluentTransactionHistory([movement("1:0xaaa")], [])).toEqual([]);
  });
});

describe("token identity on fetched rows", () => {
  it("identifies a transfer by its contract and a native move by the chain", async () => {
    stubExplorer({ transfers: [tokenTransfer()], internals: [internalTransaction()] });
    const entries = onlyMovements(await fetchHistory());

    expect(entries.find((entry) => entry.symbol === "USDnr")?.tokenIdentity).toBe(
      `${CHAIN_ID}:${USDNR.toLowerCase()}`,
    );
    expect(entries.find((entry) => entry.symbol === "ETH")?.tokenIdentity).toBe(
      `${CHAIN_ID}:native`,
    );
  });

  // Matching is case-sensitive on the identity string, and the explorer
  // checksums addresses while our token defaults are lower-cased.
  it("lower-cases the contract so the identity matches the token list's", async () => {
    stubExplorer({
      transfers: [tokenTransfer({ token: { symbol: "USDnr", address_hash: USDNR.toUpperCase() } })],
    });

    expect(onlyMovements(await fetchHistory())[0]!.tokenIdentity).toBe(
      `${CHAIN_ID}:${USDNR.toLowerCase()}`,
    );
  });
});

describe("paging", () => {
  function fetchPage(cursor?: Parameters<typeof fetchFluentTransactionHistoryPage>[0]["cursor"]) {
    return fetchFluentTransactionHistoryPage({
      address: ACCOUNT,
      explorerBaseUrl: EXPLORER,
      chainId: CHAIN_ID,
      nativeSymbol: "ETH",
      nativeDecimals: 18,
      cursor,
    });
  }

  it("reports no cursor once every source is exhausted", async () => {
    stubExplorer({ transfers: [tokenTransfer()] });
    expect((await fetchPage()).cursor).toBeNull();
  });

  it("carries each source's own cursor shape back out", async () => {
    stubExplorer({
      next: {
        transfers: { index: 3, block_number: 38683098 },
        operations: { page_size: 50, page_token: "11504972,0xabc" },
      },
    });

    expect((await fetchPage()).cursor).toEqual({
      transfers: { index: 3, block_number: 38683098 },
      internals: null,
      operations: { page_size: 50, page_token: "11504972,0xabc" },
    });
  });

  it("sends a cursor back as query params, alongside the source's own filters", async () => {
    const fetchMock = stubExplorer({});
    await fetchPage({
      transfers: { index: 3, block_number: 38683098 },
      internals: null,
      operations: null,
    });

    const url = new URL(urlFor(fetchMock, "transfers")!);
    expect(url.searchParams.get("block_number")).toBe("38683098");
    expect(url.searchParams.get("index")).toBe("3");
    // The cursor must not displace the ERC-20 filter, or page two would start
    // including the NFT transfers page one excluded.
    expect(url.searchParams.get("type")).toBe("ERC-20");
  });

  it("stops asking a source that has run out", async () => {
    const fetchMock = stubExplorer({});
    await fetchPage({ transfers: { index: 3 }, internals: null, operations: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlFor(fetchMock, "internals")).toBeUndefined();
    expect(urlFor(fetchMock, "operations")).toBeUndefined();
  });

  // The whole reason paging returns the two kinds apart: an operation and the
  // transfer it caused can straddle a page boundary, and grouping page-by-page
  // would strand them as two rows that never reunite.
  it("groups an operation with a movement that arrived on a later page", async () => {
    stubExplorer({
      operations: [userOperation({ transaction_hash: "0xlate" })],
      next: { transfers: { index: 1 } },
    });
    const first = await fetchPage();

    stubExplorer({ transfers: [tokenTransfer({ transaction_hash: "0xlate" })] });
    const second = await fetchPage(first.cursor);

    const grouped = groupFluentTransactionHistory({
      operations: [...first.operations, ...second.operations],
      movements: [...first.movements, ...second.movements],
    });

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.kind === "operation" && grouped[0]!.movements).toHaveLength(1);
  });
});

describe("ordering", () => {
  const entry = (id: string, timestamp: number) =>
    ({ kind: "movement", id, timestamp }) as FluentTransactionHistoryEntry;

  it("breaks timestamp ties deterministically, so merge order cannot decide it", () => {
    const sorted = sortFluentTransactionHistory([
      entry("internal:0x1:2", NOW),
      entry("transfer:0x1:1", NOW),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["internal:0x1:2", "transfer:0x1:1"]);
  });
});

describe("transaction amounts", () => {
  it("signs by direction rather than by the stored amount", () => {
    expect(
      formatFluentTransactionAmount({ amount: "250", direction: "received", symbol: "USDnr" }),
    ).toBe("+250 USDnr");
    expect(
      formatFluentTransactionAmount({ amount: "250", direction: "sent", symbol: "USDnr" }),
    ).toBe("−250 USDnr");
  });

  // The same typographic minus the portfolio pnl uses, not the ASCII hyphen: the
  // two sit one above the other once a row is open.
  it("uses a typographic minus", () => {
    const sent = formatFluentTransactionAmount({
      amount: "1",
      direction: "sent",
      symbol: "ETH",
    });
    expect(sent.startsWith("−")).toBe(true);
    expect(sent.startsWith("-")).toBe(false);
  });

  it("formats with the locale's separators, like every other amount the widget shows", () => {
    expect(
      formatFluentTransactionAmount({ amount: "1200.5", direction: "sent", symbol: "USDnr" }),
    ).toBe(`−1,200${FLUENT_DECIMAL_SEPARATOR}5 USDnr`);
  });

  // Token amounts arrive as decimal strings so precision survives the trip;
  // rounding to two places would print a real transfer as `0.00 ETH`.
  it("keeps small amounts visible", () => {
    expect(
      formatFluentTransactionAmount({ amount: "0.000045", direction: "sent", symbol: "ETH" }),
    ).toBe(`−0${FLUENT_DECIMAL_SEPARATOR}000045 ETH`);
  });

  // Live testnet BLEND transfers really are this small. Six decimal places
  // would render each of them as `+0 BLEND`.
  it("marks dust rather than rounding it away to zero", () => {
    expect(
      formatFluentTransactionAmount({
        amount: "0.000000000052524167",
        direction: "received",
        symbol: "BLEND",
      }),
    ).toBe(`+<0${FLUENT_DECIMAL_SEPARATOR}000001 BLEND`);
  });

  it("still prints a real zero as zero", () => {
    expect(
      formatFluentTransactionAmount({ amount: "0", direction: "received", symbol: "ETH" }),
    ).toBe("+0 ETH");
  });
});

describe("transaction age", () => {
  it("collapses the first minute", () => {
    expect(formatFluentTransactionAge(NOW - 40 * 1000, NOW)).toBe("Just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(formatFluentTransactionAge(NOW - 18 * MINUTE, NOW)).toBe("18m ago");
    expect(formatFluentTransactionAge(NOW - 5 * HOUR, NOW)).toBe("5h ago");
    expect(formatFluentTransactionAge(NOW - 4 * DAY, NOW)).toBe("4d ago");
  });

  it("switches to a date once nobody counts the days any more", () => {
    expect(formatFluentTransactionAge(NOW - 21 * DAY, NOW)).not.toMatch(/ago$/);
  });

  // Each unit's last moment still belongs to that unit, so no row can read "60m
  // ago" or "24h ago".
  it("hands over at the unit boundary", () => {
    expect(formatFluentTransactionAge(NOW - (HOUR - 1), NOW)).toBe("59m ago");
    expect(formatFluentTransactionAge(NOW - HOUR, NOW)).toBe("1h ago");
    expect(formatFluentTransactionAge(NOW - (DAY - 1), NOW)).toBe("23h ago");
    expect(formatFluentTransactionAge(NOW - DAY, NOW)).toBe("1d ago");
  });
});
