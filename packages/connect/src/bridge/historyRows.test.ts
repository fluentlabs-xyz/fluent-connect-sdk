import { describe, expect, it } from "vitest";

import {
  groupRowsByDay,
  rowFromHyperlane,
  rowFromIndexer,
  rowFromOrder,
  rowTargetUrl,
  sortRows,
} from "./historyRows";
import type { HyperlaneTransfer } from "./hyperlaneHistory";
import type { OrderDeposit } from "./orderDepositApi";
import { getFluentBridgeRoute } from "./route";
import { getBridgeToken } from "./tokens";
import type { BridgeTxItem } from "./txHistory";

const route = getFluentBridgeRoute("mainnet")!;
const usdnr = getBridgeToken("mainnet", "USDnr");

const indexerItem: BridgeTxItem = {
  amount: "1000000000000000000",
  asset_type: "native",
  chain_id: "1",
  direction: "l1_to_l2",
  fee: "0",
  message_hash: "0x1111",
  nonce: "7",
  received_at: "2026-09-10T10:05:00Z",
  received_tx_hash: "0xbbbb",
  recipient: "0x92b70edc8975e9cac4db54c75c136465817bb8c7",
  sender: "0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df",
  sent_at: "2026-09-10T10:00:00Z",
  sent_tx_hash: "0xaaaa",
  status: "relayed",
  successful_call: true,
  token_symbol: "ETH",
  token_decimals: 18,
  transfer_type: "deposit",
  value: "1000000000000000000",
};

const hyperlaneTransfer: HyperlaneTransfer = {
  msgId: "45b3",
  originChainId: 1,
  destinationChainId: 25363,
  originTxHash: "0xcccc",
  destinationTxHash: "0xdddd",
  isDelivered: true,
  sentAt: "2026-09-15T19:16:11Z",
  amount: 1_000_000n,
};

/** An order as `getOrderDeposits` reads it from the list, which names no fill. */
const order: OrderDeposit = {
  orderId: "0x96200fe4d729350b4b84ad5f840946c82f44e064b6510b34bb7758749f1f4f5a",
  createdAt: 1794341939,
  originChainId: 1,
  destinationChainId: 25363,
  sender: "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df",
  tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tokenOut: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
  amountIn: 3_000_000n,
  amountOut: 2_000_000n,
  amountOutFilled: 0n,
  status: "open",
  openTxHash: "0x001c17cae0212556278b56782a3f5a39fad32b64689d377e6ac78999bccb719b",
};

describe("rowFromIndexer", () => {
  it("maps the indexer's statuses, including its misspelt one", () => {
    expect(rowFromIndexer(indexerItem).status).toBe("completed");
    expect(rowFromIndexer({ ...indexerItem, status: "unconrirmed" }).status).toBe("confirming");
    expect(rowFromIndexer({ ...indexerItem, status: "pending" }).status).toBe("pending");
    expect(rowFromIndexer({ ...indexerItem, status: "failed" }).status).toBe("failed");
  });

  it("treats an empty received hash as not yet arrived", () => {
    expect(rowFromIndexer({ ...indexerItem, received_tx_hash: "" }).receivedTxHash).toBeUndefined();
  });
});

describe("rowFromHyperlane", () => {
  it("labels the transfer with the fast-path token and its direction", () => {
    const row = rowFromHyperlane(hyperlaneTransfer, route, usdnr);
    expect(row).toMatchObject({
      source: "hyperlane",
      direction: "l1_to_l2",
      status: "completed",
      sentTxHash: "0xcccc",
      receivedTxHash: "0xdddd",
      tokenSymbol: "USDnr",
      decimals: 6,
      amount: 1_000_000n,
    });
  });

  it("hides the destination hash until the message is delivered", () => {
    const row = rowFromHyperlane({ ...hyperlaneTransfer, isDelivered: false }, route, usdnr);
    expect(row.status).toBe("pending");
    expect(row.receivedTxHash).toBeUndefined();
  });
});

describe("rowFromOrder", () => {
  it("lists an open order as a pending deposit of what the solver will pay", () => {
    expect(rowFromOrder(order, usdnr)).toEqual({
      id: `order:${order.orderId}`,
      source: "order",
      sentAt: "2026-11-10T20:18:59.000Z",
      status: "pending",
      direction: "l1_to_l2",
      sentTxHash: order.openTxHash,
      receivedTxHash: undefined,
      tokenSymbol: "USDnr",
      amount: 2_000_000n,
      decimals: 6,
    });
  });

  it("shows a filled order as completed and a cancelled one as failed", () => {
    expect(rowFromOrder({ ...order, status: "filled" }, usdnr)?.status).toBe("completed");
    expect(rowFromOrder({ ...order, status: "cancelled" }, usdnr)?.status).toBe("failed");
  });

  it("links the solver's transaction on Fluent once the order carries it", () => {
    const row = rowFromOrder({ ...order, status: "filled", fillTxHash: "0xdddd" }, usdnr)!;

    expect(rowTargetUrl(row, route)).toBe(
      `${route.destination.blockExplorers!.default.url}/tx/0xdddd`,
    );
  });

  it("has no row for an order whose opening transaction is not named", () => {
    expect(rowFromOrder({ ...order, openTxHash: undefined }, usdnr)).toBeUndefined();
  });
});

describe("rowTargetUrl", () => {
  it("links a deposit's arrival on Fluent", () => {
    const url = rowTargetUrl(rowFromHyperlane(hyperlaneTransfer, route, usdnr), route);
    expect(url).toBe(`${route.destination.blockExplorers!.default.url}/tx/0xdddd`);
  });

  it("has nothing to link while the transfer is in flight", () => {
    expect(
      rowTargetUrl(rowFromIndexer({ ...indexerItem, received_tx_hash: "" }), route),
    ).toBeUndefined();
  });
});

describe("sortRows", () => {
  it("interleaves both sources newest first", () => {
    const rows = sortRows([
      rowFromIndexer(indexerItem),
      rowFromHyperlane(hyperlaneTransfer, route, usdnr),
    ]);
    expect(rows.map((r) => r.source)).toEqual(["hyperlane", "indexer"]);
  });
});

describe("groupRowsByDay", () => {
  // 15 minutes apart at 09:30 UTC: no offset in [-12, +14] puts local midnight
  // between them, so the pair shares a day everywhere the tests run.
  const sentOn = (sent_at: string, sent_tx_hash: `0x${string}`) =>
    rowFromIndexer({ ...indexerItem, sent_at, sent_tx_hash });
  const rows = sortRows([
    sentOn("2026-09-10T09:30:00Z", "0x1"),
    sentOn("2026-09-11T09:30:00Z", "0x2"),
    sentOn("2026-09-10T09:45:00Z", "0x3"),
  ]);

  it("keeps each local day together, newest day first, rows in order", () => {
    const groups = groupRowsByDay(rows);
    expect(groups.map((g) => g.rows.length)).toEqual([1, 2]);
    expect(groups.flatMap((g) => g.rows)).toEqual(rows);
    expect(new Set(groups.map((g) => g.day.getTime())).size).toBe(2);
  });

  it("keys each group by that day's local midnight", () => {
    for (const group of groupRowsByDay(rows)) {
      const first = new Date(group.rows[0]!.sentAt);
      expect(group.day.toDateString()).toBe(first.toDateString());
      expect([group.day.getHours(), group.day.getMinutes()]).toEqual([0, 0]);
    }
  });

  it("returns nothing for no rows", () => {
    expect(groupRowsByDay([])).toEqual([]);
  });
});
