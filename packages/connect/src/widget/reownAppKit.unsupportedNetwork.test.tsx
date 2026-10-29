/**
 * @vitest-environment jsdom
 *
 * One question: does a network AppKit does not recognise put its modal over the
 * page on load (FLU-1647)?
 *
 * AppKit remembers the active network under one localStorage key per origin,
 * `@appkit/active_caip_network_id`, which any AppKit on that origin writes — the
 * host app's own wallet connect, or this widget on the other network. On the
 * next load `createAppKit` reads it back, and a value outside the widget's
 * `networks` used to open the `UnsupportedChain` view, whose header reads
 * "Switch Network". That modal locks `body` scrolling and refuses every close:
 * `ModalUtil.safeClose` only shakes it, so the page is gone until a reload.
 *
 * `fetch` is the only fake — AppKit prefetches its wallet API on boot and this
 * test has no network. The real `@reown/appkit` 1.8.20 runs: `createAppKit`, its
 * controllers and the `<w3m-modal>` element it appends to `document.body`. It
 * logs two boot steps it cannot finish here, its usage API and its WalletConnect
 * provider; both are its own caught failures, and neither reaches the gate below.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReownProvider } from "./reownAppKit";

/** Base: a chain the widget declares on neither network. */
const FOREIGN_NETWORK = "eip155:8453";
const ACTIVE_NETWORK_KEY = "@appkit/active_caip_network_id";
/** Written only by AppKit, and only as it adopts an active network. */
const ACTIVE_NAMESPACE_KEY = "@appkit/active_namespace";

/** AppKit's blocking overlay: the `open` class paints it, the style tag locks the page. */
const modalIsOpen = () =>
  document.querySelector("w3m-modal")?.classList.contains("open") ?? false;
const pageIsLocked = () =>
  document.head.querySelector('style[data-w3m="scroll-lock"]') !== null;

describe("a network AppKit does not recognise", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })),
    );
    localStorage.setItem(ACTIVE_NETWORK_KEY, FOREIGN_NETWORK);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("leaves the page usable when the origin remembers one the widget never declares", async () => {
    render(<ReownProvider network="testnet">app</ReownProvider>);

    // AppKit's boot, in the order it runs: it adopts an active network — the
    // step that decides whether the page is blocked, and the only writer of this
    // key — and injects the modal element a dynamic import later. The element
    // applies the open state it finds in its first render, so that render having
    // completed is the point the page can be read.
    await vi.waitFor(() => expect(localStorage.getItem(ACTIVE_NAMESPACE_KEY)).toBe("eip155"), {
      timeout: 20_000,
    });
    await vi.waitFor(() => expect(document.querySelector("w3m-modal")).not.toBeNull(), {
      timeout: 20_000,
    });
    await (document.querySelector("w3m-modal") as unknown as { updateComplete: Promise<boolean> })
      .updateComplete;

    // The network AppKit adopted is the remembered one, so the boot reached that
    // decision over a network it does not recognise rather than over Fluent.
    expect(localStorage.getItem(ACTIVE_NETWORK_KEY)).toBe(FOREIGN_NETWORK);
    expect(modalIsOpen()).toBe(false);
    expect(pageIsLocked()).toBe(false);
  }, 30_000);
});
