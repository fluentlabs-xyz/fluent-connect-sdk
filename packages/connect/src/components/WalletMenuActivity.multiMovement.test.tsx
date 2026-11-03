// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { FluentDisplayToken } from "@fluent.xyz/connect-sdk";
import { afterEach, describe, expect, it } from "vitest";

import type {
  FluentTransactionMovementEntry,
  FluentTransactionOperationEntry,
} from "../core/transactionHistory";
import { WalletMenuActivityList, type FluentActivityState } from "./WalletMenuActivity";

const account = "0x98a5000000000000000000000000000000009255" as const;
const recipient = "0x752b000000000000000000000000000000019ca0" as const;
const paymaster = "0x1111000000000000000000000000000000000001" as const;
const opHash = "0xae00000000000000000000000000000000000000000000000000000000000001" as const;

function movement(
  id: string,
  symbol: string,
  amount: string,
  counterparty: `0x${string}`,
): FluentTransactionMovementEntry {
  return {
    kind: "movement",
    id,
    hash: opHash,
    direction: "sent",
    status: "confirmed",
    tokenIdentity: `fluent:${symbol}`,
    symbol,
    amount,
    counterparty,
    timestamp: Date.now(),
  };
}

// A send of 1.11 USDnr whose fee was paid in BLEND: two outgoing movements in one operation.
const operation: FluentTransactionOperationEntry = {
  kind: "operation",
  id: `operation:${opHash}`,
  hash: opHash,
  transactionHash: opHash,
  status: "confirmed",
  timestamp: Date.now(),
  movements: [
    movement("fee", "BLEND", "0.011487", paymaster),
    movement("send", "USDnr", "1.11", recipient),
  ],
};

function fluent(entries: FluentActivityState["entries"]): FluentActivityState {
  return { address: account, entries, busy: false, loadingMore: false, hasMore: false, loadMore: () => {}, error: null };
}

// Only what the price lookup reads: a row's movement is matched to its price by symbol.
const tokens = ["USDnr", "BLEND"].map(
  (symbol) => ({ symbol, identity: `fluent:${symbol}` }) as FluentDisplayToken,
);

function renderList(usdPrices: Record<string, number>) {
  render(
    <WalletMenuActivityList
      fluent={fluent([operation])}
      bridge={null}
      usdPrices={usdPrices}
      tokens={tokens}
      onOpenBridgeRow={() => {}}
      onOpenFluentEntry={() => {}}
    />,
  );
  return screen.getByRole("button", { name: /Sent/ });
}

afterEach(cleanup);

describe("WalletMenuActivityList, an operation that moved several tokens", () => {
  it("prints only the movement worth the most, with its usd value", () => {
    const row = renderList({ "fluent:USDnr": 1, "fluent:BLEND": 0.05 });

    expect(within(row).getByTitle("1.11 USDnr")).toBeTruthy();
    expect(within(row).queryByTitle("0.011487 BLEND")).toBeNull();
    expect(within(row).getAllByText(/^\$/)).toHaveLength(1);
  });

  it("prints the first movement alone when no token has a price", () => {
    const row = renderList({});

    expect(within(row).getByTitle("0.011487 BLEND")).toBeTruthy();
    expect(within(row).queryByTitle("1.11 USDnr")).toBeNull();
  });
});
