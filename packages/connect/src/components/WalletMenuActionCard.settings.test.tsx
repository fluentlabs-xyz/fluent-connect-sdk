/**
 * @vitest-environment jsdom
 *
 * The Settings screen's one status line, and what it says about a preference
 * the connected account cannot have. The controller reporting a failed settings
 * read is only half the fix: a message nothing renders is a message nobody
 * reads, so the card is mounted here for real rather than trusted.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WalletMenuActionCard, type FluentSettingsPasskey } from "./WalletMenuActionCard";
import type { FluentWidgetConfig } from "../core/config";
import type { FluentAccountType } from "../widget/batchOperation";

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  // The families request needs a session and a tab nothing here opens; off, so
  // this test makes no request at all.
  reputationEnabled: false,
  disableAnalytics: true,
};

const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;
const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;

function renderSettings(props?: {
  settingsError?: string | null;
  accountKind?: FluentAccountType;
  connectedAddress?: string;
  smartAccountAddress?: string;
  gasPaymentToken?: string;
  silentSigningEnabled?: boolean;
  onAddPasskey?: () => Promise<void>;
  onRemovePasskey?: (credentialId: string) => Promise<void>;
  passkeys?: readonly FluentSettingsPasskey[];
}) {
  return render(
    <WalletMenuActionCard
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={CONFIG}
      gasPaymentToken={props?.gasPaymentToken ?? "ETH"}
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={props?.silentSigningEnabled ?? false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab="settings"
      onTabChange={() => {}}
      settingsError={props?.settingsError ?? null}
      accountKind={props?.accountKind}
      connectedAddress={props?.connectedAddress}
      smartAccountAddress={props?.smartAccountAddress}
      onAddPasskey={props?.onAddPasskey}
      onRemovePasskey={props?.onRemovePasskey}
      passkeys={props?.passkeys}
    />,
  );
}

const quickSignSwitch = () => screen.getByRole("switch", { name: /quick sign/i });
const gasPaymentSelect = () => screen.getByRole("combobox", { name: /gas payment/i });
/** Quick sign is a span with `aria-disabled`, Gas payment a real disabled button. */
const isDisabled = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled");

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
    const quickSign = quickSignSwitch();
    expect(quickSign.getAttribute("aria-checked")).toBe("false");
  });
});

describe("WalletMenuActionCard: Settings for an external wallet", () => {
  const AVAILABLE_WITH_SMART = "Available with a Fluent smart account";

  it("offers neither preference, and says why", () => {
    renderSettings({ accountKind: "eoa", connectedAddress: EXTERNAL_WALLET });

    expect(screen.getAllByText(AVAILABLE_WITH_SMART)).toHaveLength(2);
    expect(screen.queryByText(/sign transactions without a confirmation popup/i)).toBeNull();
    expect(screen.queryByText(/token used to pay transaction fees/i)).toBeNull();
    expect(isDisabled(quickSignSwitch())).toBe(true);
    expect(isDisabled(gasPaymentSelect())).toBe(true);
  });

  it("shows Quick sign off, whatever the widget is holding", () => {
    // The complaint this screen answers: a switch standing on reads as "your
    // transactions are signed without a popup", and an external wallet confirms
    // every one of them in the wallet.
    renderSettings({
      accountKind: "eoa",
      connectedAddress: EXTERNAL_WALLET,
      silentSigningEnabled: true,
    });

    expect(quickSignSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("shows the native gas token, whatever the App configured", () => {
    // An external wallet pays the chain's own gas on every call, so a stored or
    // configured USDnr under a disabled selector would name a token no fee of
    // theirs is ever charged to.
    renderSettings({
      accountKind: "eoa",
      connectedAddress: EXTERNAL_WALLET,
      gasPaymentToken: "USDnr",
    });

    expect(gasPaymentSelect().textContent).toContain("ETH");
  });

  it("hides the faucet, which funds a Fluent smart account", () => {
    renderSettings({ accountKind: "eoa", connectedAddress: EXTERNAL_WALLET });

    expect(screen.queryByText("Faucet")).toBeNull();
    expect(screen.queryByText(/connect fluent id first/i)).toBeNull();
  });

  it("sends Explorer to the EOA's own address", () => {
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string | URL) => {
      opened.push(String(url));
      return null;
    });
    try {
      renderSettings({ accountKind: "eoa", connectedAddress: EXTERNAL_WALLET });

      const explorer = screen.getByText("View account on explorer");
      expect(screen.queryByText("View Kernel smart wallet")).toBeNull();
      explorer.click();

      expect(opened).toHaveLength(1);
      expect(opened[0]).toContain(EXTERNAL_WALLET);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("WalletMenuActionCard: Settings for a Fluent ID", () => {
  it("offers both preferences, the faucet and the smart account's explorer link", () => {
    renderSettings({
      accountKind: "smart",
      connectedAddress: SMART_ACCOUNT,
      smartAccountAddress: SMART_ACCOUNT,
      silentSigningEnabled: true,
      gasPaymentToken: "USDnr",
    });

    expect(screen.queryByText(/available with a fluent smart account/i)).toBeNull();
    expect(screen.getByText(/sign transactions without a confirmation popup/i)).toBeTruthy();
    expect(screen.getByText(/token used to pay transaction fees/i)).toBeTruthy();
    expect(quickSignSwitch().getAttribute("aria-checked")).toBe("true");
    expect(isDisabled(quickSignSwitch())).toBe(false);
    expect(isDisabled(gasPaymentSelect())).toBe(false);
    expect(gasPaymentSelect().textContent).toContain("USDnr");
    expect(screen.getByText("Faucet")).toBeTruthy();
    expect(screen.getByText("View Kernel smart wallet")).toBeTruthy();
  });

  it("reads the same way with no account kind given, as the harnesses mount it", () => {
    renderSettings({ smartAccountAddress: SMART_ACCOUNT, connectedAddress: SMART_ACCOUNT });

    expect(screen.queryByText(/available with a fluent smart account/i)).toBeNull();
    expect(screen.getByText("Faucet")).toBeTruthy();
    expect(screen.getByText("View Kernel smart wallet")).toBeTruthy();
  });
});

describe("WalletMenuActionCard: Add passkey", () => {
  it("offers no Security section without a handler, as the harnesses mount it", () => {
    renderSettings({ accountKind: "smart", smartAccountAddress: SMART_ACCOUNT });

    expect(screen.queryByText("Security")).toBeNull();
    expect(screen.queryByText("Add passkey")).toBeNull();
  });

  it("registers the passkey the row was given", async () => {
    const onAddPasskey = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey,
    });

    expect(screen.getByText("Sign in without X next time")).toBeTruthy();
    screen.getByText("Add passkey").click();

    await waitFor(() => expect(onAddPasskey).toHaveBeenCalledTimes(1));
    // Settled: the row is back to its resting label, not stuck on the wait.
    await screen.findByText("Add passkey");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists the passkeys that are already there, above the Add row", () => {
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey: () => Promise.resolve(),
      onRemovePasskey: () => Promise.resolve(),
      passkeys: [
        { credentialId: "cred-1", label: "iCloud Keychain", addedOn: "Oct 15, 2026" },
        { credentialId: "cred-2", label: "Chrome on Mac OS X" },
      ],
    });

    expect(screen.getByText("iCloud Keychain")).toBeTruthy();
    expect(screen.getByText("Added Oct 15, 2026")).toBeTruthy();
    expect(screen.getByText("Chrome on Mac OS X")).toBeTruthy();
    expect(screen.getByText("Add passkey")).toBeTruthy();
    expect(screen.getByText("Add another for a different device")).toBeTruthy();
  });

  it("removes the passkey whose row was asked, by its credential id", async () => {
    const onRemovePasskey = vi.fn<(credentialId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey: () => Promise.resolve(),
      onRemovePasskey,
      passkeys: [
        { credentialId: "cred-1", label: "iCloud Keychain" },
        { credentialId: "cred-2", label: "Chrome on Mac OS X" },
      ],
    });

    screen.getByRole("button", { name: "Remove passkey: Chrome on Mac OS X" }).click();

    await waitFor(() => expect(onRemovePasskey).toHaveBeenCalledTimes(1));
    expect(onRemovePasskey).toHaveBeenCalledWith("cred-2");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reports a removal Privy refused in the status line", async () => {
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey: () => Promise.resolve(),
      onRemovePasskey: () =>
        Promise.reject(new Error("Cannot unlink the only sign-in method.")),
      passkeys: [{ credentialId: "cred-1", label: "iCloud Keychain" }],
    });

    screen.getByRole("button", { name: "Remove passkey: iCloud Keychain" }).click();

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Cannot unlink the only sign-in method.");
    // The record is still there, so its row and the remove button must be too.
    expect(screen.getByText("iCloud Keychain")).toBeTruthy();
  });

  it("offers no remove buttons without a removal handler", () => {
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey: () => Promise.resolve(),
      passkeys: [{ credentialId: "cred-1", label: "iCloud Keychain" }],
    });

    expect(screen.getByText("iCloud Keychain")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove passkey/i })).toBeNull();
  });

  it("reports a refused registration in the status line", async () => {
    renderSettings({
      accountKind: "smart",
      smartAccountAddress: SMART_ACCOUNT,
      onAddPasskey: () => Promise.reject(new Error("The user closed the passkey prompt.")),
    });

    screen.getByText("Add passkey").click();

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("The user closed the passkey prompt.");
    // The refusal is not terminal: the row stands ready for another try.
    expect(screen.getByText("Add passkey")).toBeTruthy();
  });
});
