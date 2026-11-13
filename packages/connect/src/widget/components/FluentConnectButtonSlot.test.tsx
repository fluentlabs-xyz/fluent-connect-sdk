/**
 * @vitest-environment jsdom
 *
 * The connect button slot: the context an App's `renderConnectButton` receives, the default
 * button it renders through `DefaultButton`, and the default button's placement without one.
 * No fakes.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConnectButtonRenderContext } from "../FluentWidget";
import { FluentConnectButtonSlot } from "./FluentConnectButtonSlot";

type SlotProps = ComponentProps<typeof FluentConnectButtonSlot>;

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A";
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222";
const PICTURE = "https://pbs.twimg.com/profile_images/1/picture.png";

/** An App's render function that draws the widget's own button inside its own wrapper. */
const wrapDefault = (context: FluentWidgetConnectButtonRenderContext) => (
  <span data-testid="app-wrapper">
    <context.DefaultButton />
  </span>
);

function baseProps(): SlotProps {
  return {
    hasConnectedAccount: true,
    connecting: false,
    externalWalletConnected: false,
    fluentAccountAddress: SMART_ACCOUNT,
    onTopConnectClick: vi.fn(),
    openConnect: vi.fn(),
    openAccount: vi.fn(),
    connectButton: "fixed",
    userAvatarUrl: PICTURE,
    userXDisplayName: "Rook",
    userGoogleName: undefined,
    defaultLogoUrl: null,
  };
}

function renderSlot(props: SlotProps) {
  const view = render(
    <StrictMode>
      <FluentConnectButtonSlot {...props} />
    </StrictMode>,
  );
  return (next: SlotProps) =>
    view.rerender(
      <StrictMode>
        <FluentConnectButtonSlot {...next} />
      </StrictMode>,
    );
}

afterEach(cleanup);

describe("FluentConnectButtonSlot with renderConnectButton", () => {
  it("hands the App the account's label, avatar, names and handlers, once per render pass", () => {
    const props = baseProps();
    const renderConnectButton = vi.fn(wrapDefault);

    renderSlot({ ...props, renderConnectButton });

    // StrictMode renders the slot twice, and the slot calls the App's function on each pass.
    expect(renderConnectButton).toHaveBeenCalledTimes(2);
    const context = renderConnectButton.mock.calls[0]![0];
    expect(context).toMatchObject({
      connected: true,
      pending: false,
      addressLabel: "0x092A...334A",
      userAvatarUrl: PICTURE,
      userXDisplayName: "Rook",
      userGoogleName: undefined,
      onClick: props.onTopConnectClick,
      openConnect: props.openConnect,
      openAccount: props.openAccount,
    });
    expect(screen.getByTestId("app-wrapper").querySelector("button")).not.toBeNull();
  });

  it("labels an External wallet with its own address and an unknown address as Connected", () => {
    const renderConnectButton = vi.fn(wrapDefault);
    const rerender = renderSlot({
      ...baseProps(),
      externalWalletConnected: true,
      connectedAddress: EXTERNAL_WALLET,
      renderConnectButton,
    });
    expect(renderConnectButton.mock.lastCall?.[0].addressLabel).toBe("0x2222...2222");
    expect(screen.getByRole("button").textContent).toBe("0x2222...2222");

    rerender({
      ...baseProps(),
      externalWalletConnected: true,
      connectedAddress: undefined,
      renderConnectButton,
    });
    expect(renderConnectButton.mock.lastCall?.[0].addressLabel).toBe("Connected");

    rerender({ ...baseProps(), hasConnectedAccount: false, renderConnectButton });
    expect(renderConnectButton.mock.lastCall?.[0].addressLabel).toBeUndefined();
    expect(screen.getByRole("button").textContent).toBe("Connect Wallet");
  });

  it("draws the pending state through DefaultButton when connecting changes", () => {
    const renderConnectButton = vi.fn(wrapDefault);
    const rerender = renderSlot({ ...baseProps(), renderConnectButton });
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);

    rerender({ ...baseProps(), hasConnectedAccount: false, connecting: true, renderConnectButton });

    expect(renderConnectButton).toHaveBeenCalledTimes(4);
    expect(renderConnectButton.mock.lastCall?.[0].pending).toBe(true);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button").textContent).toBe("Connecting…");
  });

  it("calls the widget's click handler from the button DefaultButton draws", () => {
    const props = baseProps();
    renderSlot({ ...props, renderConnectButton: wrapDefault });

    fireEvent.click(screen.getByRole("button"));

    expect(props.onTopConnectClick).toHaveBeenCalledTimes(1);
    expect(props.openConnect).not.toHaveBeenCalled();
    expect(props.openAccount).not.toHaveBeenCalled();
  });

  it("keeps the default button's DOM across a render of the slot, an unrelated one included", () => {
    const props = baseProps();
    const renderConnectButton = vi.fn(wrapDefault);
    const rerender = renderSlot({ ...props, renderConnectButton });
    const before = screen.getByRole("button");

    rerender({ ...props, userGoogleName: "Rook R.", renderConnectButton });
    rerender({ ...props, connecting: true, renderConnectButton });

    // `DefaultButton` is one component for the slot's lifetime, so React updates its DOM in place.
    const components = new Set(
      renderConnectButton.mock.calls.map(([context]) => context.DefaultButton),
    );
    expect(renderConnectButton).toHaveBeenCalledTimes(6);
    expect(components.size).toBe(1);
    expect(screen.getByRole("button")).toBe(before);
    expect(before.isConnected).toBe(true);
    expect(before.hasAttribute("disabled")).toBe(true);
  });

  it("keeps a broken avatar's fallback across an unrelated render of the slot", () => {
    const props = baseProps();
    const rerender = renderSlot({ ...props, renderConnectButton: wrapDefault });
    fireEvent.error(screen.getByRole("button").querySelector("img")!);
    expect(screen.getByRole("button").querySelector("img")).toBeNull();

    rerender({ ...props, userGoogleName: "Rook R.", renderConnectButton: wrapDefault });

    expect(screen.getByRole("button").querySelector("img")).toBeNull();
  });

  it("falls back to the placed default button when the App's function returns nothing", () => {
    renderSlot({ ...baseProps(), renderConnectButton: () => undefined });

    expect(screen.getByRole("button").parentElement?.className).toBe("fixed top-5 right-5 z-50");
  });
});

describe("FluentConnectButtonSlot without renderConnectButton", () => {
  it("keeps the inline default button's DOM across a render of the slot", () => {
    const props = baseProps();
    const rerender = renderSlot({ ...props, connectButton: "inline" });
    const before = screen.getByRole("button");

    rerender({ ...props, connectButton: "inline", userGoogleName: "Rook R." });

    expect(screen.getByRole("button")).toBe(before);
  });

  it("places the default button top right, in place, or nowhere by connectButton", () => {
    const props = baseProps();
    const rerender = renderSlot(props);
    expect(screen.getByRole("button").parentElement?.className).toBe("fixed top-5 right-5 z-50");

    rerender({ ...props, connectButton: "inline" });
    expect(screen.getByRole("button").parentElement?.className).not.toBe(
      "fixed top-5 right-5 z-50",
    );

    rerender({ ...props, connectButton: false });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
