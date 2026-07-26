import { afterEach, describe, expect, it, vi } from "vitest";

import { createFluentHostedSigner } from "./hostedSigner";

const signerAddress = "0x1111111111111111111111111111111111111111";
const authorizeOrigin = "https://connect.example";

type MessageListener = (event: MessageEvent) => void;

function setupBrowser() {
  let listener: MessageListener | undefined;
  let openedUrl = "";
  const signerWindow = {
    closed: false,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  const open = vi.fn((url: string) => {
    openedUrl = url;
    return signerWindow;
  });

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
    signerWindow,
    dispatch(
      data: Record<string, unknown>,
      origin = authorizeOrigin,
      source: typeof signerWindow = signerWindow,
    ) {
      listener?.({
        origin,
        source,
        data,
      } as unknown as MessageEvent);
    },
    openedUrl() {
      return new URL(openedUrl);
    },
    state() {
      const url = new URL(openedUrl);
      return url.searchParams.get("state");
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createFluentHostedSigner", () => {
  it("passes authorized-session confirmation to the hosted signer", async () => {
    const browser = setupBrowser();
    const signer = createFluentHostedSigner({
      address: signerAddress,
      authorizeUrl: `${authorizeOrigin}/authorize`,
    });

    const signature = signer.signMessage("0x1234", "session");
    const state = browser.state();
    expect(state).toBeTruthy();
    expect(browser.openedUrl().searchParams.get("confirmation")).toBe("session");

    browser.dispatch(
      { type: "fluent:signer:ready", state },
      authorizeOrigin,
      browser.signerWindow,
    );
    await vi.waitFor(() => expect(browser.signerWindow.postMessage).toHaveBeenCalledOnce());
    expect(browser.signerWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "fluent:signer:request",
        state,
        method: "personal_sign",
        confirmation: "session",
        address: signerAddress,
        message: "0x1234",
      },
      authorizeOrigin,
    );

    browser.dispatch(
      {
        type: "fluent:signer:result",
        state,
        signature: `0x${"ab".repeat(65)}`,
      },
      authorizeOrigin,
      browser.signerWindow,
    );
    await expect(signature).resolves.toBe(`0x${"ab".repeat(65)}`);
    expect(browser.signerWindow.close).toHaveBeenCalledOnce();
  });

  it("passes prompt confirmation to the hosted signer window", async () => {
    const browser = setupBrowser();
    const signer = createFluentHostedSigner({
      address: signerAddress,
      authorizeUrl: `${authorizeOrigin}/authorize`,
    });

    const signature = signer.signMessage("hello");
    const state = browser.state();
    expect(state).toBeTruthy();
    expect(browser.openedUrl().searchParams.get("confirmation")).toBe("always");

    browser.dispatch({ type: "fluent:signer:ready", state });
    await vi.waitFor(() => expect(browser.signerWindow.postMessage).toHaveBeenCalledOnce());
    expect(browser.signerWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "fluent:signer:request",
        state,
        method: "personal_sign",
        confirmation: "always",
        address: signerAddress,
        message: "hello",
      },
      authorizeOrigin,
    );

    browser.dispatch({
      type: "fluent:signer:result",
      state,
      signature: `0x${"cd".repeat(65)}`,
    });
    await expect(signature).resolves.toBe(`0x${"cd".repeat(65)}`);
    expect(browser.signerWindow.close).toHaveBeenCalledOnce();
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
    expect(browser.signerWindow.close).toHaveBeenCalledOnce();
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
