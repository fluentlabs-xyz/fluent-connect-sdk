/**
 * @vitest-environment jsdom
 *
 * What the Get USDnr button does, which is now two different things: a mint on
 * a faucet network where the widget wired one, and the Swapper Finance on-ramp
 * everywhere else. The card is mounted for real rather than reasoned about,
 * because the whole of this Issue is a button's `disabled` rule and the handler
 * behind it.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import { openSwapperModal } from "@swapper-finance/deposit-sdk";
import { WalletMenuActionCard } from "./WalletMenuActionCard";
import { FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG, type FluentWidgetConfig } from "../core/config";
import type { FluentUsdnrMintOutcome } from "../widget/usdnrMint";

vi.mock("@swapper-finance/deposit-sdk", () => ({ openSwapperModal: vi.fn() }));

const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;
const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const TESTNET_USDNR = "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1";

function config(overrides?: Partial<FluentWidgetConfig>): FluentWidgetConfig {
  return {
    appId: "app_00000000000000000000000000000000",
    privyClientId: "client-test",
    network: "testnet",
    // The families request needs a session and a tab nothing here opens; off,
    // so this test makes no request of its own.
    reputationEnabled: false,
    disableAnalytics: true,
    ...overrides,
  };
}

function renderHome(props?: {
  config?: FluentWidgetConfig;
  connectedAddress?: string;
  smartAccountAddress?: string;
  onMintUsdnr?: (recipient: Address) => Promise<FluentUsdnrMintOutcome>;
  mintUsdnrBusy?: boolean;
}) {
  return render(
    <WalletMenuActionCard
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={props?.config ?? config()}
      gasPaymentToken="USDnr"
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab="home"
      onTabChange={() => {}}
      connectedAddress={props?.connectedAddress}
      smartAccountAddress={props?.smartAccountAddress}
      onMintUsdnr={props?.onMintUsdnr}
      mintUsdnrBusy={props?.mintUsdnrBusy}
    />,
  );
}

const getUsdnr = () => screen.getByRole("button", { name: /get usdnr/i });
const press = async (button: HTMLElement) => {
  await act(async () => {
    fireEvent.click(button);
  });
};
/** Quick sign aside, every button in this card is a real disabled button. */
const isDisabled = (element: HTMLElement) => element.hasAttribute("disabled");
const minted: FluentUsdnrMintOutcome = { status: "minted", hash: `0x${"ab".repeat(32)}` };

beforeEach(() => {
  vi.mocked(openSwapperModal).mockClear();
  // Balances are read over RPC the moment an address is known. Nothing here is
  // about balances, and a test may not reach the network: the reads fail, the
  // token list says so, and the button under test is unaffected.
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Get USDnr on a faucet network", () => {
  it("mints to the Widget account", async () => {
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({ connectedAddress: EXTERNAL_WALLET, onMintUsdnr });

    await press(getUsdnr());

    // The address the balances above the button are read for, not the Fluent
    // smart account: an External wallet has none and still has to be paid.
    expect(onMintUsdnr).toHaveBeenCalledWith(EXTERNAL_WALLET);
    expect(openSwapperModal).not.toHaveBeenCalled();
  });

  it("mints to the Fluent smart account when that is the Widget account", async () => {
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({ smartAccountAddress: SMART_ACCOUNT, onMintUsdnr });

    await press(getUsdnr());

    expect(onMintUsdnr).toHaveBeenCalledWith(SMART_ACCOUNT);
  });

  it("is enabled with no Fluent smart account behind it", () => {
    renderHome({ connectedAddress: EXTERNAL_WALLET, onMintUsdnr: vi.fn(async () => minted) });

    // An External wallet on its own: the on-ramp's rule would have disabled
    // this, and a mint needs nothing it does not have.
    expect(isDisabled(getUsdnr())).toBe(false);
  });

  it("is enabled in an app that configured no on-ramp", async () => {
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({
      config: config({ swapper: { enabled: false } }),
      connectedAddress: EXTERNAL_WALLET,
      onMintUsdnr,
    });

    const button = getUsdnr();
    expect(isDisabled(button)).toBe(false);
    expect(button.getAttribute("title")).toBeNull();
    await press(button);

    expect(onMintUsdnr).toHaveBeenCalledWith(EXTERNAL_WALLET);
  });

  it("stays enabled while no Widget account address is known, and says so when pressed", async () => {
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({ onMintUsdnr });

    const button = getUsdnr();
    expect(isDisabled(button)).toBe(false);
    await press(button);

    // The answer Send gives, for the same reason: the press is how the person
    // learns the address is still on its way, and nothing is built for it.
    expect(screen.getByRole("status").textContent).toBe("Wallet address is still preparing");
    expect(onMintUsdnr).not.toHaveBeenCalled();
  });

  it("is disabled while a mint is in flight", () => {
    renderHome({
      connectedAddress: EXTERNAL_WALLET,
      onMintUsdnr: vi.fn(async () => minted),
      mintUsdnrBusy: true,
    });

    expect(isDisabled(getUsdnr())).toBe(true);
  });
});

describe("Get USDnr off a faucet network", () => {
  it("opens the on-ramp with the arguments it always had", async () => {
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({
      config: config({ network: "mainnet" }),
      smartAccountAddress: SMART_ACCOUNT,
      onMintUsdnr,
    });

    await press(getUsdnr());

    expect(onMintUsdnr).not.toHaveBeenCalled();
    expect(openSwapperModal).toHaveBeenCalledTimes(1);
    expect(openSwapperModal).toHaveBeenCalledWith({
      integratorId: FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.integratorId,
      dstChainId: FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.dstChainId,
      dstTokenAddr: FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG.dstTokenAddress,
      depositWalletAddress: SMART_ACCOUNT,
      styles: {
        themeMode: "dark",
        componentStyles: {
          primaryColor: "#FF8FDA",
          accentColor: "#FECCEF",
          sphereColor: "#FF8FDA",
        },
      },
    });
    // Nothing on mainnet may reach the testnet mint contract.
    expect(JSON.stringify(vi.mocked(openSwapperModal).mock.calls)).not.toContain(TESTNET_USDNR);
  });

  it("keeps the on-ramp's own disabled rule", () => {
    renderHome({
      config: config({ network: "mainnet" }),
      connectedAddress: EXTERNAL_WALLET,
      onMintUsdnr: vi.fn(async () => minted),
    });

    // No Fluent smart account, so there is nowhere for the on-ramp to deposit.
    expect(isDisabled(getUsdnr())).toBe(true);
  });
});

describe("Get USDnr for a card nobody wired a mint into", () => {
  it("opens the on-ramp on a faucet network too", async () => {
    renderHome({ smartAccountAddress: SMART_ACCOUNT });

    await press(getUsdnr());

    expect(openSwapperModal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openSwapperModal).mock.calls[0]![0]).toMatchObject({
      depositWalletAddress: SMART_ACCOUNT,
    });
  });

  it("keeps the on-ramp's disabled rule on both networks", () => {
    renderHome({ connectedAddress: EXTERNAL_WALLET });
    expect(isDisabled(getUsdnr())).toBe(true);
    cleanup();

    renderHome({ config: config({ network: "mainnet" }), connectedAddress: EXTERNAL_WALLET });
    expect(isDisabled(getUsdnr())).toBe(true);
  });

  it("explains an app with no on-ramp configured, as it did before", () => {
    renderHome({
      config: config({ swapper: { enabled: false } }),
      smartAccountAddress: SMART_ACCOUNT,
    });

    const button = getUsdnr();
    expect(isDisabled(button)).toBe(true);
    expect(button.getAttribute("title")).toBe("Not configured for this app");
  });
});
