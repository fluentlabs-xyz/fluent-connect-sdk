/**
 * @vitest-environment jsdom
 *
 * What `FluentWidgetContent`'s callbacks and effects do today, observed through the public
 * `FluentWidget` under `StrictMode`: the connect button's click, Direct login on mount, the
 * disconnect, the sign-in dialog's Fluent method, a send's login request, and `linkX()` with its
 * return gate. Each case changes the value a callback or effect reads once and renders once for
 * an unrelated reason, and counts what reached the fakes.
 *
 * Fakes (`test/fakes/fluentId.ts` says how each answers):
 * - `@privy-io/react-auth@2.25.0`: the fake's signed-in user, here with an X account and an
 *   identity token that names it on demand, `usePrivy().ready` held false on demand (as Privy
 *   answers while it finishes an OAuth return for a restored user), `useWallets()` listing no
 *   Signer on demand (as before the Signer is created), and `linkTwitter`, `refreshUser`,
 *   `initOAuth` and `createWallet` counted, the last left in flight;
 * - `@zerodev/sdk@5.5.10` `createKernelAccount` and `@zerodev/ecdsa-validator@5.4.9`
 *   `signerToEcdsaValidator`: the smart account at `SMART_ACCOUNT`;
 * - `@reown/appkit/react@1.8.20` `createAppKit` and `useAppKit`, the modal only;
 * - `posthog-js@1.416.0` `init`, whose client records every `capture`;
 * - `fetch`: the fake's chain, bundler, paymaster and service, and fluent-connect-service's
 *   `POST /me/identity/privy` answering an X account.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRIVY_IDENTITY_TOKEN,
  PRIVY_USER,
  boundary,
  resetBoundary,
  stubNetwork,
} from "../../test/fakes/fluentId";
import { FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, type FluentWidgetConfig } from "../core/config";
import {
  FLUENT_LINK_X_MARKER_KEY,
  type FluentLinkXResult,
  isLinkXIntentDiscarded,
} from "../core/linkX";
import { resetAuthTokenSessions } from "./hooks/useAuthToken";

// The whole widget mounts per case, as in the other end-to-end widget tests.
vi.setConfig({ testTimeout: 30_000 });

/** What the Privy overrides below read and count; shared with the module factories. */
const privy = vi.hoisted(() => {
  const claims = {
    sub: "did:privy:fluent-id-owner",
    linked_accounts: JSON.stringify([{ type: "twitter_oauth", subject: "1458" }]),
  };
  const payload = btoa(JSON.stringify(claims)).replace(/=+$/, "");
  return {
    /** Whether the signed-in user has an X account, in `linkedAccounts` and in the token. */
    hasX: false,
    /** Bumped by `refreshUser()`: Privy mints a new identity token on every refresh. */
    tokenVersion: 0,
    tokenWithX: `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`,
    /** What `usePrivy().ready` answers. */
    ready: true,
    /** Whether `useWallets()` lists the signed-in user's Signer. */
    signerListed: true,
    linkTwitterCalls: 0,
    refreshUserCalls: 0,
    initOAuthCalls: [] as unknown[],
    createWalletCalls: 0,
  };
});

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init: () => ({ capture: analytics.capture }) } }));
vi.mock("@privy-io/react-auth", async () => {
  const fakes = await import("../../test/fakes/fluentId");
  const base = fakes.privyModule();
  const usePrivy = base.usePrivy as () => { user: unknown };
  const useWallets = base.useWallets as () => unknown;
  const noSigner = { ready: true, wallets: [] };
  // Built once, so they keep their identity across renders, as Privy's objects do.
  const userWithX = {
    id: fakes.PRIVY_USER,
    linkedAccounts: [{ type: "twitter_oauth", subject: "1458", username: "fluentxyz" }],
  };
  const linkAccount = {
    linkTwitter: () => {
      privy.linkTwitterCalls += 1;
    },
  };
  const user = {
    refreshUser: async () => {
      privy.refreshUserCalls += 1;
      privy.tokenVersion += 1;
    },
  };
  const createWallet = {
    // Privy's creation resolves once the Signer exists; the case lists the Signer itself.
    createWallet: () => {
      privy.createWalletCalls += 1;
      return new Promise(() => {});
    },
  };
  const oauth = {
    initOAuth: async (options: unknown) => {
      privy.initOAuthCalls.push(options);
    },
    state: { status: "initial" },
  };
  return {
    ...base,
    usePrivy: () => {
      const live = usePrivy();
      const answer = live.user && privy.hasX ? { ...live, user: userWithX } : live;
      return privy.ready ? answer : { ...answer, ready: false };
    },
    useWallets: () => {
      const live = useWallets();
      return privy.signerListed ? live : noSigner;
    },
    useIdentityToken: () => {
      if (!fakes.boundary.signedIn) return { identityToken: null };
      if (privy.hasX) return { identityToken: privy.tokenWithX };
      const version = privy.tokenVersion === 0 ? "" : `.${privy.tokenVersion}`;
      return { identityToken: `${fakes.PRIVY_IDENTITY_TOKEN}${version}` };
    },
    useLinkAccount: () => linkAccount,
    useCreateWallet: () => createWallet,
    useLoginWithOAuth: () => oauth,
    useUser: () => user,
  };
});
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);
vi.mock("@reown/appkit/react", async () =>
  (await import("../../test/fakes/fluentId")).reownAppKitModule(),
);

const { FluentWidget } = await import("./FluentWidget");
const { useFluentWidget } = await import("./widgetContext");
const { resetFluentAnalytics } = await import("../core/analytics");
type FluentWidgetRenderContext = import("./FluentWidget").FluentWidgetRenderContext;
type FluentWidgetConnectButtonRenderContext =
  import("./FluentWidget").FluentWidgetConnectButtonRenderContext;

/** Analytics on, so `track` reaches the `posthog-js` fake. */
const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
};

const X_ACCOUNT = {
  id: "1458",
  handle: "fluentxyz",
  avatarUrl: "https://pbs.twimg.com/profile_images/1458/avatar.jpg",
};
const DIRECT_LOGIN_INTENT_KEY = "fluent:widget:direct-login-intent:v1";

/** What the host saw: the connect button's context, the hook, and every session callback. */
let host: {
  button: FluentWidgetConnectButtonRenderContext | null;
  hook: FluentWidgetRenderContext | null;
  sessions: unknown[];
};

function HookProbe() {
  host.hook = useFluentWidget();
  return null;
}

/** The widget under `StrictMode`; a new `label` is a render nothing under test reads. */
function widgetElement(label = "Account", config: FluentWidgetConfig = CONFIG) {
  return (
    <StrictMode>
      <FluentWidget
        config={config}
        onSessionChange={(session) => {
          host.sessions.push(session);
        }}
        renderConnectButton={(context) => {
          host.button = context;
          return (
            <button type="button" onClick={context.onClick}>
              {label}
            </button>
          );
        }}
        renderHome={() => <HookProbe />}
      />
    </StrictMode>
  );
}

function renderWidget(config: FluentWidgetConfig = CONFIG) {
  return render(widgetElement("Account", config));
}

/** The names of the events `track` sent, in order. */
function events(): string[] {
  return analytics.capture.mock.calls.map(([name]) => String(name));
}

function eventCount(name: string): number {
  return events().filter((event) => event === name).length;
}

function sessionsCreated(): number {
  return host.sessions.filter((session) => session !== null).length;
}

async function signedIn(): Promise<void> {
  await waitFor(() => expect(host.button?.connected).toBe(true), { timeout: 15_000 });
  await waitFor(() => expect(host.hook?.session).toBeTruthy());
}

/** Answers `POST /me/identity/privy` with an X account and counts the posts. */
function answerIdentityLink(): { posts: number } {
  const network = globalThis.fetch;
  const seen = { posts: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "object" && "url" in input ? input.url : String(input);
      if (!href.endsWith("/me/identity/privy")) return network(input, init);
      seen.posts += 1;
      return new Response(
        JSON.stringify({ subject: PRIVY_USER, appId: CONFIG.appId, x: X_ACCOUNT }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );
  return seen;
}

/** Settles a promise the case does not await yet, so its state can be read. */
function observe<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

/** Calls `linkX()` on the render context of the latest render, without awaiting it. */
function startLinkX() {
  const hook = host.hook;
  if (!hook) throw new Error("the widget has not rendered its home yet");
  let call = observe<FluentLinkXResult>(new Promise(() => {}));
  act(() => {
    call = observe(hook.linkX());
  });
  return call;
}

beforeEach(() => {
  host = { button: null, hook: null, sessions: [] };
  Object.assign(privy, {
    hasX: false,
    tokenVersion: 0,
    ready: true,
    signerListed: true,
    linkTwitterCalls: 0,
    refreshUserCalls: 0,
    initOAuthCalls: [],
    createWalletCalls: 0,
  });
  resetBoundary();
  resetAuthTokenSessions();
  resetFluentAnalytics();
  analytics.capture.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubNetwork();
  for (const method of ["log", "debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("the connect button's click", () => {
  it("opens the sign-in dialog and tracks one connect_opened per press while nobody is connected", async () => {
    resetBoundary({ signedIn: false });
    const { rerender } = renderWidget();
    await waitFor(() => expect(host.button).not.toBeNull());
    rerender(widgetElement("Connect"));
    expect(screen.queryByText("Continue with X")).toBeNull();

    act(() => host.button?.onClick());

    await waitFor(() => expect(screen.getByText("Continue with X")).toBeTruthy());
    await waitFor(() => expect(eventCount("connect_opened")).toBe(1));
    expect(
      analytics.capture.mock.calls.find(([name]) => name === "connect_opened")?.[1],
    ).toMatchObject({
      trigger: "connect_button",
    });
    expect(screen.queryByRole("dialog", { name: "Connected account" })).toBeNull();
  });

  it("toggles the account drawer once a Fluent ID is connected, and tracks no connect_opened", async () => {
    const { rerender } = renderWidget();
    await signedIn();
    rerender(widgetElement("Me"));
    expect(screen.queryByRole("dialog", { name: "Connected account" })).toBeNull();

    act(() => host.button?.onClick());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Connected account" })).toBeTruthy(),
    );

    act(() => host.button?.onClick());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Connected account" })).toBeNull(),
    );
    expect(eventCount("connect_opened")).toBe(0);
    expect(screen.queryByText("Continue with X")).toBeNull();
  });
});

describe("Direct login on mount", () => {
  it("creates one Widget session for the signed-in Privy user, and an unrelated render, a new identity token or a new App id creates none", async () => {
    const { rerender } = renderWidget();
    await signedIn();
    await waitFor(() => expect(eventCount("connect_login_completed")).toBe(1));
    expect(sessionsCreated()).toBe(1);
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBe(
      PRIVY_IDENTITY_TOKEN,
    );

    rerender(widgetElement("Me"));
    privy.tokenVersion = 1;
    rerender(widgetElement("Me"));
    await act(async () => {});
    rerender(widgetElement("Me", { ...CONFIG, appId: "app_11111111111111111111111111111111" }));
    await act(async () => {});

    // Pins current behaviour: a new App id re-issues nothing for the session already held.
    expect(sessionsCreated()).toBe(1);
    expect(eventCount("connect_login_completed")).toBe(1);
    // Pins current behaviour: the stored identity token stays the one the sign-in wrote.
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBe(
      PRIVY_IDENTITY_TOKEN,
    );
    expect(host.hook?.session).toBeTruthy();
  });

  it("creates no Widget session while Privy is not ready, and one once it turns ready with the Signer listed", async () => {
    privy.ready = false;
    const { rerender } = renderWidget();
    await waitFor(() => expect(host.button).not.toBeNull());
    await act(async () => {});
    rerender(widgetElement("Me"));
    await act(async () => {});

    expect(sessionsCreated()).toBe(0);
    expect(eventCount("connect_login_completed")).toBe(0);
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBeNull();
    expect(host.button?.connected).toBe(false);
    expect(host.hook?.session ?? null).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(privy.createWalletCalls).toBe(0);

    privy.ready = true;
    rerender(widgetElement("Me"));
    await signedIn();
    await waitFor(() => expect(eventCount("connect_login_completed")).toBe(1));
    rerender(widgetElement("Account"));
    await act(async () => {});

    expect(sessionsCreated()).toBe(1);
    expect(eventCount("connect_login_completed")).toBe(1);
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBe(
      PRIVY_IDENTITY_TOKEN,
    );
    expect(host.button?.connected).toBe(true);
    expect(privy.createWalletCalls).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates no Widget session while the Signer is not listed, and one once it is, with Privy ready", async () => {
    privy.signerListed = false;
    const { rerender } = renderWidget();
    await waitFor(() => expect(host.button).not.toBeNull());
    await act(async () => {});
    rerender(widgetElement("Me"));
    await act(async () => {});

    expect(sessionsCreated()).toBe(0);
    expect(eventCount("connect_login_completed")).toBe(0);
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBeNull();
    expect(host.button?.connected).toBe(false);
    expect(host.hook?.session ?? null).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Pins current behaviour: the closed sign-in dialog stays mounted and starts the missing Signer's creation once.
    expect(privy.createWalletCalls).toBe(1);

    privy.signerListed = true;
    rerender(widgetElement("Me"));
    await signedIn();
    await waitFor(() => expect(eventCount("connect_login_completed")).toBe(1));
    rerender(widgetElement("Account"));
    await act(async () => {});

    expect(sessionsCreated()).toBe(1);
    expect(eventCount("connect_login_completed")).toBe(1);
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBe(
      PRIVY_IDENTITY_TOKEN,
    );
    expect(host.button?.connected).toBe(true);
    expect(privy.createWalletCalls).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("disconnect()", () => {
  it("logs Privy out, ends the Widget session, removes the stored identity token and tracks one wallet_disconnected", async () => {
    const { rerender } = renderWidget();
    await signedIn();

    await act(async () => {
      await host.hook?.disconnect();
    });
    rerender(widgetElement("Connect"));

    expect(boundary.signedIn).toBe(false);
    await waitFor(() => expect(host.sessions.at(-1)).toBeNull());
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(eventCount("wallet_disconnected")).toBe(1));
    expect(host.button?.connected).toBe(false);

    rerender(widgetElement("Connect again"));
    await act(async () => {});
    expect(sessionsCreated()).toBe(1);
    expect(eventCount("connect_login_completed")).toBe(1);
    expect(host.hook?.session).toBeNull();
  });
});

describe("starting a Fluent ID sign-in", () => {
  it("from the dialog's Continue with X, arms the Direct login intent and starts X's OAuth once when nobody is signed in", async () => {
    resetBoundary({ signedIn: false });
    const { rerender } = renderWidget();
    await waitFor(() => expect(host.hook).not.toBeNull());
    act(() => host.hook?.openConnect());

    fireEvent.click(await waitFor(() => screen.getByText("Continue with X")));

    await waitFor(() => expect(privy.initOAuthCalls).toHaveLength(1));
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    rerender(widgetElement("Connect"));
    await act(async () => {});
    expect(privy.initOAuthCalls).toHaveLength(1);
    expect(sessionsCreated()).toBe(0);
  });

  it("from the Reputation tab's Connect with X, ends the session and issues a new one before Privy's logout commits", async () => {
    const config = { ...CONFIG, reputationEnabled: true };
    const { rerender } = renderWidget(config);
    await signedIn();
    act(() => host.button?.onClick());
    fireEvent.mouseDown(await waitFor(() => screen.getByRole("tab", { name: "Reputation" })));
    fireEvent.click(screen.getByRole("tab", { name: "Reputation" }));
    const relogin = await waitFor(() => screen.getByRole("button", { name: /Connect with X/ }));

    await act(async () => {
      fireEvent.click(relogin);
    });
    rerender(widgetElement("Me", config));
    await act(async () => {});

    expect(boundary.signedIn).toBe(false);
    // Pins current behaviour: the new session is issued off the render before the logout committed, so it stands while Privy reports nobody signed in.
    expect(host.sessions.map((session) => session !== null)).toEqual([true, false, true]);
    expect(eventCount("connect_login_completed")).toBe(2);
    expect(eventCount("wallet_disconnected")).toBe(0);
    expect(privy.initOAuthCalls).toHaveLength(0);
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).toBe(
      PRIVY_IDENTITY_TOKEN,
    );
    expect(screen.queryByText("Continue with X")).toBeNull();
  });
});

describe("a send while Privy is signed out", () => {
  it("opens the sign-in dialog and arms the intent once per request, and an unrelated render reopens nothing", async () => {
    resetBoundary({ signedIn: false });
    const { rerender } = renderWidget();
    await waitFor(() => expect(host.hook).not.toBeNull());
    const send = () =>
      host.hook?.widget
        .createBatchOp({
          calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x" }],
        })
        .execute({ confirmation: "silent" });

    let refusal: unknown;
    await act(async () => {
      await send()?.catch((error: unknown) => {
        refusal = error;
      });
    });

    expect(String(refusal)).toContain("Complete wallet login, then submit the transaction again");
    await waitFor(() => expect(screen.getByText("Continue with X")).toBeTruthy());
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");

    fireEvent.keyDown(screen.getAllByRole("dialog")[0] as HTMLElement, { key: "Escape" });
    await act(async () => {});
    expect(screen.queryByText("Continue with X")).toBeNull();
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBeNull();
    rerender(widgetElement("Connect"));
    await act(async () => {});
    expect(screen.queryByText("Continue with X")).toBeNull();

    await act(async () => {
      await send()?.catch(() => undefined);
    });
    expect(screen.getByText("Continue with X")).toBeTruthy();
    expect(window.sessionStorage.getItem(DIRECT_LOGIN_INTENT_KEY)).toBe("1");
    // Pins current behaviour: a login a send asks for opens the dialog without connect_opened.
    expect(eventCount("connect_opened")).toBe(0);
  });
});

describe("linkX()", () => {
  it("drops another subject's marker without calling Privy", async () => {
    renderWidget();
    await signedIn();
    window.sessionStorage.setItem(
      FLUENT_LINK_X_MARKER_KEY,
      JSON.stringify({ started: 1, subject: "did:privy:someone-else" }),
    );

    let refusal: unknown;
    await act(async () => {
      await host.hook?.linkX().catch((error: unknown) => {
        refusal = error;
      });
    });

    expect(isLinkXIntentDiscarded(refusal)).toBe(true);
    expect(window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY)).toBeNull();
    expect(privy.linkTwitterCalls).toBe(0);
    expect(privy.refreshUserCalls).toBe(0);
  });

  it("waits on its own subject's marker through an unrelated render, then links once Privy reports the X account", async () => {
    const { rerender } = renderWidget();
    await signedIn();
    const identity = answerIdentityLink();
    window.sessionStorage.setItem(
      FLUENT_LINK_X_MARKER_KEY,
      JSON.stringify({ started: 1, subject: PRIVY_USER }),
    );

    const call = startLinkX();
    rerender(widgetElement("Me"));
    await act(async () => {});
    expect(call.settled).toBe(false);
    expect(window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY)).not.toBeNull();

    privy.hasX = true;
    rerender(widgetElement("Me"));

    await waitFor(() => expect(call.settled).toBe(true));
    expect(call.error).toBeUndefined();
    expect(call.value).toEqual({ status: "linked", x: X_ACCOUNT });
    expect(identity.posts).toBe(1);
    expect(window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY)).toBeNull();
    expect(privy.linkTwitterCalls).toBe(0);
  });

  it("refreshes the identity token once and starts X's link once when the token has no X", async () => {
    const { rerender } = renderWidget();
    await signedIn();

    const call = startLinkX();
    await act(async () => {});
    rerender(widgetElement("Me"));

    await waitFor(() => expect(call.settled).toBe(true));
    expect(call.error).toBeUndefined();
    expect(call.value).toEqual({ status: "redirecting" });
    expect(privy.refreshUserCalls).toBe(1);
    expect(privy.linkTwitterCalls).toBe(1);
    expect(
      JSON.parse(window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY) ?? "{}"),
    ).toMatchObject({
      subject: PRIVY_USER,
    });
  });

  it("holds X's link while Privy reports nobody, through an unrelated render, and starts it when the user is back", async () => {
    const { rerender } = renderWidget();
    await signedIn();

    const call = startLinkX();
    await act(async () => {});
    boundary.signedIn = false;
    rerender(widgetElement("Me"));
    await act(async () => {});
    rerender(widgetElement("Me again"));
    await act(async () => {});
    expect(call.settled).toBe(false);
    expect(privy.linkTwitterCalls).toBe(0);
    expect(
      JSON.parse(window.sessionStorage.getItem(FLUENT_LINK_X_MARKER_KEY) ?? "{}"),
    ).toMatchObject({
      subject: PRIVY_USER,
    });

    boundary.signedIn = true;
    rerender(widgetElement("Me"));

    await waitFor(() => expect(call.settled).toBe(true));
    expect(call.error).toBeUndefined();
    expect(call.value).toEqual({ status: "redirecting" });
    expect(privy.linkTwitterCalls).toBe(1);
  });
});
