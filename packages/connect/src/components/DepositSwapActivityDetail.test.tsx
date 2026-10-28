/**
 * @vitest-environment jsdom
 *
 * The Transfer page a Two-step deposit's swap opens on once its review is confirmed: Pending
 * with no IDs while the swap is out, then how it ended. Opening it from the review lives in
 * FluentWidgetContent.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FluentDepositSwapLeg } from "../widget/hooks/useFluentDepositSwap";
import { DepositSwapActivityDetail } from "./FluentActivityDetail";

const ACCOUNT = "0x92b70EDC8975E9Cac4dB54C75c136465817Bb8C7";
const TX = `0x${"e5f6".repeat(16)}` as const;
const USER_OP = `0x${"c3d4".repeat(16)}` as const;

const leg: FluentDepositSwapLeg = {
  from: { symbol: "ETH", decimals: 18, amount: 100_000_000_000_000n },
  to: { symbol: "USDnr", decimals: 6, amount: 230_512n },
};

function renderDetail(state: Parameters<typeof DepositSwapActivityDetail>[0]["state"]) {
  render(
    <DepositSwapActivityDetail
      state={state}
      sentAt={Date.UTC(2026, 9, 28, 12)}
      account={ACCOUNT}
      network="mainnet"
      priceOf={() => undefined}
      track={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("DepositSwapActivityDetail", () => {
  it("shows a swap still out as pending, with what it is expected to receive and no IDs", () => {
    renderDetail({ phase: "swapping", leg });

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("≈ +0.230512 USDnr")).toBeTruthy();
    expect(screen.getByText(/0\.0001 ETH/)).toBeTruthy();
    expect(screen.queryByText("Transaction ID")).toBeNull();
    expect(screen.queryByText("Operation ID")).toBeNull();
  });

  it("shows a settled swap as confirmed, with its transaction and operation", () => {
    renderDetail({ phase: "settled", leg, hash: TX, userOpHash: USER_OP });

    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.getByText("Transaction ID")).toBeTruthy();
    expect(screen.getByText("Operation ID")).toBeTruthy();
  });

  it("shows why a swap that was sent did not confirm", () => {
    renderDetail({ phase: "unconfirmed", leg, message: "Check Activity before swapping again." });

    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("Check Activity before swapping again.")).toBeTruthy();
  });
});
