/**
 * @vitest-environment jsdom
 *
 * The Transfer page a Two-step deposit opens on from its signature: a status row per leg,
 * the IDs as each leg produces them, and the Swap page one press away where the next move is
 * the person's. Opening the page lives in FluentWidgetContent.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FluentDepositSwap,
  FluentDepositSwapLeg,
  FluentDepositSwapState,
} from "../widget/hooks/useFluentDepositSwap";
import { DepositSwapActivityDetail } from "./DepositSwapActivityDetail";

const ACCOUNT = "0x92b70EDC8975E9Cac4dB54C75c136465817Bb8C7";
const SENDER = "0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df";
const DEPOSIT_TX = `0x${"a1b2".repeat(16)}` as const;
const SWAP_TX = `0x${"e5f6".repeat(16)}` as const;
const USER_OP = `0x${"c3d4".repeat(16)}` as const;
const STARTED_AT = Date.UTC(2026, 9, 28, 12);

const ETH = { symbol: "ETH", decimals: 18 };
const USDNR = { symbol: "USDnr", decimals: 6 };

const leg: FluentDepositSwapLeg = {
  from: { ...ETH, amount: 100_000_000_000_000n },
  to: { ...USDNR, amount: 230_512n },
  deposit: { sentHash: DEPOSIT_TX, startedAt: STARTED_AT },
};

function renderDetail(state: FluentDepositSwapState, { slow = false } = {}) {
  const onOpenSwapPage = vi.fn();
  const depositSwap: FluentDepositSwap = {
    state,
    slow,
    available: true,
    begin: () => true,
    run: async () => {},
    reset: () => {},
  };
  render(
    <DepositSwapActivityDetail
      depositSwap={depositSwap}
      account={ACCOUNT}
      network="mainnet"
      priceOf={() => undefined}
      track={() => {}}
      onOpenSwapPage={onOpenSwapPage}
    />,
  );
  return { onOpenSwapPage };
}

/** The value beside a row's label. */
function row(label: string) {
  return within(screen.getByText(label).parentElement!);
}

afterEach(cleanup);

describe("DepositSwapActivityDetail", () => {
  it("shows a deposit on its way as pending, with the swap waiting and the deposit's ID", () => {
    renderDetail({
      phase: "bridging",
      deposit: {
        sentHash: DEPOSIT_TX,
        sender: SENDER,
        from: ETH,
        to: USDNR,
        expected: 100_000_000_000_000n,
        startedAt: STARTED_AT,
      },
    });

    expect(row("Deposit").getByText("Pending")).toBeTruthy();
    expect(row("Swap").getByText("Waiting for the deposit")).toBeTruthy();
    expect(screen.getByText("0.0001 ETH → USDnr")).toBeTruthy();
    expect(screen.getByText("Deposit ID")).toBeTruthy();
    expect(screen.queryByText("Swap ID")).toBeNull();
    expect(screen.queryByRole("button", { name: /Swap page/ })).toBeNull();
  });

  it("shows a landed deposit whose swap is out, with what it is expected to receive", () => {
    renderDetail({ phase: "swapping", leg });

    expect(row("Deposit").getByText("Landed")).toBeTruthy();
    expect(row("Swap").getByText("Pending")).toBeTruthy();
    expect(screen.getByText("≈ +0.230512 USDnr")).toBeTruthy();
    expect(screen.getByText("Deposit ID")).toBeTruthy();
    expect(screen.queryByText("Swap ID")).toBeNull();
  });

  it("shows a settled swap as confirmed, with its transaction and operation", () => {
    renderDetail({ phase: "settled", leg, hash: SWAP_TX, userOpHash: USER_OP });

    expect(row("Swap").getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Swap ID")).toBeTruthy();
    expect(screen.getByText("Operation ID")).toBeTruthy();
  });

  it("sends a declined swap back to the Swap page to confirm it again", () => {
    const { onOpenSwapPage } = renderDetail({ phase: "declined", leg });

    expect(row("Swap").getByText("Waiting for you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Swap to USDnr" }));
    expect(onOpenSwapPage).toHaveBeenCalledOnce();
  });

  it("offers the Swap page for a deposit that is taking longer than usual", () => {
    renderDetail(
      {
        phase: "bridging",
        deposit: {
          sentHash: DEPOSIT_TX,
          sender: SENDER,
          from: ETH,
          to: USDNR,
          expected: 100_000_000_000_000n,
          startedAt: STARTED_AT,
        },
      },
      { slow: true },
    );

    expect(screen.getByText(/taking longer than usual/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the Swap page" })).toBeTruthy();
  });
});
