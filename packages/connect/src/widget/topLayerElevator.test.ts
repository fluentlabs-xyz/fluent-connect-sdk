// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopLayerElevator } from "./topLayerElevator";

/** MutationObserver delivers on a microtask; a macrotask lets every batch land. */
const flushObservers = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUpDom() {
  document.body.innerHTML = "";

  const appRoot = document.createElement("div");
  appRoot.id = "root";
  document.body.appendChild(appRoot);

  const hostDialog = document.createElement("dialog");
  document.body.appendChild(hostDialog);

  const topLayerHost = document.createElement("dialog");
  topLayerHost.setAttribute("data-fluent-top-layer", "");
  document.body.appendChild(topLayerHost);

  const toastLayer = document.createElement("div");
  toastLayer.setAttribute("data-fluent-toast-layer", "");
  const showPopover = vi.fn();
  const hidePopover = vi.fn();
  Object.assign(toastLayer, { showPopover, hidePopover });
  document.body.appendChild(toastLayer);

  const releases: Array<ReturnType<typeof vi.fn>> = [];
  const acquire = vi.fn(() => {
    topLayerHost.setAttribute("open", "");
    const release = vi.fn(() => {
      if (releases.every((done) => done.mock.calls.length > 0)) {
        topLayerHost.removeAttribute("open");
      }
    });
    releases.push(release);
    return release;
  });

  const mountPrompt = () => {
    const prompt = document.createElement("div");
    prompt.id = "privy-dialog";
    appRoot.appendChild(prompt);
    return prompt;
  };

  const mountWalletModal = () => {
    const modal = document.createElement("w3m-modal");
    document.body.appendChild(modal);
    return modal;
  };

  const start = () =>
    createTopLayerElevator({ topLayerHost, acquire, toastLayer });

  return {
    appRoot,
    hostDialog,
    topLayerHost,
    toastLayer,
    showPopover,
    hidePopover,
    acquire,
    releases,
    mountPrompt,
    mountWalletModal,
    start,
  };
}

describe("the top-layer elevator", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = "";
  });

  it("moves the Privy prompt into the top-layer host while a host modal dialog is open", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();

    cleanup = dom.start();
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.topLayerHost);
    expect(dom.acquire).toHaveBeenCalledTimes(1);
    // The placeholder keeps the original spot addressable.
    expect(
      Array.from(dom.appRoot.childNodes).some(
        (node) =>
          node.nodeType === Node.COMMENT_NODE && node.textContent === "fluent-top-layer-elevated",
      ),
    ).toBe(true);
  });

  it("elevates a prompt that appears after the host dialog opened", async () => {
    const dom = setUpDom();
    cleanup = dom.start();

    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.topLayerHost);
  });

  it("elevates the prompt while a widget overlay holds the top layer", async () => {
    const dom = setUpDom();
    const overlay = document.createElement("div");
    dom.topLayerHost.appendChild(overlay);
    const prompt = dom.mountPrompt();

    cleanup = dom.start();
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.topLayerHost);
  });

  it("leaves the prompt alone when nothing modal is open", async () => {
    const dom = setUpDom();
    const prompt = dom.mountPrompt();

    cleanup = dom.start();
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.appRoot);
    expect(dom.acquire).not.toHaveBeenCalled();
  });

  it("puts the prompt back once the host dialog closes", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();
    const sibling = document.createElement("span");
    dom.appRoot.appendChild(sibling);

    cleanup = dom.start();
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.topLayerHost);

    dom.hostDialog.removeAttribute("open");
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.appRoot);
    // Back in its original position, before the later sibling.
    expect(prompt.nextElementSibling).toBe(sibling);
    expect(dom.releases[0]).toHaveBeenCalledTimes(1);
    expect(dom.appRoot.innerHTML).not.toContain("fluent-top-layer-elevated");
  });

  it("keeps the owner's removal of an elevated node safe", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();

    cleanup = dom.start();
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.topLayerHost);

    // React unmounts from the parent it rendered into — which no longer holds
    // the node. The instance patch must land the removal on the real node.
    expect(() => dom.appRoot.removeChild(prompt)).not.toThrow();
    expect(prompt.isConnected).toBe(false);
    expect(dom.releases[0]).toHaveBeenCalledTimes(1);
    expect(dom.appRoot.innerHTML).not.toContain("fluent-top-layer-elevated");
  });

  it("redirects sibling insertions that use an elevated node as reference", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();

    cleanup = dom.start();
    await flushObservers();

    const sibling = document.createElement("p");
    expect(() => dom.appRoot.insertBefore(sibling, prompt)).not.toThrow();
    expect(sibling.parentElement).toBe(dom.appRoot);

    // The prompt must come back right after that sibling, where Privy put it.
    dom.hostDialog.removeAttribute("open");
    await flushObservers();
    expect(prompt.previousElementSibling).toBe(sibling);
  });

  it("restores elevated nodes and the parent's methods on cleanup", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();

    const dispose = dom.start();
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.topLayerHost);

    dispose();

    expect(prompt.parentElement).toBe(dom.appRoot);
    expect(Object.prototype.hasOwnProperty.call(dom.appRoot, "removeChild")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(dom.appRoot, "insertBefore")).toBe(false);
  });

  it("sends the prompt home the moment its leave transition starts", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();
    const backdrop = document.createElement("div");
    prompt.appendChild(backdrop);

    cleanup = dom.start();
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.topLayerHost);

    // Headless UI stalls its leave inside the top-layer host; the `leaving`
    // class is the start-of-leave signal, after which it must play out at home.
    backdrop.classList.add("leaving");
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.appRoot);
    expect(dom.releases[0]).toHaveBeenCalledTimes(1);
  });

  it("does not elevate a prompt that is already leaving", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();
    prompt.setAttribute("data-leave", "");

    cleanup = dom.start();
    await flushObservers();

    expect(prompt.parentElement).toBe(dom.appRoot);
    expect(dom.acquire).not.toHaveBeenCalled();
  });

  it("elevates the Reown modal only while it is open", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const walletModal = dom.mountWalletModal();

    cleanup = dom.start();
    await flushObservers();
    // Mounted but closed: Reown keeps the element around between uses.
    expect(walletModal.parentElement).toBe(document.body);

    walletModal.classList.add("open");
    await flushObservers();
    expect(walletModal.parentElement).toBe(dom.topLayerHost);

    walletModal.classList.remove("open");
    await flushObservers();
    expect(walletModal.parentElement).toBe(document.body);
  });

  it("elevates the Privy prompt and the Reown modal together", async () => {
    const dom = setUpDom();
    dom.hostDialog.setAttribute("open", "");
    const prompt = dom.mountPrompt();
    const walletModal = dom.mountWalletModal();
    walletModal.classList.add("open");

    cleanup = dom.start();
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.topLayerHost);
    expect(walletModal.parentElement).toBe(dom.topLayerHost);

    // Both return once the host dialog closes; neither keeps the other captive.
    dom.hostDialog.removeAttribute("open");
    await flushObservers();
    expect(prompt.parentElement).toBe(dom.appRoot);
    expect(walletModal.parentElement).toBe(document.body);
    expect(dom.topLayerHost.open).toBe(false);
  });

  it("re-shows the toast popover when a host modal dialog opens above it", async () => {
    const dom = setUpDom();
    cleanup = dom.start();
    await flushObservers();
    expect(dom.showPopover).not.toHaveBeenCalled();

    dom.hostDialog.setAttribute("open", "");
    await flushObservers();
    expect(dom.hidePopover).toHaveBeenCalledTimes(1);
    expect(dom.showPopover).toHaveBeenCalledTimes(1);

    // Only a fresh modal re-promotes; unrelated mutations must not churn it.
    dom.appRoot.appendChild(document.createElement("div"));
    await flushObservers();
    expect(dom.showPopover).toHaveBeenCalledTimes(1);
  });
});
