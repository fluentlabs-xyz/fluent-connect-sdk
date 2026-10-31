// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluentPortalContainerProvider, FluentTopLayerSlot } from "./portalContainer";

// Fakes: none. jsdom has no top layer, so the order of `showModal()` and
// `showPopover()` calls stands in for the paint order the browser derives from it.

function recordTopLayerCalls() {
  const calls: string[] = [];
  const showPopover = HTMLElement.prototype.showPopover;
  const showModal = HTMLDialogElement.prototype.showModal;
  vi.spyOn(HTMLElement.prototype, "showPopover").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-fluent-toast-layer")) calls.push("toasts");
    return showPopover.call(this);
  });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    if (this.hasAttribute("data-fluent-top-layer")) calls.push("overlay host");
    return showModal.call(this);
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FluentPortalContainerProvider", () => {
  it("keeps toasts above a widget overlay that opens after them", () => {
    const calls = recordTopLayerCalls();
    const { rerender } = render(<FluentPortalContainerProvider>{null}</FluentPortalContainerProvider>);
    expect(calls).toEqual(["toasts"]);

    rerender(
      <FluentPortalContainerProvider>
        <FluentTopLayerSlot>
          <div />
        </FluentTopLayerSlot>
      </FluentPortalContainerProvider>,
    );

    expect(calls.at(-1)).toBe("toasts");
    expect(calls).toContain("overlay host");
  });
});
