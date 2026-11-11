/**
 * @vitest-environment jsdom
 *
 * The widget's trigger button after an External wallet sign-in that follows a Disconnect from the
 * open wallet menu: the widget's top-layer host, `dialog[data-fluent-top-layer]`, stays closed, so
 * the host page is not left inert, and the first press opens the wallet menu.
 *
 * The order of the sequence matters. Disconnect in the open menu (`handleDisconnect`) closes the
 * drawer and removes the account in one commit; base-ui finishes a close by waiting on the popup
 * element that commit removes, so the drawer can stay mounted in base-ui's state, and a mounted
 * modal drawer portal holds the top layer once the next account brings it back. An External
 * wallet's `hasConnectedAccount` drops in that same commit; a Fluent ID's comes from a persisted
 * session. Disconnect is the deterministic, in-widget way to lose the wallet with the menu open.
 *
 * Fakes:
 * - `@privy-io/react-auth` 2.25.0, ready with nobody signed in;
 * - `./reownAppKit`, an External wallet the test connects and disconnects, as wagmi reports it;
 * - `./zerodevSession` `useFluentZeroDevAccount`, with no smart account;
 * - `fetch`, answering every request with a JSON-RPC result of `0x0`;
 * - the timer functions, on Vitest's fake clock.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FluentWidgetConfig } from "../core/config";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222" as const;

/**
 * The wallet connector as wagmi reports it, driven by the test.
 * `bump` re-renders whatever is reading it, the way a wagmi store update does.
 */
const walletState = vi.hoisted(() => ({ connected: false, bump: () => {} }));

/** Nobody signed in with a Fluent ID: the External wallet is the whole account. */
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: unknown }) => children,
  usePrivy: () => ({
    ready: true,
    authenticated: false,
    user: null,
    getAccessToken: async () => null,
    login: () => {},
    logout: async () => {},
  }),
  useIdentityToken: () => ({ identityToken: null }),
  useUser: () => ({ refreshUser: async () => {} }),
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
  useLoginWithSiwe: () => ({ generateSiweMessage: vi.fn(), loginWithSiwe: vi.fn() }),
  useWallets: () => ({ ready: true, wallets: [] }),
  useModalStatus: () => ({ isOpen: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
  Captcha: () => null,
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
}));

vi.mock("./reownAppKit", async () => {
  const { useEffect, useState } = await import("react");
  return {
    REOWN_PROJECT_ID: "test",
    reownConfigured: true,
    ReownProvider: ({ children }: { children: unknown }) => children,
    useReownWallet: () => {
      const [, force] = useState(0);
      useEffect(() => {
        walletState.bump = () => force((revision) => revision + 1);
        return () => {
          walletState.bump = () => {};
        };
      }, []);
      const connected = walletState.connected;
      return {
        configured: true,
        connected,
        address: connected ? EXTERNAL_WALLET : undefined,
        chainId: connected ? 20994 : undefined,
        walletClient: connected ? { account: { address: EXTERNAL_WALLET } } : undefined,
        reconnecting: false,
        open: () => {},
        // One wallet to choose, so the dialog takes the in-page branch rather than handing off
        // to AppKit.
        choices: [{ id: "injected", name: "Browser wallet", icon: undefined, handoff: false }],
        // The person approves the connection in their wallet: the answer lands after the press
        // that asked for it has returned, as a wallet's does, and the test waits for what the
        // widget shows next rather than for time to pass.
        connectChoice: async () => {
          await Promise.resolve();
          walletState.connected = true;
          walletState.bump();
        },
        // What the widget's own teardown calls, synchronously, inside the click
        // handler that closes the drawer. The connector reports the wallet gone
        // from the same commit on.
        disconnect: () => {
          walletState.connected = false;
          walletState.bump();
        },
        switchChain: async () => {},
      };
    },
  };
});

/** No Fluent ID, so no smart account is on its way either. */
vi.mock("./zerodevSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zerodevSession")>()),
  useFluentZeroDevAccount: () => ({
    smartAccountEnabled: false,
    smartAccountReady: false,
    smartAccountAddress: undefined,
    signerAddress: undefined,
    error: null,
    privyReady: true,
    privyAuthenticated: false,
    embeddedWalletCount: 0,
    kernel: null,
    refresh: async () => null,
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

const { FluentWidget } = await import("./FluentWidget");

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/** The widget's top-layer host, the element the first case checks. */
const topLayerHost = () =>
  document.querySelector<HTMLDialogElement>("dialog[data-fluent-top-layer]");

/** The account drawer's portal: mounted means the top-layer hold is taken. */
const drawerPortal = () => document.querySelector('[data-slot="drawer-portal"]');

/** The trigger button, whichever of its two faces it is wearing. */
const connectedTrigger = () => screen.getByRole("button", { name: /0x2222/ });
const disconnectedTrigger = () => screen.getByRole("button", { name: /connect/i });

/**
 * The wallet menu as a person sees it: the drawer's popup, open. A popup that is
 * in the document but still carries `data-closed` is one the drawer never
 * opened, and shows nothing.
 */
function shownWalletMenu() {
  const popup = screen.queryByLabelText("Connected account");
  return popup?.hasAttribute("data-open") ? popup : null;
}

/**
 * Room for the widget's effects and base-ui's frames to settle, on the fake timers' clock
 * (T6): the time is advanced through, not slept through. Only the timer functions are faked
 * (`beforeEach`), so React's scheduler, which runs on `setImmediate` and `MessageChannel`, keeps
 * working; `vi.waitFor` is used rather than Testing Library's `waitFor`, because it advances
 * fake timers between its checks.
 */
const settle = () => vi.advanceTimersByTimeAsync(300);

/**
 * A press on the trigger button, as a person's pointer makes it.
 *
 * A modal `<dialog>` makes every element outside it inert, so a press on the trigger never
 * reaches it while the widget's host dialog is open. jsdom implements neither the top layer nor
 * the inertness, so the rule is applied here: a press on an inert button is swallowed, the way
 * the browser swallows it.
 */
function pressTrigger(button: HTMLElement) {
  const host = topLayerHost();
  if (host?.open && !host.contains(button)) return;
  fireEvent.click(button);
}

/**
 * The External wallet sign-in, as a person performs it in the sign-in dialog:
 * press the trigger, take the wallet branch, choose the wallet, approve it.
 * Ends the moment the widget shows the wallet's address — nothing is pressed
 * afterwards, so whatever the caller presses next is the first press after this
 * sign-in.
 */
async function signInWithExternalWallet() {
  pressTrigger(await vi.waitFor(() => disconnectedTrigger()));
  await vi.waitFor(() => expect(screen.getByText("Continue with X")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: /Other wallets/i }));
  fireEvent.click(await vi.waitFor(() => screen.getByRole("button", { name: "Browser wallet" })));

  // Signed in: the dialog is gone and the button carries the wallet's address.
  await vi.waitFor(() => expect(connectedTrigger()).toBeTruthy());
  await settle();
}

/** The wallet menu, opened from the trigger the way a person opens it. */
async function openWalletMenu() {
  pressTrigger(connectedTrigger());
  await vi.waitFor(() => expect(screen.getByLabelText("Account actions")).toBeTruthy());
  await vi.waitFor(() => expect(shownWalletMenu()).not.toBeNull());
  await settle();
}

/**
 * Disconnect, from the account menu inside the open wallet menu — the widget's own teardown. It
 * clears `accountOpen` and disconnects the wallet in one synchronous handler, so the drawer's
 * close and the removal of its parts land in the same commit.
 */
async function disconnectFromWalletMenu() {
  fireEvent.click(screen.getByLabelText("Account actions"));
  const disconnect = await vi.waitFor(() => screen.getByRole("option", { name: "Disconnect" }));
  fireEvent.pointerDown(disconnect, { pointerType: "mouse", button: 0 });
  fireEvent.pointerUp(disconnect, { pointerType: "mouse", button: 0 });
  fireEvent.click(disconnect);

  // Signed out: the button is back to offering a connection.
  await vi.waitFor(() => expect(disconnectedTrigger()).toBeTruthy());
  await settle();
}

/**
 * The half that comes before the sign-in under test: sign in, use the wallet
 * menu, and lose the account from inside it. Nothing is visibly wrong at the
 * end of it — which is the point, and is asserted rather than assumed.
 */
async function signInUseTheMenuAndDisconnect() {
  render(<FluentWidget config={CONFIG} />);
  await signInWithExternalWallet();
  await openWalletMenu();
  await disconnectFromWalletMenu();

  // With no account there is nothing to show and nothing held: the damage so
  // far is only in base-ui's own state, where a close was left unfinished.
  expect(topLayerHost()?.open ?? false).toBe(false);
  expect(drawerPortal()).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  walletState.connected = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("FluentWidget: the trigger button after an External wallet sign-in", () => {
  it("leaves the top-layer host closed, so the host page stays interactive", async () => {
    await signInUseTheMenuAndDisconnect();

    await signInWithExternalWallet();

    // Nothing of the widget's is on show, so nothing may be holding the top
    // layer. While this is open the whole host page is inert.
    expect(topLayerHost()?.open ?? false).toBe(false);
    // And the drawer that was closed is really gone, rather than mounted
    // invisibly behind it with the hold still taken.
    expect(drawerPortal()).toBeNull();
  }, 30_000);

  it("opens the wallet menu on the first press", async () => {
    await signInUseTheMenuAndDisconnect();

    await signInWithExternalWallet();

    // Nothing has been pressed since the sign-in, so the press below is the
    // first one after it.
    expect(shownWalletMenu()).toBeNull();

    pressTrigger(connectedTrigger());

    await vi.waitFor(() => expect(shownWalletMenu()).not.toBeNull());
    // Showing, not merely mounted: a popup left at its exit style is in the
    // document but translated off screen, which is a menu nobody can read.
    expect(shownWalletMenu()?.hasAttribute("data-ending-style")).toBe(false);
    expect(screen.getByLabelText("Account actions")).toBeTruthy();
  }, 30_000);
});
