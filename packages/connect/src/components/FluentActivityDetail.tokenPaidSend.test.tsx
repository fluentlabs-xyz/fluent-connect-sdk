/**
 * @vitest-environment jsdom
 *
 * The Transfer page of a send whose gas was paid in a Gas token: the operation moved what was
 * sent and the fee, and the page heads with the send alone, as the Activity row does, listing
 * the fee on a Fee row rather than beside the send in the heading.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  FluentTransactionMovementEntry,
  FluentTransactionOperationEntry,
} from "../core/transactionHistory";
import { FluentActivityDetail } from "./FluentActivityDetail";

const ACCOUNT = "0x98a5000000000000000000000000000000009255" as const;
const RECIPIENT = "0x752b000000000000000000000000000000019ca0" as const;
const PAYMASTER = "0x1111000000000000000000000000000000000001" as const;
const OP_HASH = "0x9629000000000000000000000000000000000000000000000000000000000a47c" as const;
const TX = "0x5413000000000000000000000000000000000000000000000000000000000db05" as const;
const AT = Date.UTC(2026, 10, 5, 11, 28);

function movement(
  id: string,
  amount: string,
  counterparty: `0x${string}`,
): FluentTransactionMovementEntry {
  return {
    kind: "movement",
    id,
    hash: TX,
    direction: "sent",
    status: "confirmed",
    tokenIdentity: "fluent:USDnr",
    symbol: "USDnr",
    amount,
    counterparty,
    timestamp: AT,
  };
}

// A send of 1 USDnr that paid its fee in USDnr too: two outgoing movements of one token, the
// fee listed first so the heading is known to pick by worth rather than by position.
const SEND_PAID_IN_USDNR: FluentTransactionOperationEntry = {
  kind: "operation",
  id: `operation:${OP_HASH}`,
  hash: OP_HASH,
  transactionHash: TX,
  status: "confirmed",
  timestamp: AT,
  movements: [movement("fee", "0.0006", PAYMASTER), movement("send", "1", RECIPIENT)],
};

/** The value beside a row's label. */
function row(label: string) {
  return within(screen.getByText(label).parentElement!);
}

afterEach(cleanup);

describe("FluentActivityDetail of a send paid for in a Gas token", () => {
  it("heads with the send alone and lists the fee on a Fee row", () => {
    render(
      <FluentActivityDetail
        selection={{ entry: SEND_PAID_IN_USDNR, account: ACCOUNT }}
        network="mainnet"
        priceOf={({ symbol }) => (symbol === "USDnr" ? 1 : undefined)}
        track={() => {}}
      />,
    );

    const heading = screen.getByTitle("1 USDnr");
    expect(heading.textContent).toBe("−1 USDnr");
    // The USD line under it is the send's alone.
    expect(heading.parentElement!.nextElementSibling!.textContent).toBe("$1");

    const fee = row("Fee");
    expect(fee.getByTitle("0.0006 USDnr").textContent).toBe("<0.01 USDnr · $0.0006");
  });
});
