/**
 * @vitest-environment jsdom
 *
 * The other way into the blocked page of FLU-1647, and the one the bridge walks:
 * a wallet the widget restores silently on a chain it does not declare.
 *
 * Nothing in the widget asks an External wallet to already sit on one of its
 * chains — the bridge moves the wallet to the deposit chain itself, right before
 * the deposit. AppKit used to answer that starting chain with its
 * `UnsupportedChain` view, and then stay in it: once its active network is the
 * unknown one, every later account sync reopened that view instead of adopting
 * the chain the wallet had moved to, so the bridge's own switch could not clear
 * the page either.
 *
 * The fakes are the browser's, not the widget's: a wallet announced over
 * EIP-6963 whose EIP-1193 provider answers `eth_accounts` as an authorised
 * wallet does and emits `chainChanged` when it moves, and `fetch`, because
 * AppKit prefetches its wallet API on boot and this test has no network. The
 * discovery, the reconnect and the network bookkeeping are the real wagmi 2.19
 * and `@reown/appkit` 1.8.20.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import { ReownProvider } from "./reownAppKit";

const ADDRESS = "0x1111111111111111111111111111111111111111";
/** Base — declared on neither of the widget's networks. */
const FOREIGN_CHAIN = "0x2105";
/** Sepolia — where the testnet bridge deposits from, so the widget declares it. */
const DEPOSIT_CHAIN = "0xaa36a7";
const ACTIVE_NETWORK_KEY = "@appkit/active_caip_network_id";

const modalIsOpen = () =>
  document.querySelector("w3m-modal")?.classList.contains("open") ?? false;
const pageIsLocked = () =>
  document.head.querySelector('style[data-w3m="scroll-lock"]') !== null;

/** Settled when the element exists and has applied the open state it found. */
async function renderedModal() {
  await vi.waitFor(() => expect(document.querySelector("w3m-modal")).not.toBeNull(), {
    timeout: 20_000,
  });
  await (document.querySelector("w3m-modal") as unknown as { updateComplete: Promise<boolean> })
    .updateComplete;
}

function announceWallet(chainId: string) {
  let current = chainId;
  const chainListeners: ((value: string) => void)[] = [];
  const provider = {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return current;
      throw new Error(`The probe wallet has no answer for ${method}`);
    },
    on: (event: string, handler: (value: string) => void) => {
      if (event === "chainChanged") chainListeners.push(handler);
    },
    removeListener: (event: string, handler: (value: string) => void) => {
      if (event !== "chainChanged") return;
      const at = chainListeners.indexOf(handler);
      if (at >= 0) chainListeners.splice(at, 1);
    },
  };
  const detail = Object.freeze({
    info: {
      uuid: "11111111-2222-3333-4444-555555555555",
      name: "Probe Wallet",
      icon: "data:image/svg+xml,<svg/>",
      rdns: "xyz.fluent.probe",
    },
    provider,
  });
  // EIP-6963: announce once, and again for every request a discovering page makes.
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  return {
    moveTo(next: string) {
      current = next;
      for (const handler of [...chainListeners]) handler(next);
    },
  };
}

/** How many times the widget's subtree rendered — a sync loop would run away with it. */
let renders = 0;

function Account() {
  const { status, chainId } = useAccount();
  renders += 1;
  return <div data-testid="account">{`${status}:${chainId ?? "-"}`}</div>;
}

describe("a wallet restored on a chain the widget does not declare", () => {
  beforeEach(() => {
    renders = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("leaves the page usable, and follows the wallet to the deposit chain", async () => {
    const wallet = announceWallet(FOREIGN_CHAIN);

    render(
      <ReownProvider network="testnet">
        <Account />
      </ReownProvider>,
    );

    // The silent restore lands the wallet on the chain it was already on.
    await screen.findByText("connected:8453", undefined, { timeout: 20_000 });
    await renderedModal();
    expect(modalIsOpen()).toBe(false);
    expect(pageIsLocked()).toBe(false);

    // What the bridge does before a deposit: move the wallet to the source chain.
    wallet.moveTo(DEPOSIT_CHAIN);

    await screen.findByText("connected:11155111", undefined, { timeout: 20_000 });
    await vi.waitFor(
      () => expect(localStorage.getItem(ACTIVE_NETWORK_KEY)).toBe("eip155:11155111"),
      { timeout: 20_000 },
    );
    await renderedModal();
    expect(modalIsOpen()).toBe(false);
    expect(pageIsLocked()).toBe(false);

    // Both chain changes were applied once each, rather than fought over.
    expect(renders).toBeLessThan(10);
  }, 40_000);
});
