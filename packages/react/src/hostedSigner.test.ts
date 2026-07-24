import { afterEach, describe, expect, it, vi } from "vitest";

import { createFluentHostedSigner } from "./hostedSigner";

const signerAddress = "0x1111111111111111111111111111111111111111";
const authorizeOrigin = "https://connect.example";

type MessageListener = (event: MessageEvent) => void;

function setupBrowser() {
  let listener: MessageListener | undefined;
  const popup = {
    closed: false,
    close: vi.fn(),
    postMessage: vi.fn(),
  };
  const open = vi.fn((_url: string, _target: string, _features: string) => popup);

  vi.stubGlobal("location", {
    href: "https://app.example/vault",
    origin: "https://app.example",
  });
  vi.stubGlobal("window", { open });
  vi.stubGlobal("addEventListener", vi.fn((_type: string, next: MessageListener) => {
    listener = next;
  }));
  vi.stubGlobal("removeEventListener", vi.fn());

  return {
    open,
    popup,
    dispatch(data: Record<string, unknown>, origin = authorizeOrigin) {
      listener?.({
        origin,
        source: popup,
        data,
      } as unknown as MessageEvent);
    },
    state() {
      const url = new URL(String(open.mock.calls[0]?.[0]));
      return url.searchParams.get("state");
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createFluentHostedSigner", () => {
  it("opens only when prepared and sends a state-bound signature request", async () => {
    const browser = setupBrowser();
    const signer = createFluentHostedSigner({
      address: signerAddress,
      authorizeUrl: `${authorizeOrigin}/authorize`,
    });

    expect(browser.open).not.toHaveBeenCalled();

    const signature = signer.signMessage("0x1234");
    const state = browser.state();
    expect(state).toBeTruthy();

    browser.dispatch({ type: "fluent:signer:ready", state });
    await vi.waitFor(() => expect(browser.popup.postMessage).toHaveBeenCalledOnce());
    expect(browser.popup.postMessage).toHaveBeenCalledWith(
      {
        type: "fluent:signer:request",
        state,
        method: "personal_sign",
        address: signerAddress,
        message: "0x1234",
      },
      authorizeOrigin,
    );

    browser.dispatch({
      type: "fluent:signer:result",
      state,
      signature: `0x${"ab".repeat(65)}`,
    });
    await expect(signature).resolves.toBe(`0x${"ab".repeat(65)}`);
    expect(browser.popup.close).toHaveBeenCalledOnce();
  });

  it("rejects an authorization error received before signer readiness", async () => {
    const browser = setupBrowser();
    const signer = createFluentHostedSigner({
      address: signerAddress,
      authorizeUrl: `${authorizeOrigin}/authorize`,
    });

    const signature = signer.signMessage("hello");
    browser.dispatch({
      type: "fluent:signer:error",
      state: browser.state(),
      error: "Signing denied",
    });

    await expect(signature).rejects.toThrow("Signing denied");
    expect(browser.popup.close).toHaveBeenCalledOnce();
  });

  it("ignores messages from a different origin", async () => {
    vi.useFakeTimers();
    const browser = setupBrowser();
    const signer = createFluentHostedSigner({
      address: signerAddress,
      authorizeUrl: `${authorizeOrigin}/authorize`,
    });

    const signature = signer.signMessage("hello");
    const state = browser.state();
    const rejected = expect(signature).rejects.toThrow("did not become ready");
    browser.dispatch(
      { type: "fluent:signer:ready", state },
      "https://attacker.example",
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    vi.useRealTimers();
  });
});
