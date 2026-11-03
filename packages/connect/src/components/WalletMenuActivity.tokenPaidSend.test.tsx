/**
 * @vitest-environment jsdom
 *
 * An Activity row for a send whose gas was paid in a Gas token: the operation moved the token
 * sent and the fee, and the row is about the send. The fee is for the detail screen.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FluentTransactionHistoryEntry } from "../core/transactionHistory";
import { WalletMenuActivityList } from "./WalletMenuActivity";

const ACCOUNT = "0x00000000000000000000000000000000000000ab" as const;
const TX = "0x0000000000000000000000000000000000000000000000000000000000000002" as const;
const AT = Date.UTC(2026, 10, 3, 18, 15, 0);

// As `groupFluentTransactionHistory` orders them: the ETH that was sent, then the USDnr fee.
const SEND_PAID_IN_USDNR: FluentTransactionHistoryEntry = {
  kind: "operation",
  id: "operation:0xop",
  hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
  transactionHash: TX,
  status: "confirmed",
  timestamp: AT,
  movements: [
    {
      kind: "movement",
      id: "internal:1",
      hash: TX,
      direction: "sent",
      status: "confirmed",
      tokenIdentity: "25363:native",
      symbol: "ETH",
      amount: "0.0001",
      counterparty: "0x00000000000000000000000000000000000000dd",
      timestamp: AT,
    },
    {
      kind: "movement",
      id: "transfer:1",
      hash: TX,
      direction: "sent",
      status: "confirmed",
      tokenIdentity: "25363:0xd48e565561416de59da1050ed70b8d75e8ef28f9",
      symbol: "USDnr",
      amount: "0.000527",
      counterparty: "0x766362585c175D0f2983D8D193252E4a05Cd8077",
      timestamp: AT,
    },
  ],
};

afterEach(cleanup);

describe("WalletMenuActivity row of a send paid for in a Gas token", () => {
  it("draws the token sent, with its amount alone", () => {
    render(
      <WalletMenuActivityList
        fluent={{
          address: ACCOUNT,
          entries: [SEND_PAID_IN_USDNR],
          busy: false,
          loadingMore: false,
          hasMore: false,
          loadMore: () => {},
          error: null,
        }}
        bridge={null}
        onOpenBridgeRow={() => {}}
        onOpenFluentEntry={() => {}}
      />,
    );

    const row = screen.getByRole("button");
    // The ETH tile, not USDnr's purple one.
    expect(row.firstElementChild?.className).toContain("bg-[#627EEA]");
    expect(row.textContent).toContain("Sent");
    expect(screen.getByText("−0.0001 ETH")).toBeTruthy();
    expect(screen.queryByText(/USDnr/)).toBeNull();
  });
});
