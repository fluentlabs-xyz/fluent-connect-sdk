/**
 * @vitest-environment jsdom
 *
 * The Swapper Finance on-ramp the card opens for the Fluent ID, and when it stays open: across a
 * render that leaves the Fluent ID alone, and not across a change of that account.
 *
 * Fakes:
 * - `SwapperIframe`, as `@swapper-finance/deposit-sdk@0.2.14` mounts it into its `container`;
 * - `fetch`, which no test here may reach.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SwapperIframe } from "@swapper-finance/deposit-sdk";
import type { FluentWidgetConfig } from "../core/config";
import { WalletMenuActionCard } from "./WalletMenuActionCard";

vi.mock("@swapper-finance/deposit-sdk", () => ({
  SwapperIframe: vi.fn(function (this: unknown, options: { container: HTMLElement }) {
    const iframe = document.createElement("iframe");
    iframe.title = "Swapper Finance";
    options.container.appendChild(iframe);
    return { on: () => {}, destroy: () => iframe.remove() };
  }),
}));

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const OTHER_SMART_ACCOUNT = "0x3333333333333333333333333333333333333333" as const;
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;

/** Mainnet, where Get USDnr opens the on-ramp rather than minting. */
const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "mainnet",
  // The families request needs a session and a tab nothing here opens; off, so no request
  // leaves for it.
  reputationEnabled: false,
  disableAnalytics: true,
};

type CardProps = ComponentProps<typeof WalletMenuActionCard>;

function cardProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    track: () => {},
    session: null,
    faucetBusy: false,
    onFaucet: () => {},
    config: CONFIG,
    gasPaymentToken: "USDnr",
    onGasPaymentTokenChange: () => {},
    silentSigningEnabled: false,
    onSilentSigningChange: () => {},
    onDisconnect: () => {},
    onConnectWithX: () => {},
    tab: "home",
    onTabChange: () => {},
    smartAccountAddress: SMART_ACCOUNT,
    ...overrides,
  };
}

function renderCard(props: CardProps) {
  const view = render(
    <StrictMode>
      <WalletMenuActionCard {...props} />
    </StrictMode>,
  );
  return (next: CardProps) =>
    view.rerender(
      <StrictMode>
        <WalletMenuActionCard {...next} />
      </StrictMode>,
    );
}

const swapperFrame = () =>
  document.querySelector<HTMLIFrameElement>("iframe[title='Swapper Finance']");

async function openOnRamp() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /get usdnr/i }));
  });
}

beforeEach(() => {
  vi.mocked(SwapperIframe).mockClear();
  // Balances are read over RPC once an address is known; nothing here is about them.
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WalletMenuActionCard's on-ramp across renders", () => {
  it("opens one on-ramp for the Fluent ID", async () => {
    renderCard(cardProps());

    await openOnRamp();

    expect(swapperFrame()).not.toBeNull();
    expect(SwapperIframe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(SwapperIframe).mock.calls[0]![0]).toMatchObject({
      depositWalletAddress: SMART_ACCOUNT,
    });
  });

  it("keeps the on-ramp open across a render that changes nothing it reads", async () => {
    const rerender = renderCard(cardProps());
    await openOnRamp();
    const frame = swapperFrame();

    await act(async () => rerender(cardProps({ gasPaymentToken: "ETH" })));

    expect(swapperFrame()).toBe(frame);
    expect(SwapperIframe).toHaveBeenCalledTimes(1);
  });

  it("keeps the on-ramp open when only the External wallet the header shows changes", async () => {
    const rerender = renderCard(cardProps());
    await openOnRamp();
    const frame = swapperFrame();

    await act(async () => rerender(cardProps({ connectedAddress: EXTERNAL_WALLET })));

    expect(swapperFrame()).toBe(frame);
    expect(SwapperIframe).toHaveBeenCalledTimes(1);
  });

  it("closes the on-ramp when the Fluent ID changes, and opens the next one for the new account", async () => {
    const rerender = renderCard(cardProps());
    await openOnRamp();

    await act(async () => rerender(cardProps({ smartAccountAddress: OTHER_SMART_ACCOUNT })));

    expect(swapperFrame()).toBeNull();
    expect(SwapperIframe).toHaveBeenCalledTimes(1);

    await openOnRamp();
    expect(SwapperIframe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(SwapperIframe).mock.calls[1]![0]).toMatchObject({
      depositWalletAddress: OTHER_SMART_ACCOUNT,
    });
  });

  it("closes the on-ramp when the Fluent ID goes away", async () => {
    const rerender = renderCard(cardProps());
    await openOnRamp();

    await act(async () => rerender(cardProps({ smartAccountAddress: undefined })));

    expect(swapperFrame()).toBeNull();
  });
});
