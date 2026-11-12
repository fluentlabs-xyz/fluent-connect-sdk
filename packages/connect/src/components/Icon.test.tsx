/**
 * @vitest-environment jsdom
 *
 * What assistive technology reads from an icon: a decorative `Icon` stays out of the
 * accessibility tree, and an icon-only button takes its name from its label, not its icon.
 * No fakes: `ReviewDialog` renders inline outside `<FluentWidget>`.
 */
import { cleanup, fireEvent, isInaccessible, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "./Icon";
import { ReviewDialog } from "./ReviewDialog";
import { Button } from "./ui/button";

const ICON_NAMES = [
  "coinbase",
  "walletConnect",
  "metaMask",
  "rabby",
  "keplr",
  "okx",
  "fluent",
  "x",
  "google",
  "arrow-right-s-line",
  "arrow-left-right-line",
  "arrow-up-down-line",
  "arrow-right-up-line",
  "arrow-up-line",
  "plus",
  "eth",
  "usdnr",
  "usdc",
] as const satisfies readonly IconName[];

afterEach(cleanup);

describe("Icon", () => {
  it.each(ICON_NAMES)("hides the %s icon from assistive technology", (name) => {
    const { container } = render(<Icon name={name} className="size-4" />);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg && isInaccessible(svg)).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("graphics-document")).toBeNull();
  });
});

describe("an icon-only button", () => {
  it("is named by its label and not by its icon", () => {
    render(
      <Button type="button" size="icon" aria-label="Close">
        <Icon name="x" />
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Close" });
    expect(button.textContent).toBe("");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("closes a Review when found by its name", () => {
    const onCancel = vi.fn();
    render(
      <ReviewDialog
        eyebrow="Signature"
        title="Sign a message"
        ariaLabel="Review signature"
        footnote="Signing does not send a transaction."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        <span>Message</span>
      </ReviewDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Review signature" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
