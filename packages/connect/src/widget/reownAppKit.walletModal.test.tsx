/**
 * @vitest-environment jsdom
 *
 * AppKit's `<w3m-modal>` stays the one element `mountWalletModal` placed, inside its own dialog,
 * through repeated opens and closes by AppKit itself, and the dialog opens and closes with it.
 *
 * Fakes:
 * - `fetch`, because AppKit prefetches its wallet API on boot and this test has no network.
 * The real `@reown/appkit` 1.8.20 runs: `createAppKit`, its controllers and the `<w3m-modal>`
 * element. The dialog's `showModal` and `close` are the stand-ins of `test/jsdomPolyfills.ts`.
 */
import { useAppKit } from "@reown/appkit/react";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReownProvider } from "./reownAppKit";

describe("AppKit's modal in the wallet dialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("stays one element in its dialog, which opens and closes with it every time", async () => {
    const { result } = renderHook(() => useAppKit(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ReownProvider network="testnet">{children}</ReownProvider>
      ),
    });
    const dialog = document.querySelector("dialog[data-fluent-wallet-modal]") as HTMLDialogElement;
    const modal = dialog.querySelector("w3m-modal") as HTMLElement;

    for (let round = 0; round < 3; round += 1) {
      await result.current.open();
      await vi.waitFor(
        () => {
          expect(modal.classList.contains("open")).toBe(true);
          expect(dialog.open).toBe(true);
        },
        { timeout: 20_000 },
      );
      // AppKit's `open` runs its own modal injection first; it must not add or move an element.
      expect(Array.from(document.querySelectorAll("w3m-modal"))).toEqual([modal]);
      expect(modal.parentElement).toBe(dialog);

      await result.current.close();
      await vi.waitFor(() => {
        expect(modal.classList.contains("open")).toBe(false);
        expect(dialog.open).toBe(false);
      });
    }
  }, 40_000);
});
