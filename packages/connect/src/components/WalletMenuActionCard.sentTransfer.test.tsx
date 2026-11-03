/**
 * @vitest-environment jsdom
 *
 * The Transfer page a Send opens on, as a swap opens on its own: the transfer the widget
 * holds, Pending until it is mined and Confirmed with its transaction after.
 *
 * Fakes: `fetch`, which no test here may reach.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WalletMenuActionCard } from "./WalletMenuActionCard";
import type { FluentWidgetConfig } from "../core/config";
import type { FluentPendingTransfer } from "../widget/tokenTransfer";
import { SENT_TRANSFER_TAB } from "../widget/walletMenuSubPages";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const RECIPIENT = "0x1ccF23916C572379630b067e9a0CbBddb56C5e72" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

const config: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

const sending: FluentPendingTransfer = {
  id: "pending-1",
  tokenIdentity: "usdnr",
  symbol: "USDnr",
  amount: "12.345678",
  to: RECIPIENT,
  startedAt: Date.UTC(2026, 10, 3, 9, 30),
};

function card(sentTransfer?: FluentPendingTransfer) {
  return (
    <WalletMenuActionCard
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={config}
      gasPaymentToken="USDnr"
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab={SENT_TRANSFER_TAB}
      onTabChange={() => {}}
      smartAccountAddress={SMART_ACCOUNT}
      sentTransfer={sentTransfer}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Transfer page of a Send", () => {
  it("shows the transfer as pending while it is not mined", () => {
    render(card(sending));

    expect(screen.getByText("−12.35 USDnr").getAttribute("title")).toBe("12.345678 USDnr");
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.queryByText("Transaction ID")).toBeNull();
  });

  it("confirms the transfer and names its transaction once it is mined", () => {
    const { rerender } = render(card(sending));
    rerender(card({ ...sending, hash: HASH }));

    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.getByText("Transaction ID")).toBeTruthy();
  });

  it("shows nothing when there is no transfer to show", () => {
    const { container } = render(card(undefined));

    expect(container.textContent).toBe("");
  });
});
