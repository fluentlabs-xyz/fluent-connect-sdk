/**
 * @vitest-environment jsdom
 *
 * What the Get USDnr button does, which is now two different things: a mint on
 * a faucet network where the widget wired one, and the Swapper Finance on-ramp
 * everywhere else. The card is mounted for real rather than reasoned about,
 * because the whole of this Issue is a button's `disabled` rule and the handler
 * behind it.
 *
 * Fakes: `SwapperIframe` from `@swapper-finance/deposit-sdk@0.2.14`, which mounts
 * an `<iframe>` into the `container` it is given, raises `close_request` when
 * its own close button is pressed and takes the iframe out on `destroy()`; and
 * `fetch`, which no test here may reach.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import { SwapperIframe } from "@swapper-finance/deposit-sdk";
import { WalletMenuActionCard } from "./WalletMenuActionCard";
import { FLUENT_CONNECT_DEFAULT_SWAPPER_CONFIG, type FluentWidgetConfig } from "../core/config";
import { FluentPortalContainerProvider, FluentTopLayerSlot } from "../widget/portalContainer";
import type { FluentUsdnrMintOutcome } from "../widget/usdnrMint";

const swapper = vi.hoisted(() => ({
  closeRequests: [] as Array<() => void>,
}));

vi.mock("@swapper-finance/deposit-sdk", () => ({
  SwapperIframe: vi.fn(function (this: unknown, options: { container: HTMLElement }) {
    const iframe = document.createElement("iframe");
    iframe.title = "Swapper Finance";
    options.container.appendChild(iframe);
    return {
      on: (event: string, handler: () => void) => {
        if (event === "close_request") swapper.closeRequests.push(handler);
      },
      destroy: () => iframe.remove(),
    };
  }),
}));

/** Every config `SwapperIframe` was constructed with, without its container. */
const swapperOpens = () =>
  vi.mocked(SwapperIframe).mock.calls.map(([options]) => {
    const { container: _container, ...rest } = options as { container: unknown };
    return rest;
  });
const swapperFrame = () => document.querySelector<HTMLIFrameElement>("iframe[title='Swapper Finance']");

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
  /** Mount the card the way the account drawer does: inside the top-layer slot. */
  inTopLayer?: boolean;
}) {
  const card = (
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
    />
  );
  return render(
    props?.inTopLayer ? (
      <FluentPortalContainerProvider>
        <FluentTopLayerSlot>{card}</FluentTopLayerSlot>
      </FluentPortalContainerProvider>
    ) : (
      card
    ),
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
  vi.mocked(SwapperIframe).mockClear();
  swapper.closeRequests.length = 0;
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
    expect(SwapperIframe).not.toHaveBeenCalled();
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

  it("stays enabled while no Widget account address is known, and logs why when pressed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onMintUsdnr = vi.fn(async () => minted);
    renderHome({ onMintUsdnr });

    const button = getUsdnr();
    expect(isDisabled(button)).toBe(false);
    await press(button);

    // Home keeps no status line under its actions: the reason goes to the
    // console, and nothing is built for an address still on its way.
    expect(screen.queryByRole("status")).toBeNull();
    expect(consoleError).toHaveBeenCalledWith("[FluentWidget]", "Wallet address is still preparing");
    expect(onMintUsdnr).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
    expect(swapperOpens()).toEqual([{
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
      closable: true,
      iframeAttributes: { width: "100%", height: "100%" },
    }]);
    // Nothing on mainnet may reach the testnet mint contract.
    expect(JSON.stringify(swapperOpens())).not.toContain(TESTNET_USDNR);
  });

  it("shows the on-ramp in the widget's top layer, above the account drawer", async () => {
    renderHome({
      config: config({ network: "mainnet" }),
      smartAccountAddress: SMART_ACCOUNT,
      inTopLayer: true,
    });

    await press(getUsdnr());

    // The drawer holds `dialog[data-fluent-top-layer]` open with `showModal()`;
    // an on-ramp anywhere else in the document is painted under it and inert.
    const frame = swapperFrame();
    expect(frame).not.toBeNull();
    expect(frame!.closest("dialog[data-fluent-top-layer]")).not.toBeNull();
  });

  it("closes the on-ramp when its own close button asks to", async () => {
    renderHome({ config: config({ network: "mainnet" }), smartAccountAddress: SMART_ACCOUNT });

    await press(getUsdnr());
    expect(swapperFrame()).not.toBeNull();
    await act(async () => {
      swapper.closeRequests.forEach((close) => close());
    });

    expect(swapperFrame()).toBeNull();
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

    expect(swapperOpens()).toHaveLength(1);
    expect(swapperOpens()[0]).toMatchObject({ depositWalletAddress: SMART_ACCOUNT });
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
