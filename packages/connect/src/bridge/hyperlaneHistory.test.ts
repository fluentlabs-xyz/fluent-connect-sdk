import { afterEach, describe, expect, it, vi } from "vitest";

import { getHyperlaneTransfers } from "./hyperlaneHistory";
import { getFluentBridgeRoute } from "./route";
import { getBridgeToken } from "./tokens";

const route = getFluentBridgeRoute("mainnet")!;
const usdnr = getBridgeToken("mainnet", "USDnr");
const wallet = "0x8077c0aa108B77A4c0848471B88f97f4fB8fA4Df" as const;

// Two rows as the explorer returned them for this wallet: a USDnr fast-path
// deposit to Fluent, and a Sepolia test transfer on a route the widget does
// not offer.
const fastPathRow = {
  msg_id: "\\x45b3762501cfb29c1b066010af76ee937447466a69aa10ce0dbd8d05fa4126a3",
  origin_chain_id: 1,
  destination_chain_id: 25363,
  origin_tx_hash: "\\x06f5fa5252cd6725cdd157e2961c2d343e98e8e289b5797c7086a4d381915570",
  destination_tx_hash: "\\x6aa21c29b95139abbce19ac5f7d728ff0d7bd23fb76339cf4dfc9f677771c37c",
  is_delivered: true,
  send_occurred_at: "2026-09-15T19:16:11",
  delivery_occurred_at: "2026-09-15T19:19:20",
  message_body:
    "\\x0000006313000000000000000000000000fcc1d596ad6cab0b5394eaa447d8626813180f3235cb26daeda92fb528ef6bdbc3f63bc85cb28aa89c777505eb462550c6fc35b50000000000000000000000fee226849d000000000000000000000000000f4240000000000000000000000000d48e565561416de59da1050ed70b8d75e8ef28f90000000000000000000000008077c0aa108b77a4c0848471b88f97f4fb8fa4df00000000000000000000000092b70edc8975e9cac4db54c75c136465817bb8c7",
};

const foreignRow = {
  msg_id: "\\x1e889f2744e2da700c89379cfd508b2b1fafa0c210894bd46676cf97b711d1b4",
  origin_chain_id: 421614,
  destination_chain_id: 11155111,
  origin_tx_hash: "\\xa2b52d1d8d55414d6f6d7ff327a4cddda525645dacaaf371732458e2d2e3d931",
  destination_tx_hash: "\\xbb6aba11d591140f46fb3573e62e7c6fbe4a5eb7be0f2aa922f7947ac58eec25",
  is_delivered: true,
  send_occurred_at: "2026-09-09T18:05:44",
  delivery_occurred_at: "2026-09-09T18:06:00",
  message_body:
    "\\x0000000000000000000000008077c0aa108b77a4c0848471b88f97f4fb8fa4df00000000000000000000000000000000000000000000000000038d7ea4c68000",
};

function mockGraphql(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHyperlaneTransfers", () => {
  it("asks the explorer for the wallet as a bytea sender", async () => {
    const fetchMock = mockGraphql({ data: { message_view: [] } });

    await getHyperlaneTransfers({ address: wallet, route, token: usdnr });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { variables: { originTxSenders: string[] } };
    expect(payload.variables.originTxSenders).toEqual(["\\x8077c0aa108b77a4c0848471b88f97f4fb8fa4df"]);
  });

  it("reads a fast-path deposit: hashes, UTC time, and the USDnr amount", async () => {
    mockGraphql({ data: { message_view: [fastPathRow] } });

    const [transfer] = await getHyperlaneTransfers({ address: wallet, route, token: usdnr });

    expect(transfer).toMatchObject({
      msgId: "45b3762501cfb29c1b066010af76ee937447466a69aa10ce0dbd8d05fa4126a3",
      originChainId: 1,
      destinationChainId: 25363,
      originTxHash: "0x06f5fa5252cd6725cdd157e2961c2d343e98e8e289b5797c7086a4d381915570",
      destinationTxHash: "0x6aa21c29b95139abbce19ac5f7d728ff0d7bd23fb76339cf4dfc9f677771c37c",
      isDelivered: true,
      sentAt: "2026-09-15T19:16:11Z",
      deliveredAt: "2026-09-15T19:19:20Z",
    });
    // 1 USDnr, six decimals.
    expect(transfer?.amount).toBe(1_000_000n);
  });

  it("keeps only messages between Ethereum and Fluent", async () => {
    mockGraphql({ data: { message_view: [foreignRow, fastPathRow] } });

    const transfers = await getHyperlaneTransfers({ address: wallet, route, token: usdnr });

    expect(transfers.map((t) => t.originChainId)).toEqual([1]);
  });

  it("falls back to the TokenMessage layout when the fast-path token is absent", async () => {
    mockGraphql({ data: { message_view: [{ ...foreignRow, origin_chain_id: 1, destination_chain_id: 25363 }] } });

    const [transfer] = await getHyperlaneTransfers({ address: wallet, route });

    expect(transfer?.amount).toBe(BigInt("0x38d7ea4c68000"));
  });

  it("surfaces GraphQL errors instead of an empty list", async () => {
    mockGraphql({ errors: [{ message: "field origin_tx_sender not found" }] });

    await expect(getHyperlaneTransfers({ address: wallet, route, token: usdnr })).rejects.toThrow(
      "field origin_tx_sender not found",
    );
  });
});
