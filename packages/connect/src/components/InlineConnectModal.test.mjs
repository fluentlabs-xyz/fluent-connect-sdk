import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineConnectModal } from "./InlineConnectModal";
import {
  getPendingInlineOAuth,
  hasPendingInlineOAuth,
} from "../utils/inlineOAuth";
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => auth,
  useWallets: () => walletState,
  useLoginWithEmail: () => ({ sendCode, loginWithCode }),
  useLoginWithOAuth: () => ({ initOAuth, state: oauthState }),
  useLoginWithPasskey: () => ({ loginWithPasskey }),
  useCreateWallet: () => ({ createWallet }),
  useModalStatus: () => ({ isOpen: securityPromptOpen }),
  Captcha: "captcha",
}));
vi.mock("./ui/dialog", () => ({
  Dialog: ({ children, ...rest }) => {
    React.useEffect(() => {
      dialogMounts++;
    }, []);
    return React.createElement("dialog", rest, children);
  },
  DialogContent: "section",
  DialogHeader: "div",
  DialogTitle: "h2",
  DialogDescription: "p",
}));

let renderer;
let auth;
let walletState;
let oauthState;
let props;
let sendCode;
let loginWithCode;
let initOAuth;
let loginWithPasskey;
let createWallet;
let dialogMounts;
let securityPromptOpen;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup(pending = false) {
  if (pending)
    window.sessionStorage.setItem("fluent:inline-oauth:v1", String(Date.now()));
  const render = () =>
    act(() => {
      renderer
        ? renderer.update(React.createElement(InlineConnectModal, props))
        : (renderer = create(React.createElement(InlineConnectModal, props)));
    });
  render();
  return render;
}
const button = (name) =>
  renderer.root
    .findAllByType("button")
    .find(
      (node) =>
        node.children.filter((child) => typeof child === "string").join("") ===
        name,
    );
async function click(name) {
  await act(async () => {
    await button(name).props.onClick();
  });
}
const labels = () =>
  renderer.root
    .findAllByType("button")
    .map((node) =>
      node.children.filter((child) => typeof child === "string").join(""),
    );
const screen = () =>
  renderer.root.find((node) => node.props["data-auth-screen"]).props[
    "data-auth-screen"
  ];
function input(value) {
  act(() =>
    renderer.root.findByType("input").props.onChange({ target: { value } }),
  );
}
async function submit() {
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
}
async function emailStep() {
  await click("Continue with email");
  input("rook@example.com");
}

beforeEach(() => {
  vi.useFakeTimers();
  const data = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
  });
  auth = { ready: true, authenticated: false, user: null };
  walletState = { ready: true, wallets: [] };
  oauthState = { status: "initial" };
  sendCode = vi.fn().mockResolvedValue(undefined);
  loginWithCode = vi.fn().mockResolvedValue(undefined);
  initOAuth = vi.fn().mockResolvedValue(undefined);
  loginWithPasskey = vi.fn().mockResolvedValue(undefined);
  createWallet = vi.fn().mockResolvedValue(undefined);
  dialogMounts = 0;
  securityPromptOpen = false;
  props = {
    open: true,
    onClose: vi.fn(),
    onFluentLogin: vi.fn(),
    onRetry: vi.fn(),
    track: vi.fn(),
    onExternalWalletSelected: vi.fn(),
    wallet: {
      configured: true,
      open: vi.fn(),
      connectChoice: vi.fn().mockResolvedValue(undefined),
      choices: [
        { id: "metamask-1", name: "MetaMask" },
        { id: "rabby-1", name: "Rabby" },
      ],
    },
  };
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Fluent inline login", () => {
  it("logs in with a passkey after email, prevents duplicate prompts, and prepares the wallet", async () => {
    const render = setup();
    expect(loginWithPasskey).not.toHaveBeenCalled();
    expect(labels().slice(0, 5)).toEqual([
      "Continue with X",
      "Continue with Google",
      "Continue with email",
      "Continue with passkey",
      "Other wallets",
    ]);
    expect(props.onFluentLogin).not.toHaveBeenCalled();
    const pending = deferred();
    loginWithPasskey.mockReturnValueOnce(pending.promise);
    const signIn = button("Continue with passkey").props.onClick;
    let result;
    act(() => {
      result = signIn();
      void signIn();
    });
    expect(loginWithPasskey).toHaveBeenCalledTimes(1);
    expect(props.onFluentLogin).toHaveBeenCalledTimes(1);
    expect(props.track).toHaveBeenCalledWith("connect_method_selected", { method: "fluent" });
    expect(button("Signing in…").props.disabled).toBe(true);
    expect(button("Continue with X").props.disabled).toBe(true);
    expect(initOAuth).not.toHaveBeenCalled();
    expect(hasPendingInlineOAuth()).toBe(false);
    await act(async () => {
      auth = {
        ready: true,
        authenticated: true,
        user: { id: "passkey-user", linkedAccounts: [] },
      };
      pending.resolve();
      await result;
    });
    render();
    expect(screen()).toBe("connecting");
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(dialogMounts).toBe(1);
  });
  it("keeps passkey cancellation retryable in the same dialog", async () => {
    setup();
    loginWithPasskey.mockRejectedValueOnce(
      new Error("Passkey request cancelled"),
    );
    await click("Continue with passkey");
    expect(screen()).toBe("choice");
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Passkey request cancelled",
    ]);
    expect(button("Continue with passkey").props.disabled).toBe(false);
    expect(createWallet).not.toHaveBeenCalled();
    await click("Continue with passkey");
    expect(loginWithPasskey).toHaveBeenCalledTimes(2);
    expect(screen()).toBe("connecting");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(dialogMounts).toBe(1);
  });
  it("ignores a late passkey response after the dialog is closed", async () => {
    const render = setup();
    const pending = deferred();
    loginWithPasskey.mockReturnValueOnce(pending.promise);
    let result;
    act(() => {
      result = button("Continue with passkey").props.onClick();
    });
    props.open = false;
    render();
    await act(async () => {
      pending.resolve();
      await result;
    });
    props.open = true;
    render();
    expect(screen()).toBe("choice");
    expect(createWallet).not.toHaveBeenCalled();
  });
  it("keeps one dialog and captcha mounted through email, code, errors, and Back", async () => {
    setup();
    await emailStep();
    await submit();
    expect(sendCode).toHaveBeenCalledWith({ email: "rook@example.com" });
    expect(screen()).toBe("code");
    expect(button("Resend code in 30s").props.disabled).toBe(true);
    loginWithCode.mockRejectedValueOnce(new Error("Invalid code"));
    input("123456");
    await submit();
    expect(loginWithCode).toHaveBeenCalledWith({ code: "123456" });
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Invalid code",
    ]);
    expect(screen()).toBe("code");
    await click("Change email");
    await click("Back");
    expect(screen()).toBe("choice");
    expect(props.onFluentLogin).toHaveBeenCalledTimes(1);
    expect(dialogMounts).toBe(1);
    expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
    expect(renderer.root.findAllByType("captcha")).toHaveLength(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it("blocks duplicate submissions and ignores late results after closing", async () => {
    const render = setup();
    await emailStep();
    const request = deferred();
    sendCode.mockReturnValue(request.promise);
    await submit();
    await submit();
    expect(sendCode).toHaveBeenCalledTimes(1);
    expect(button("Sending code…").props.disabled).toBe(true);
    props.open = false;
    render();
    await act(async () => request.resolve());
    props.open = true;
    render();
    expect(screen()).toBe("choice");
    expect(dialogMounts).toBe(1);
  });
  it("keeps failed email delivery retryable and validates codes before submitting", async () => {
    setup();
    await emailStep();
    sendCode.mockRejectedValueOnce(new Error("Email unavailable"));
    await submit();
    expect(screen()).toBe("email");
    await submit();
    input("12");
    await submit();
    expect(loginWithCode).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Enter the 6-digit code.",
    ]);
    act(() => vi.advanceTimersByTime(30000));
    // One timer per rendered second; advance with renders to model a real page.
    for (let i = 0; i < 30; i++) act(() => vi.advanceTimersByTime(1000));
    await click("Resend code");
    expect(sendCode).toHaveBeenCalledTimes(3);
  });
  it("creates a missing embedded wallet exactly once after headless login", async () => {
    const render = setup();
    await emailStep();
    await submit();
    input("123456");
    await submit();
    auth = {
      ready: true,
      authenticated: true,
      user: { id: "user-1", linkedAccounts: [] },
    };
    render();
    render();
    expect(screen()).toBe("connecting");
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType("captcha")).toHaveLength(0);
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it("waits for an existing wallet to hydrate without creating another", async () => {
    const render = setup();
    await click("Continue with passkey");
    auth = {
      ready: true,
      authenticated: true,
      user: {
        id: "returning",
        linkedAccounts: [
          { type: "wallet", walletClientType: "privy", chainType: "ethereum" },
        ],
      },
    };
    render();
    expect(createWallet).not.toHaveBeenCalled();
    walletState = {
      ready: true,
      wallets: [{ walletClientType: "privy", chainType: "ethereum" }],
    };
    render();
    expect(createWallet).not.toHaveBeenCalled();
  });
  it("shows wallet creation failure and only retries on explicit action", async () => {
    const render = setup();
    await click("Continue with passkey");
    createWallet.mockRejectedValueOnce(new Error("Wallet creation failed"));
    auth = {
      ready: true,
      authenticated: true,
      user: { id: "new-user", linkedAccounts: [] },
    };
    await act(async () => render());
    render();
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Wallet creation failed",
    ]);
    await click("Try again");
    expect(createWallet).toHaveBeenCalledTimes(2);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
  it("does not duplicate slow wallet creation and yields focus to Privy security prompts", async () => {
    const render = setup();
    await click("Continue with passkey");
    const pendingWallet = deferred();
    createWallet.mockReturnValue(pendingWallet.promise);
    auth = {
      ready: true,
      authenticated: true,
      user: { id: "new-user", linkedAccounts: [] },
    };
    render();
    act(() => vi.advanceTimersByTime(20000));
    await click("Try again");
    expect(createWallet).toHaveBeenCalledTimes(1);
    securityPromptOpen = true;
    render();
    expect(renderer.root.findByType("dialog").props.open).toBe(false);
    securityPromptOpen = false;
    render();
    expect(renderer.root.findByType("dialog").props.open).toBe(true);
    expect(screen()).toBe("connecting");
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => pendingWallet.resolve());
  });
  it.each([
    ["Google", "google"],
    ["X", "twitter"],
  ])(
    "resumes %s in the same dialog without starting OAuth twice",
    async (name, provider) => {
      setup();
        await click(`Continue with ${name}`);
      expect(initOAuth).toHaveBeenCalledWith({ provider });
      expect(
        JSON.parse(window.sessionStorage.getItem("fluent:inline-oauth:v1")),
      ).toEqual({
        started: Date.now(),
        provider,
      });
      expect(renderer.root.findByType("h2").children).toEqual([
        `Continue with ${name}`,
      ]);
      expect(hasPendingInlineOAuth()).toBe(true);
      expect(screen()).toBe("oauth");
      act(() => renderer.unmount());
      renderer = undefined;
      setup();
      expect(screen()).toBe("oauth");
      expect(renderer.root.findByType("h2").children).toEqual([
        `Continue with ${name}`,
      ]);
      expect(initOAuth).toHaveBeenCalledTimes(1);
      await click("Back");
      expect(hasPendingInlineOAuth()).toBe(false);
      expect(screen()).toBe("choice");
    },
  );
  it("keeps a rejected Google login retryable and clears its resume marker", async () => {
    setup();
    initOAuth.mockRejectedValueOnce(new Error("Google login cancelled"));
    await click("Continue with Google");
    expect(screen()).toBe("choice");
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Google login cancelled",
    ]);
    expect(hasPendingInlineOAuth()).toBe(false);
    await click("Continue with X");
    expect(initOAuth).toHaveBeenLastCalledWith({ provider: "twitter" });
    expect(dialogMounts).toBe(1);
  });
  it("resumes an older X marker and ignores invalid or expired provider markers", () => {
    window.sessionStorage.setItem("fluent:inline-oauth:v1", String(Date.now()));
    expect(getPendingInlineOAuth()).toEqual({
      started: Date.now(),
      provider: "twitter",
    });
    for (const value of [
      { started: Date.now(), provider: "unknown" },
      { started: Date.now() - 600001, provider: "google" },
      { started: Date.now() + 1000, provider: "google" },
      { started: "broken", provider: "google" },
      "broken json",
    ]) {
      window.sessionStorage.setItem(
        "fluent:inline-oauth:v1",
        JSON.stringify(value),
      );
      expect(getPendingInlineOAuth()).toBeNull();
      expect(hasPendingInlineOAuth()).toBe(false);
    }
  });
  it("returns OAuth failures to the same dialog with a usable retry", async () => {
    const render = setup(true);
    oauthState = {
      status: "error",
      error: new Error("Authorization cancelled"),
    };
    render();
    expect(screen()).toBe("choice");
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "Authorization cancelled",
    ]);
    expect(hasPendingInlineOAuth()).toBe(false);
    expect(dialogMounts).toBe(1);
  });
  it("replaces the link with the wallet list inside the same dialog without requesting a connection", async () => {
    const render = setup();
    await click("Other wallets");
    expect(button("Other wallets")).toBeUndefined();
    expect(button("MetaMask")).toBeDefined();
    expect(button("Rabby")).toBeDefined();
    expect(props.wallet.open).not.toHaveBeenCalled();
    expect(props.wallet.connectChoice).not.toHaveBeenCalled();
    expect(props.onExternalWalletSelected).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onFluentLogin).not.toHaveBeenCalled();
    expect(dialogMounts).toBe(1);
    props.open = false;
    render();
    props.open = true;
    render();
    expect(button("Other wallets")).toBeDefined();
    expect(button("MetaMask")).toBeUndefined();
  });
  it("preserves custom host wallets that only expose open", async () => {
    delete props.wallet.choices;
    delete props.wallet.connectChoice;
    setup();
    await click("Other wallets");
    expect(props.wallet.open).toHaveBeenCalledOnce();
    expect(props.onExternalWalletSelected).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes the Fluent dialog before handing off to WalletConnect", async () => {
    props.wallet.choices = [{ id: "wc", name: "WalletConnect", handoff: true }];
    props.wallet.connectChoice.mockImplementation(async () => {
      expect(props.onClose).toHaveBeenCalledOnce();
    });
    setup();
    await click("Other wallets");
    await click("WalletConnect");
    expect(props.wallet.connectChoice).toHaveBeenCalledWith("wc");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps a rejected wallet on its screen with the short error and a retry", async () => {
    setup();
    await click("Other wallets");
    props.wallet.connectChoice.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "User rejected the request.\n\nDetails: User rejected the request.\nVersion: viem@2.52.0",
        ),
        { shortMessage: "User rejected the request." },
      ),
    );
    await click("MetaMask");
    expect(props.wallet.connectChoice).toHaveBeenCalledWith("metamask-1");
    expect(screen()).toBe("wallet");
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
      "User rejected the request.",
    ]);
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
    expect(button("Rabby")).toBeUndefined();
    expect(props.onClose).not.toHaveBeenCalled();
    await click("Try again");
    expect(props.wallet.connectChoice).toHaveBeenLastCalledWith("metamask-1");
    expect(props.wallet.connectChoice).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.wallet.open).not.toHaveBeenCalled();
    expect(dialogMounts).toBe(1);
  });
  it("lets the user pick another wallet after a rejection", async () => {
    setup();
    await click("Other wallets");
    props.wallet.connectChoice.mockRejectedValueOnce(
      new Error("Connection rejected"),
    );
    await click("MetaMask");
    expect(screen()).toBe("wallet");
    await click("Back");
    expect(screen()).toBe("choice");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await click("Rabby");
    expect(props.wallet.connectChoice).toHaveBeenLastCalledWith("rabby-1");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("waits for the chosen wallet on its own screen and lets the user back out", async () => {
    setup();
    await click("Other wallets");
    const pending = deferred();
    props.wallet.connectChoice.mockReturnValueOnce(pending.promise);
    let result;
    act(() => {
      result = button("MetaMask").props.onClick();
    });
    expect(screen()).toBe("wallet");
    expect(button("MetaMask")).toBeUndefined();
    expect(button("Continue with X")).toBeUndefined();
    expect(renderer.root.findByType("h2").children).toEqual([
      "Connecting to MetaMask",
    ]);
    // Host nodes only: the lucide spinner repeats its props down its own tree.
    expect(
      renderer.root.findAll(
        (node) => typeof node.type === "string" && node.props.role === "status",
      ),
    ).toHaveLength(1);
    expect(button("Back").props.disabled).toBe(false);
    await click("Back");
    expect(screen()).toBe("choice");
    expect(button("MetaMask").props.disabled).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve();
      await result;
    });
    expect(screen()).toBe("choice");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(dialogMounts).toBe(1);
  });
  it("lets external wallets connect while Privy is unavailable", async () => {
    auth.ready = false;
    setup();
    await click("Other wallets");
    expect(button("MetaMask").props.disabled).toBe(false);
    await click("MetaMask");
    expect(props.wallet.connectChoice).toHaveBeenCalledWith("metamask-1");
  });
  it("does not trap users in a failed captcha or indefinite connecting spinner", async () => {
    setup();
    act(() => renderer.root.findByType("captcha").props.onError());
    expect(renderer.root.findByProps({ role: "alert" }).children[0]).toContain(
      "Verification",
    );
    await click("Retry verification");
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await click("Continue with X");
    expect(button("Try again")).toBeUndefined();
    expect(button("Cancel")).toBeUndefined();
    await click("Back");
    expect(screen()).toBe("choice");
    expect(hasPendingInlineOAuth()).toBe(false);
  });
  it("offers only the methods the host enables, in order, and always X", async () => {
    props.config = { enabledAuthMethods: ["passkey", "google"] };
    setup();
    expect(labels()).toEqual([
      "Continue with X",
      "Continue with passkey",
      "Continue with Google",
      "Other wallets",
    ]);
    // An empty list is a choice, not a missing one: X survives it.
    act(() => renderer.unmount());
    renderer = undefined;
    props.config = { enabledAuthMethods: [] };
    setup();
    expect(labels()).toEqual(["Continue with X", "Other wallets"]);
    await click("Continue with X");
    expect(initOAuth).toHaveBeenCalledWith({ provider: "twitter" });
  });
  it("expires OAuth resume intent and tolerates unavailable storage", () => {
    window.sessionStorage.setItem(
      "fluent:inline-oauth:v1",
      String(Date.now() - 600001),
    );
    expect(hasPendingInlineOAuth()).toBe(false);
    window.sessionStorage.getItem = () => {
      throw new Error("blocked");
    };
    expect(hasPendingInlineOAuth()).toBe(false);
  });
});
