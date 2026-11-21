// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountWalletModal } from "./walletModalHost";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mountWalletModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("puts one <w3m-modal> in its own dialog, once", () => {
    mountWalletModal();
    mountWalletModal();

    const dialogs = document.querySelectorAll("dialog[data-fluent-wallet-modal]");
    expect(dialogs).toHaveLength(1);
    expect(document.querySelectorAll("w3m-modal")).toHaveLength(1);
    expect(document.querySelector("w3m-modal")?.parentElement).toBe(dialogs[0]);
  });

  it("replaces a <w3m-modal> an App's own AppKit appended before it", () => {
    const stray = document.createElement("w3m-modal");
    document.body.appendChild(stray);

    mountWalletModal();

    expect(stray.isConnected).toBe(false);
    expect(document.querySelectorAll("w3m-modal")).toHaveLength(1);
    expect(document.querySelector("w3m-modal")?.parentElement).toBe(
      document.querySelector("dialog[data-fluent-wallet-modal]"),
    );
  });

  it("opens the dialog while the modal is open and never moves the modal", async () => {
    mountWalletModal();
    const dialog = document.querySelector<HTMLDialogElement>("dialog[data-fluent-wallet-modal]")!;
    const modal = document.querySelector("w3m-modal")!;
    // jsdom may lack showModal; the host only needs the open state to follow the modal.
    dialog.showModal = function () {
      this.setAttribute("open", "");
    };
    dialog.close = function () {
      this.removeAttribute("open");
    };

    modal.classList.add("open");
    await flush();
    expect(dialog.open).toBe(true);

    modal.classList.remove("open");
    await flush();
    expect(dialog.open).toBe(false);
    expect(modal.parentElement).toBe(dialog);
  });

  it("reopens the dialog when the browser closes it while the modal is open", async () => {
    mountWalletModal();
    const dialog = document.querySelector<HTMLDialogElement>("dialog[data-fluent-wallet-modal]")!;
    const modal = document.querySelector("w3m-modal")!;
    dialog.showModal = function () {
      this.setAttribute("open", "");
    };
    modal.classList.add("open");
    await flush();

    // A close watcher's forced close: the dialog shuts, AppKit still has the modal open.
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
    expect(dialog.open).toBe(true);
  });
});
