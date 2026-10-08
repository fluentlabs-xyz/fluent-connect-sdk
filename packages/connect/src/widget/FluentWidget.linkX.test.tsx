/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for the half of `linkX()` that cannot live in the core: the return
 * gate, the identity-token refresh over Privy's hooks, and the marker's ownership.
 *
 * Four modules are mocked — Privy, the Reown/wagmi provider, the ZeroDev smart account and the
 * settings client — exactly as in `FluentWidget.quickSign.test.tsx`, and `fetch` is routed by
 * URL in `beforeEach`. Everything between them is the widget's own code: the adapter in
 * `FluentWidgetContent`, the core action, and `useLinkX`.
 *
 * The Privy mock is a fixture the cases move and a `rerender` they drive: that is what a page
 * coming back from the X redirect looks like from inside React — a user restored on a later
 * commit, with an X account on it that was not there before.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLUENT_WIDGET_SESSION_STORAGE_KEY, type FluentWidgetConfig } from "../core/config";
import { FLUENT_LINK_X_MARKER_KEY, type FluentLinkXResult } from "../core/linkX";
import { FluentAuthError } from "../core/authToken";
import { FluentSettingsError, type FluentUserSettings } from "../core/settingsClient";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const PRIVY_USER = "did:privy:owner";
const OTHER_PRIVY_USER = "did:privy:someone-else";
const PUBLIC_API_URL = "https://api.testnet.fluent.xyz/api/v1";

const X_ACCOUNT = {
  id: "1458",
  handle: "fluentxyz",
  avatarUrl: "https://pbs.twimg.com/profile_images/1458/avatar.jpg",
};

/** Shared with the module factories below, which run before this file's body. */
const fixture = vi.hoisted(() => {
  const googleEntry = { type: "google_oauth", subject: "google-1" };
  const xEntry = { type: "twitter_oauth", subject: "1458", username: "fluentxyz" };
  let minted = 0;
  /**
   * A fresh identity token, as Privy really mints them: `refreshUser()` fetches the user and
   * gets a newly signed token every time, so the bytes always change even when the linked
   * accounts in it do not.
   */
  const mintIdentityToken = (hasX: boolean): string => {
    minted += 1;
    const payload = btoa(
      JSON.stringify({
        sub: "did:privy:owner",
        iat: 1_759_800_000 + minted,
        linked_accounts: JSON.stringify(hasX ? [googleEntry, xEntry] : [googleEntry]),
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
  };

  /**
   * Privy's identity-token store, as a store rather than a value — which is what it is in
   * 2.25.0 (`storeIdentityToken` does a synchronous `setState`, and `useIdentityToken()` is a
   * subscriber). The publication *timing* is the whole subject of the refresh adapter, so
   * mocking it as a plain render value would test the wrong thing.
   */
  const identityTokens = {
    value: "",
    listeners: new Set<() => void>(),
  };

  return {
    mintIdentityToken,
    identityTokens,
    setIdentityToken: (next: string) => {
      identityTokens.value = next;
      for (const notify of [...identityTokens.listeners]) notify();
    },
    /** Whether the ZeroDev smart account is back yet. A reload takes seconds over it. */
    smartAccountReady: true,
    /** What the mocked Privy reports on the next render. */
    privy: {
      ready: true,
      authenticated: true,
      userId: "did:privy:owner" as string | undefined,
      linkedAccounts: [googleEntry] as Array<{ type: string }>,
    },
    /** The callbacks `useLinkAccount` was last given, so a case can fire Privy's own onError. */
    linkAccountCallbacks: null as { onSuccess?: unknown; onError?: (code: string, details: unknown) => void } | null,
    linkTwitterCalls: 0,
    refreshUserCalls: 0,
    /** What `refreshUser()` does to the fixture. Set per case. */
    onRefreshUser: (() => {}) as () => void,
  };
});

vi.mock("@privy-io/react-auth", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (notify: () => void) => {
    fixture.identityTokens.listeners.add(notify);
    return () => {
      fixture.identityTokens.listeners.delete(notify);
    };
  };
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    usePrivy: () => ({
      ready: fixture.privy.ready,
      authenticated: fixture.privy.authenticated,
      user: fixture.privy.userId
        ? {
            id: fixture.privy.userId,
            linkedAccounts: fixture.privy.linkedAccounts,
          }
        : null,
      getAccessToken: async () => "privy-access-token",
      login: () => {},
      logout: async () => {},
    }),
    useIdentityToken: () => ({
      identityToken: useSyncExternalStore(
        subscribe,
        () => fixture.identityTokens.value,
        () => fixture.identityTokens.value,
      ),
    }),
    useUser: () => ({
      refreshUser: async () => {
        fixture.refreshUserCalls += 1;
        fixture.onRefreshUser();
      },
    }),
    useLinkAccount: (callbacks?: {
      onSuccess?: unknown;
      onError?: (code: string, details: unknown) => void;
    }) => {
      fixture.linkAccountCallbacks = callbacks ?? null;
      return {
        linkTwitter: () => {
          fixture.linkTwitterCalls += 1;
        },
      };
    },
    useWallets: () => ({ ready: true, wallets: [] }),
    useModalStatus: () => ({ isOpen: false }),
    useCreateWallet: () => ({ createWallet: vi.fn() }),
    useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn() }),
    useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
    useLoginWithPasskey: () => ({ loginWithPasskey: vi.fn() }),
    Captcha: () => null,
    useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
    useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  };
});

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
  useFluentZeroDevAccount: () => ({
    smartAccountReady: fixture.smartAccountReady,
    smartAccountAddress: fixture.smartAccountReady ? SMART_ACCOUNT : undefined,
    signerAddress: SIGNER,
    error: null,
    privyReady: true,
    privyAuthenticated: true,
    embeddedWalletCount: 1,
    kernel: { smartAccountAddress: SMART_ACCOUNT },
    refresh: async () => ({ smartAccountAddress: SMART_ACCOUNT }),
    sendCalls: async () => "0x",
    ensureExecutionReady: async () => {},
  }),
}));

vi.mock("../core/settingsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/settingsClient")>()),
  // Not what this file is about: a controller that never answers would keep the widget asking.
  createFluentSettingsClient: () => ({
    read: async () => {
      throw new FluentSettingsError("internal", "unreachable", 500);
    },
    patch: async () => {
      throw new FluentSettingsError("internal", "unreachable", 500);
    },
    putToken: async () => {},
    deleteToken: async () => {},
  } as unknown as { read: () => Promise<FluentUserSettings> }),
}));

const { FluentWidget } = await import("./FluentWidget");
const { useLinkX } = await import("../index");
const { resetAuthTokenSessions } = await import("./hooks/useAuthToken");
const { useFluentWidget } = await import("./widgetContext");
type FluentWidgetRenderContext = import("./FluentWidget").FluentWidgetRenderContext;

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  authMode: "direct",
  reputationEnabled: false,
  disableAnalytics: true,
};

/** Every `POST /me/identity/privy` the widget made, and what the next one answers. */
const wire = {
  identityPosts: [] as Array<{ url: string; init: RequestInit }>,
  profilePosts: 0,
  identityResponse: () => jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT }),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A Fluent token the auth-token cache can read an expiry out of. */
function fluentToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
}

/** What the probe below publishes, so a case can read the context and the hook from outside. */
let probe: {
  linkX: FluentWidgetRenderContext["linkX"];
  hook: ReturnType<typeof useLinkX> | null;
} = { linkX: async () => ({ status: "redirecting" }), hook: null };

function ContextProbe() {
  const ctx = useFluentWidget();
  probe = { linkX: ctx.linkX, hook: probe.hook };
  return <div data-testid="context-probe" />;
}

function HookProbe() {
  const ctx = useFluentWidget();
  const hook = useLinkX();
  probe = { linkX: ctx.linkX, hook };
  return <div data-testid="hook-probe" data-status={hook.status} />;
}

function renderWidget(options: { withHook: boolean; authMode?: "direct" | "hosted" }) {
  const config = { ...CONFIG, authMode: options.authMode ?? "direct" } as FluentWidgetConfig;
  // A fresh element per render pass on purpose: handed the very same element object, React
  // bails out of the subtree, and these cases move the mocked Privy rather than any prop.
  const element = () => (
    <FluentWidget
      config={config}
      showDebugPayload={false}
      renderHome={() => (options.withHook ? <HookProbe /> : <ContextProbe />)}
    />
  );
  const result = render(element());
  return { ...result, rerenderWidget: () => result.rerender(element()) };
}

/** A stored session for the Privy user the cases sign in as. */
function seedSession(userId = PRIVY_USER) {
  window.localStorage.setItem(
    FLUENT_WIDGET_SESSION_STORAGE_KEY,
    JSON.stringify({
      app: { id: CONFIG.appId, name: "test", origin: "http://localhost" },
      appId: CONFIG.appId,
      idToken: "mock.e30.signature",
      user: { id: userId },
      wallet: { signerAddress: SIGNER, smartAccountAddress: SMART_ACCOUNT },
      scopes: [],
      issuedAt: Math.floor(Date.now() / 1000),
      metadata: { authMode: "direct", origin: "http://localhost" },
    }),
  );
}

function seedMarker(raw: string) {
  window.sessionStorage.setItem(FLUENT_LINK_X_MARKER_KEY, raw);
}

function storedMarker(): string | null {
  return window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY);
}

/** The adapter made no progress: nothing refreshed, nothing sent, nothing redirected again. */
function expectNoWork() {
  expect(fixture.refreshUserCalls).toBe(0);
  expect(fixture.linkTwitterCalls).toBe(0);
  expect(wire.identityPosts).toHaveLength(0);
}

beforeEach(() => {
  resetAuthTokenSessions();
  window.localStorage.clear();
  window.sessionStorage.clear();
  wire.identityPosts = [];
  wire.profilePosts = 0;
  wire.identityResponse = () =>
    jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: X_ACCOUNT });
  fixture.smartAccountReady = true;
  fixture.privy.ready = true;
  fixture.privy.authenticated = true;
  fixture.privy.userId = PRIVY_USER;
  fixture.privy.linkedAccounts = [{ type: "google_oauth" }];
  fixture.identityTokens.value = fixture.mintIdentityToken(false);
  fixture.identityTokens.listeners.clear();
  fixture.linkAccountCallbacks = null;
  fixture.linkTwitterCalls = 0;
  fixture.refreshUserCalls = 0;
  // What a real `refreshUser()` does: the user GET answers with a newly signed identity token,
  // and the store publishes it. Cases that link X swap in one that carries the X account.
  fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(false));
  probe = { linkX: async () => ({ status: "redirecting" }), hook: null };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/me/identity/privy")) {
        wire.identityPosts.push({ url, init: init ?? {} });
        return wire.identityResponse();
      }
      if (url.includes("/me/profile")) {
        wire.profilePosts += 1;
        return jsonResponse({ subject: "fcid_owner", appId: CONFIG.appId, x: null });
      }
      if (url.endsWith("/auth/exchange/privy")) {
        return jsonResponse({ token: fluentToken(), refreshToken: "r", refreshExpiresAt: 1 });
      }
      // Balances, prices and anything else the widget reaches for: not this file's subject.
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x0" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});


/**
 * Let React commit whatever is waiting, repeatedly.
 *
 * Every path through the identity-token refresh needs this *separately* from awaiting the call:
 * React's async `act` awaits the thenable it is handed **before** flushing its work queue, so
 * `await act(() => linkX())` deadlocks — the commit the refresh is waiting for is the one `act`
 * will not perform until the call it is awaiting has already finished. A browser commits on its
 * own; a test has to ask. Repeated because one `linkX()` can need several: the return gate's
 * signal, the refreshed token, and the hook's own state.
 */
async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {});
  }
}

/**
 * Commit until something has happened, rather than a fixed number of times. One `linkX()` is a
 * chain of commits and promises — the gate's signal, the refreshed token, the request, the
 * hook's state — and under `IS_REACT_ACT_ENVIRONMENT` nothing in it moves between them unless a
 * test asks, so awaiting the call outside `act` would wait for a commit that is never scheduled.
 */
async function flushUntil(done: () => boolean, rounds = 25): Promise<void> {
  for (let round = 0; round < rounds && !done(); round += 1) {
    await act(async () => {});
  }
}

/** One `linkX()`, with the commits it needs, and its answer. */
async function linkXNow(): Promise<FluentLinkXResult> {
  let answer: FluentLinkXResult | null = null;
  const pending = probe.linkX();
  void pending.then((result) => {
    answer = result;
  }, () => undefined);
  await flushUntil(() => answer !== null);
  return pending;
}

/** One `linkX()` that is expected to refuse. */
async function linkXRefusal(): Promise<FluentAuthError> {
  let answer: FluentAuthError | null = null;
  const pending = probe.linkX().then(
    () => null,
    (err: FluentAuthError) => {
      answer = err;
      return err;
    },
  );
  await flushUntil(() => answer !== null);
  const error = await pending;
  if (!error) throw new Error("expected linkX() to reject");
  return error;
}

/** A `linkX()` left in flight, so a case can assert what it did *not* do yet. */
function linkXInFlight(): { settled: () => FluentLinkXResult | null; pending: Promise<FluentLinkXResult> } {
  let answer: FluentLinkXResult | null = null;
  const pending = probe.linkX();
  void pending.then(
    (result) => {
      answer = result;
    },
    () => undefined,
  );
  return { settled: () => answer, pending };
}

describe("linkX(): a user who already has X", () => {
  it("resolves linked from one POST, with no dialog and no marker", async () => {
    seedSession();
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(wire.identityPosts).toHaveLength(1);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(fixture.refreshUserCalls).toBe(0);
    expect(storedMarker()).toBeNull();
    expect(wire.profilePosts).toBe(0);
  });

  it("authenticates the POST with the Fluent token getAuthToken() minted", async () => {
    seedSession();
    const token = (fixture.identityTokens.value = fixture.mintIdentityToken(true));
    renderWidget({ withHook: false });

    await linkXNow();

    const headers = wire.identityPosts[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toMatch(/^Bearer eyJ/);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body))).toEqual({
      accessToken: "privy-access-token",
      identityToken: token,
    });
  });
});

describe("linkX(): the hop", () => {
  it("marks the tab for the signed-in subject, redirects, and sends nothing", async () => {
    seedSession();
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "redirecting" });

    // One refresh, and only then the marker and the redirect.
    expect(fixture.refreshUserCalls).toBe(1);
    expect(fixture.linkTwitterCalls).toBe(1);
    expect(wire.identityPosts).toHaveLength(0);
    expect(JSON.parse(String(storedMarker()))).toEqual({
      started: expect.any(Number),
      subject: PRIVY_USER,
    });
  });

  it("refuses hosted mode before anything else", async () => {
    seedSession();
    renderWidget({ withHook: false, authMode: "hosted" });

    expect((await linkXRefusal()).code).toBe("hosted_not_supported");

    expectNoWork();
    expect(storedMarker()).toBeNull();
  });
});

/** A Privy still restoring its user: what a page sees in its first ticks after any reload. */
function privyRestoring() {
  fixture.privy.ready = false;
  fixture.privy.authenticated = false;
  fixture.privy.userId = undefined;
}

/** A page that just came back from X: a marker, and a Privy still restoring its user. */
function arriveFromRedirect(markerSubject = PRIVY_USER) {
  seedSession();
  seedMarker(JSON.stringify({ started: Date.now(), subject: markerSubject }));
  privyRestoring();
}

/** Privy comes back authenticated, with the X account now on the user. */
function privyRestoredWithX(userId = PRIVY_USER) {
  fixture.privy.ready = true;
  fixture.privy.authenticated = true;
  fixture.privy.userId = userId;
  fixture.privy.linkedAccounts = [{ type: "google_oauth" }, { type: "twitter_oauth" }];
  // The OAuth link mints no identity token of its own: `refreshUser()` is what produces the
  // post-link one, and only then does the store publish it.
  fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
}

/** A direct `linkX()` expected to refuse, left in flight so a case can watch it wait first. */
function linkXRefusalInFlight(): { refused: () => FluentAuthError | null } {
  let refusal: FluentAuthError | null = null;
  void probe.linkX().then(
    () => undefined,
    (err: FluentAuthError) => {
      refusal = err;
    },
  );
  return { refused: () => refusal };
}

describe("the return gate", () => {
  it("completes the link on mount, reading the X account off the restored user", async () => {
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: true });

    // Before either signal: no core call, no POST, no refresh, no second redirect.
    await flush();
    expectNoWork();
    expect(storedMarker()).not.toBeNull();
    expect(probe.hook?.status).toBe("pending");

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(probe.hook?.x).toEqual(X_ACCOUNT);
    expect(wire.identityPosts).toHaveLength(1);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body)).identityToken).toBe(
      fixture.identityTokens.value,
    );
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(storedMarker()).toBeNull();
  });

  it("serves a direct FluentWidgetRenderContext.linkX() caller the same way", async () => {
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flush();
    expectNoWork();
    expect(call.settled()).toBeNull();
    expect(storedMarker()).not.toBeNull();

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.settled() !== null);

    await expect(call.pending).resolves.toEqual({ status: "linked", x: X_ACCOUNT });
    expect(wire.identityPosts).toHaveLength(1);
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(storedMarker()).toBeNull();
  });

  it("waits for the Fluent ID to be back, not only for Privy", async () => {
    // A reload restores Privy in a tick and the smart account in seconds. A re-entry that ran
    // in between would refuse itself with `not_authenticated` for an account still arriving.
    arriveFromRedirect();
    fixture.smartAccountReady = false;
    const { rerenderWidget } = renderWidget({ withHook: true });

    privyRestoredWithX();
    await act(async () => {
      rerenderWidget();
    });
    await flush();
    expectNoWork();
    expect(probe.hook?.status).toBe("pending");
    expect(storedMarker()).not.toBeNull();

    fixture.smartAccountReady = true;
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status === "linked");

    expect(probe.hook?.status).toBe("linked");
    expect(wire.identityPosts).toHaveLength(1);
    expect(storedMarker()).toBeNull();
  });

  it("never asks useLinkAccount for an onSuccess", async () => {
    // The completion signal is the restored user, not this callback: in 2.25.0 the link intent
    // is a `useRef` the OAuth reload destroys, so `onSuccess` never fires after a redirect.
    arriveFromRedirect();
    renderWidget({ withHook: true });
    await flush();

    expect(fixture.linkAccountCallbacks).not.toBeNull();
    expect(fixture.linkAccountCallbacks?.onSuccess).toBeUndefined();
    expect(typeof fixture.linkAccountCallbacks?.onError).toBe("function");
  });

  it.each([
    ["linked_to_another_user", "linked_to_another_user"],
    ["oauth_user_denied", "user_rejected"],
    ["exited_link_flow", "user_rejected"],
    ["cannot_link_more_of_type", "link_failed"],
  ])("reports Privy's %s as %s, with no second redirect", async (privyCode, fluentCode) => {
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: PRIVY_USER }));
    renderWidget({ withHook: true });
    await flush();
    expectNoWork();

    await act(async () => {
      fixture.linkAccountCallbacks?.onError?.(privyCode, { linkMethod: "twitter_oauth" });
    });
    await flushUntil(() => probe.hook?.status === "error");

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe(fluentCode);
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("does nothing on mount when there is no marker", async () => {
    seedSession();
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expectNoWork();
  });
});

describe("the marker is owned by the subject that started it", () => {
  it("drops storage that is not a marker, and resumes nothing", async () => {
    seedSession();
    seedMarker('{"started":"yesterday"}');
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("drops a marker user A left behind when user B arrives, and resumes nothing", async () => {
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
    renderWidget({ withHook: true });

    await flush();

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it.each([
    ["already has X", true],
    ["has no X yet", false],
  ])(
    "stops a direct call at another subject's marker when the signed-in user %s: cleared, no work",
    async (_, hasX) => {
      // Not a fresh ask: the call did nothing, and says so, rather than resolving `linked` for
      // a request it never sent or walking user B into a redirect over user A's leftover.
      seedSession();
      seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
      fixture.identityTokens.value = fixture.mintIdentityToken(hasX);
      renderWidget({ withHook: false });

      const error = await linkXRefusal();

      expect(error).toBeInstanceOf(FluentAuthError);
      expect(error.code).toBe("link_failed");
      expect(storedMarker()).toBeNull();
      expectNoWork();
    },
  );

  it("stops a direct call at storage that is not a marker: cleared, no work", async () => {
    seedSession();
    seedMarker('{"started":"yesterday"}');
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: false });

    expect((await linkXRefusal()).code).toBe("link_failed");

    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("keeps the marker while Privy is still restoring, and discards it once Privy restores somebody else", async () => {
    // Who is here is not known until Privy says so. A marker met before that is neither
    // resumed nor dropped; the verdict comes with the restored user.
    arriveFromRedirect(OTHER_PRIVY_USER);
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    const { rerenderWidget } = renderWidget({ withHook: false });

    const call = linkXRefusalInFlight();
    await flush();
    expect(call.refused()).toBeNull();
    expect(storedMarker()).not.toBeNull();
    expectNoWork();

    privyRestoredWithX(PRIVY_USER);
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => call.refused() !== null);

    expect(call.refused()?.code).toBe("link_failed");
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("leaves useLinkX() idle, with no error, when Privy restores somebody else over the session's own marker", async () => {
    // The hook only knows the stored session when it resumes; the session names the subject,
    // so the resume starts and waits. Privy then restores another person: the gate discards
    // the marker, nothing is linked, and the component that never asked sees no error.
    arriveFromRedirect();
    const { rerenderWidget } = renderWidget({ withHook: true });

    await flush();
    expect(probe.hook?.status).toBe("pending");
    expect(storedMarker()).not.toBeNull();
    expectNoWork();

    privyRestoredWithX(OTHER_PRIVY_USER);
    await act(async () => {
      rerenderWidget();
    });
    await flushUntil(() => probe.hook?.status !== "pending");

    expect(probe.hook?.status).toBe("idle");
    expect(probe.hook?.error).toBeNull();
    expect(probe.hook?.x).toBeNull();
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("still tells a component that asked when its ask met somebody else's marker", async () => {
    // The same discard, reached through the hook's own `linkX()` rather than the mount-time
    // resume: the component asked, so it is told, as a direct caller is.
    seedSession();
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));
    fixture.identityTokens.value = fixture.mintIdentityToken(true);
    renderWidget({ withHook: true });
    await flush();
    expect(probe.hook?.status).toBe("idle");
    // The mount-time check already dropped the foreign marker; put one back for the ask.
    seedMarker(JSON.stringify({ started: Date.now(), subject: OTHER_PRIVY_USER }));

    let refusal: FluentAuthError | null = null;
    const pending = probe.hook?.linkX().catch((err: FluentAuthError) => {
      refusal = err;
    });
    await flushUntil(() => probe.hook?.status === "error");
    await pending;

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("link_failed");
    expect(refusal).toBe(probe.hook?.error);
    expect(storedMarker()).toBeNull();
    expectNoWork();
  });

  it("keeps a marker for the subject a signed-out page is still waiting for", async () => {
    // No Fluent session yet is not "another subject": the marker waits for Privy, and for the
    // session the widget derives from the user Privy restores.
    seedMarker(JSON.stringify({ started: Date.now(), subject: PRIVY_USER }));
    privyRestoring();
    renderWidget({ withHook: false });

    const call = linkXInFlight();
    await flush();

    expect(call.settled()).toBeNull();
    expect(storedMarker()).not.toBeNull();
    expectNoWork();
  });
});

describe("every rejection is one of linkX()'s own codes", () => {
  it("hands a direct caller link_failed when refreshUser() rejects with an ordinary error", async () => {
    seedSession();
    fixture.onRefreshUser = () => {
      throw new Error("Privy is unreachable");
    };
    renderWidget({ withHook: false });

    const error = await linkXRefusal();

    expect(error).toBeInstanceOf(FluentAuthError);
    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Privy is unreachable");
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(0);
  });

  it("reports the same code through useLinkX()", async () => {
    seedSession();
    fixture.onRefreshUser = () => {
      throw new Error("Privy is unreachable");
    };
    renderWidget({ withHook: true });

    let refusal: FluentAuthError | null = null;
    const pending = probe.hook?.linkX().catch((err: FluentAuthError) => {
      refusal = err;
    });
    await flushUntil(() => probe.hook?.status === "error");
    await pending;

    expect(probe.hook?.status).toBe("error");
    expect(probe.hook?.error?.code).toBe("link_failed");
    expect(refusal).toBe(probe.hook?.error);
  });
});

describe("the identity token the POST carries", () => {
  it("is the one Privy publishes after refreshUser()", async () => {
    seedSession();
    fixture.onRefreshUser = () => fixture.setIdentityToken(fixture.mintIdentityToken(true));
    renderWidget({ withHook: false });

    await expect(linkXNow()).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(fixture.refreshUserCalls).toBe(1);
    expect(JSON.parse(String(wire.identityPosts[0]?.init.body)).identityToken).toBe(
      fixture.identityTokens.value,
    );
    expect(fixture.linkTwitterCalls).toBe(0);
  });

  it("fails the call with link_failed when Privy never publishes one", async () => {
    seedSession();
    // `refreshUser()` resolves and the store never changes: no commit carries a new token.
    fixture.onRefreshUser = () => {};
    renderWidget({ withHook: false });
    vi.useFakeTimers();

    const refusals: FluentAuthError[] = [];
    const pending = probe.linkX().then(
      () => undefined,
      (err: FluentAuthError) => {
        refusals.push(err);
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    await pending;

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.code).toBe("link_failed");
    expect(fixture.linkTwitterCalls).toBe(0);
    expect(wire.identityPosts).toHaveLength(0);
  });
});

describe("useLinkX, imported from the package root", () => {
  it("is the hook the SDK exports", () => {
    expect(typeof useLinkX).toBe("function");
  });
});
