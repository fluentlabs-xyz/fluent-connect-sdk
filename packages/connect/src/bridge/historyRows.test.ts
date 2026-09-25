import { describe, expect, it } from "vitest";

import { rowFromHyperlane, rowFromIndexer, rowTargetUrl, sortRows } from "./historyRows";
import type { HyperlaneTransfer } from "./hyperlaneHistory";
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

describe("rowTargetUrl", () => {
  it("links a deposit's arrival on Fluent", () => {
    const url = rowTargetUrl(rowFromHyperlane(hyperlaneTransfer, route, usdnr), route);
    expect(url).toBe(`${route.destination.blockExplorers!.default.url}/tx/0xdddd`);
  });

  it("has nothing to link while the transfer is in flight", () => {
    expect(rowTargetUrl(rowFromIndexer({ ...indexerItem, received_tx_hash: "" }), route)).toBeUndefined();
  });
});

describe("sortRows", () => {
  it("interleaves both sources newest first", () => {
    const rows = sortRows([rowFromIndexer(indexerItem), rowFromHyperlane(hyperlaneTransfer, route, usdnr)]);
    expect(rows.map((r) => r.source)).toEqual(["hyperlane", "indexer"]);
  });
});
