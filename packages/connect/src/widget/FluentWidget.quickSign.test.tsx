/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for one question: what a failed settings read does to
 * a Quick sign the person just turned off.
 *
 * Four modules are mocked: Privy, the Reown/wagmi provider and the ZeroDev
 * smart account — the parts that need a browser wallet and a network — plus the
 * settings client, which is the failure this test is about. `fetch` is stubbed
 * in `beforeEach` for the same reason. Everything between them is the widget's
 * own code, including the `PrivyProvider` key that decides when the subtree is
 * rebuilt.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FluentSettingsError, type FluentUserSettings } from "../core/settingsClient";
import type { FluentWidgetConfig } from "../core/config";
import type { FluentSigningMode } from "./batchOperation";

// The whole widget mounts per case; under the full parallel suite that can pass Vitest's 5 s
// default, so cases here get 30 s, as the other end-to-end widget tests give theirs.
vi.setConfig({ testTimeout: 30_000 });

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => ({
  /** Resolves/rejects the one `read()` the widget makes. */
  read: null as {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  } | null,
  readCalls: 0,
  /** Every body the widget wrote to `PATCH /me/settings`, in order. */
  patches: [] as Array<Record<string, unknown>>,
  /** What the next write answers with; `null` means it lands. */
  patchError: null as Error | null,
}));

vi.mock("@privy-io/react-auth", () => ({
  // A passthrough. The `key` that rebuilds this subtree is `FluentWidget`'s own,
  // so nothing about Privy itself is needed to exercise it.
  PrivyProvider: ({ children }: { children: unknown }) => children,
  usePrivy: () => ({
    ready: true,
    authenticated: true,
    user: { id: "did:privy:test" },
    getAccessToken: async () => "privy-access-token",
    login: () => {},
    logout: async () => {},
  }),
  useIdentityToken: () => ({ identityToken: "privy-identity-token" }),
  useUser: () => ({ refreshUser: async () => {} }),
  // Linking X is not what this file is about; the widget calls the hook on every render.
  useLinkAccount: () => ({ linkTwitter: vi.fn() }),
  // Nor is registering a passkey — same reason.
  useLinkWithPasskey: () => ({ linkWithPasskey: vi.fn() }),
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

vi.mock("./reownAppKit", () => ({
  REOWN_PROJECT_ID: "",
  reownConfigured: false,
  ReownProvider: ({ children }: { children: unknown }) => children,
  useReownWallet: () => ({
    configured: false,
    connected: false,
    reconnecting: false,
    open: () => {},
    disconnect: () => {},
    switchChain: async () => {},
  }),
}));

vi.mock("./zerodevSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./zerodevSession")>()),
  // A Fluent ID that is already there: `deriveWidgetAccount` reads these seven
  // fields and nothing else to call the account ready.
  useFluentZeroDevAccount: () => ({
    smartAccountReady: true,
    smartAccountAddress: SMART_ACCOUNT,
    signerAddress: SIGNER,
    error: null,
    privyReady: true,
    privyAuthenticated: true,
    embeddedWalletCount: 1,
    kernel: null,
    refresh: async () => {},
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

vi.mock("../core/settingsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/settingsClient")>()),
  createFluentSettingsClient: () => ({
    read: () => {
      fixture.readCalls += 1;
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      fixture.read = { promise, resolve, reject };
      return promise as Promise<FluentUserSettings>;
    },
    patch: async (body: Record<string, unknown>) => {
      fixture.patches.push(body);
      if (fixture.patchError) throw fixture.patchError;
      return { quickSign: true, gasTokenSymbol: null, tokens: [], ...body } as FluentUserSettings;
    },
    putToken: async () => {},
    deleteToken: async () => {},
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

/**
 * Mounted by the host below the keyed `PrivyProvider`; counts its rebuilds, and shows the
 * signing mode the widget has applied, which is what a toggle changes once it lands.
 */
let subtreeMounts = 0;
function KeyedSubtreeProbe({ signingMode }: { signingMode: FluentSigningMode }) {
  useEffect(() => {
    subtreeMounts += 1;
  }, []);
  return <div data-testid="keyed-subtree-probe" data-signing-mode={signingMode} />;
}

beforeEach(() => {
  subtreeMounts = 0;
  fixture.read = null;
  fixture.readCalls = 0;
  fixture.patches = [];
  fixture.patchError = null;
  // Balances and prices are not what this test is about, and a test has no
  // business on the network.
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
  cleanup();
  vi.unstubAllGlobals();
});

describe("FluentWidget: Quick sign and a settings read that fails", () => {
  function renderWidget() {
    return render(
      <FluentWidget
        config={CONFIG}
        renderHome={({ widget }) => <KeyedSubtreeProbe signingMode={widget.signingMode} />}
      />,
    );
  }

  /**
   * The drawer, the account menu, then Settings — the way a person reaches it.
   * Leaves the Quick sign switch on screen.
   */
  async function openSettingsScreen() {
    fireEvent.click(screen.getByRole("button", { name: /0x092A/ }));
    fireEvent.click(await waitFor(() => screen.getByLabelText("Account actions")));
    const settings = await waitFor(() => screen.getByRole("option", { name: "Settings" }));
    fireEvent.pointerDown(settings, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(settings, { pointerType: "mouse", button: 0 });
    fireEvent.click(settings);
    await waitFor(() => expect(screen.queryAllByRole("switch")).toHaveLength(1));
  }

  /**
   * The Quick sign switch. The Settings screen has exactly one switch, and its
   * accessible name is computed from a label the drawer renders in a portal, so
   * the role on its own is the stable handle.
   */
  const quickSign = () => screen.getByRole("switch");
  /** The Settings screen's own content, not the drawer chrome around it. */
  const settingsPanel = () => screen.queryByText("Preferences");
  const statusLine = () => screen.queryByRole("status")?.textContent ?? null;
  /** The signing mode the widget has applied, as the host reads it from `widget.signingMode`. */
  const signingMode = () => screen.getByTestId("keyed-subtree-probe").dataset.signingMode;

  /**
   * Nothing below sleeps: each step waits for what the widget does next, the status line it
   * writes, the `PATCH /me/settings` it sends, or the signing mode it applies once the switch's
   * debounce has run, and every other assertion is on the DOM that commit left. Not wrapped in
   * `act`: the account drawer's balance and price queries keep React busy for as long as this
   * test lives, and `act` waits for a tree that never goes idle.
   */

  it("disables the Quick sign switch while this person's settings are still on their way", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();

    // Worth pinning, because it is the other half of the fix: while a read is in
    // flight the person cannot change a preference the answer is about to
    // overwrite. One keyed subtree so far, and one read.
    expect(quickSign().getAttribute("aria-disabled")).toBe("true");
    expect(subtreeMounts).toBe(1);
    expect(fixture.readCalls).toBe(1);
  });

  it("reports a failed read on the Settings card, and rebuilds nothing", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();
    const before = { mounts: subtreeMounts, checked: quickSign().getAttribute("aria-checked") };

    fixture.read?.reject(new FluentSettingsError("internal", "Settings are unavailable.", 503));

    // The message reaches the one place the person is looking. Before this fix
    // the same path told nobody anything.
    await waitFor(() => expect(statusLine()).toBe("Settings are unavailable."));
    // The preference is exactly where it was: the failure applied nothing, so
    // the `PrivyProvider` key did not change and nothing was rebuilt.
    expect(quickSign().getAttribute("aria-checked")).toBe(before.checked);
    expect(subtreeMounts).toBe(before.mounts);
    // And the panel the person is on is still the panel they are on.
    expect(settingsPanel()).not.toBeNull();
    expect(screen.queryAllByRole("switch")).toHaveLength(1);
    expect(screen.getByTestId("keyed-subtree-probe")).toBeTruthy();
    // The failure is terminal for this person: no retry loop behind their back.
    expect(fixture.readCalls).toBe(1);
  });

  it("turns Quick sign off once the read has failed, without rebuilding the subtree", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();
    fixture.read?.reject(new FluentSettingsError("internal", "Settings are unavailable.", 503));
    // The controls come back: a read that cannot be had is no reason to hold the
    // person's own preferences hostage.
    await waitFor(() => expect(quickSign().getAttribute("aria-disabled")).toBeNull());
    const mountsBeforeTheToggle = subtreeMounts;

    fireEvent.click(quickSign());
    // The switch answers at once; applying it waits for the animation. The write to the
    // service goes out before that, so it proves nothing about the toggle: the signing mode
    // the host reads is what says it has been applied.
    expect(quickSign().getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(signingMode()).toBe("prompt"));
    await waitFor(() => expect(fixture.patches).toEqual([{ quickSign: false }]));

    // Quick sign reaches signing through each call's confirmation mode now, not
    // through anything Privy is configured with, so the keyed subtree below is
    // not rebuilt at all — where this Issue once asked for "exactly one, not
    // two".
    expect(subtreeMounts).toBe(mountsBeforeTheToggle);
    // Still off where the person put it, with the panel still on screen.
    expect(quickSign().getAttribute("aria-checked")).toBe("false");
    expect(settingsPanel()).not.toBeNull();
    // And the choice reached the service rather than being dropped on the way (the
    // write awaited above): a failed read is not a reason to keep a preference nowhere.
    // The message described a read this write has outlived, so it goes.
    expect(statusLine()).toBeNull();
    // And the rebuild did not quietly start a second read.
    expect(fixture.readCalls).toBe(1);
  });

  it("reports a write that fails in place of the read that failed before it", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();
    fixture.read?.reject(new FluentSettingsError("internal", "Settings are unavailable.", 503));
    await waitFor(() => expect(quickSign().getAttribute("aria-disabled")).toBeNull());
    fixture.patchError = new FluentSettingsError("internal", "Storage is unavailable.", 500);

    fireEvent.click(quickSign());

    // The newer fact replaces the older one, and the switch stays where the
    // person put it: the widget never silently undoes their choice.
    await waitFor(() => expect(statusLine()).toBe("Storage is unavailable."));
    expect(quickSign().getAttribute("aria-checked")).toBe("false");
    expect(fixture.patches).toEqual([{ quickSign: false }]);
  });

  it("applies this person's stored Quick sign, and toggles it, rebuilding nothing", async () => {
    renderWidget();
    await waitFor(() => expect(fixture.readCalls).toBe(1));
    await openSettingsScreen();

    // Their stored choice is off, and applying it changes no key.
    fixture.read?.resolve({ quickSign: false, gasTokenSymbol: null, tokens: [] });
    await waitFor(() => expect(quickSign().getAttribute("aria-checked")).toBe("false"));
    expect(subtreeMounts).toBe(1);
    expect(statusLine()).toBeNull();

    // Nor does a toggle on top of it, once applied: the signing mode the host reads says it
    // was, not the write, which goes out before the toggle is applied.
    fireEvent.click(quickSign());
    await waitFor(() => expect(signingMode()).toBe("silent"));
    await waitFor(() => expect(fixture.patches).toEqual([{ quickSign: true }]));
    expect(quickSign().getAttribute("aria-checked")).toBe("true");
    expect(subtreeMounts).toBe(1);
    expect(fixture.readCalls).toBe(1);
  });
});
