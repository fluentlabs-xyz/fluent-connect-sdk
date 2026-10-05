/**
 * @vitest-environment jsdom
 *
 * The Settings screen's one status line. The controller reporting a failed
 * settings read is only half the fix: a message nothing renders is a message
 * nobody reads, so the card is mounted here for real rather than trusted.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WalletMenuActionCard } from "./WalletMenuActionCard";
import type { FluentWidgetConfig } from "../core/config";

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  // The families request needs a session and a tab nothing here opens; off, so
  // this test makes no request at all.
  reputationEnabled: false,
  disableAnalytics: true,
};

function renderSettings(props?: { settingsError?: string | null }) {
  return render(
    <WalletMenuActionCard
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={CONFIG}
      gasPaymentToken="ETH"
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab="settings"
      onTabChange={() => {}}
      settingsError={props?.settingsError ?? null}
    />,
  );
}

afterEach(cleanup);

describe("WalletMenuActionCard: the Settings status line", () => {
  it("renders the message a failed settings read reports", () => {
    renderSettings({ settingsError: "Could not reach Fluent Connect." });

    expect(screen.getByRole("status").textContent).toBe("Could not reach Fluent Connect.");
  });

  it("shows no status line when there is nothing to report", () => {
    renderSettings();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still shows the Quick sign switch in the position it was given", () => {
    renderSettings({ settingsError: "Could not reach Fluent Connect." });

    // The panel is not replaced by the error: the person can still see, and
    // change, the preference the read failed to load.
    const quickSign = screen.getByRole("switch", { name: /quick sign/i });
    expect(quickSign.getAttribute("aria-checked")).toBe("false");
  });
});
