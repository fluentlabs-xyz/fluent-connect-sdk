/**
 * @vitest-environment jsdom
 *
 * The account drawer's mobile ways out. On mobile the drawer fills the viewport, which leaves
 * almost no backdrop to press, so the header has a close button and the sheet a swipe handle.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FluentAccountDrawer } from "./FluentAccountDrawer";

function OpenDrawer({ isMobile, subPageTitle }: { isMobile: boolean; subPageTitle?: string }) {
  const [accountOpen, setAccountOpen] = useState(true);
  return (
    <FluentAccountDrawer
      accountOpen={accountOpen}
      setAccountOpen={setAccountOpen}
      hasConnectedAccount
      isMobile={isMobile}
      connectButton={null}
      accountMenuAddress="0x2222222222222222222222222222222222222222"
      onAccountMenuAction={() => {}}
      subPageTitle={subPageTitle}
      onCloseSubPage={() => {}}
    >
      <p>Wallet menu</p>
    </FluentAccountDrawer>
  );
}

afterEach(cleanup);

describe("FluentAccountDrawer on mobile", () => {
  it("closes the drawer from the close button in the header on mobile", async () => {
    render(<OpenDrawer isMobile />);
    expect(screen.getByLabelText("Account actions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByText("Wallet menu")).toBeNull());
  });

  it("offers no close button in the account header on desktop", () => {
    render(<OpenDrawer isMobile={false} />);

    expect(screen.getByLabelText("Account actions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("leaves a sub-page with its back button alone on mobile", () => {
    render(<OpenDrawer isMobile subPageTitle="Settings" />);

    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows the swipe handle on mobile and not on desktop", () => {
    const { unmount } = render(<OpenDrawer isMobile />);
    expect(document.querySelector('[data-slot="drawer-swipe-handle"]')).not.toBeNull();
    unmount();

    render(<OpenDrawer isMobile={false} />);
    expect(document.querySelector('[data-slot="drawer-swipe-handle"]')).toBeNull();
  });
});
