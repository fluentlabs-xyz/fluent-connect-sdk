/**
 * @vitest-environment jsdom
 *
 * The widget, end to end, for a person who signs in to a Fluent ID: what the host receives
 * (FLU-1622, criteria 2.2, 2.17, 3.2, 3.3, 3.4, 3.6 and 3.7), and what a restored stored session
 * the host's projection rejects leaves behind.
 *
 * Privy reports a signed-in user with an identity token and one Signer, which is the state in
 * which the widget completes Direct login by itself on mount: it derives the smart account
 * (`zerodevSession.ts`), builds the Widget session, exchanges an Auth token and reads the person's
 * Quick sign (`core/settingsClient.ts`), with `reownAppKit.tsx` and every other module of this
 * repository running for real.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors and how):
 * - `@privy-io/react-auth` 2.25.0: the signed-in user and its Signer, whose provider signs for
 *   the silent kernel and whose `useSignMessage` signs for the prompting one, each with its own
 *   signature, so a case can tell which signed;
 * - `@zerodev/sdk` 5.5.10 `createKernelAccount` and `@zerodev/ecdsa-validator` 5.4.9
 *   `signerToEcdsaValidator`: the smart account at `SMART_ACCOUNT`, signing through its Signer;
 * - `@reown/appkit/react` 1.8.20 `createAppKit` and `useAppKit`, the External wallet modal;
 * - `fetch`: the widget chain, the ZeroDev bundler, the sponsorship paymaster and
 *   fluent-connect-service, whose `GET /me/settings` answers the person's Quick sign, or fails
 *   (500), after which the widget keeps its default (on), as a case sets it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRIVY_USER,
  PROMPT_SIGNATURE,
  PROVIDER_SIGNATURE,
  SIGNER,
  SMART_ACCOUNT,
  boundary,
  methodsAt,
  resetBoundary,
  stubNetwork,
} from "../../test/fakes/fluentId";
import {
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  type FluentWidgetConfig,
} from "../core/config";
import { resetAuthTokenSessions } from "./hooks/useAuthToken";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
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
const { useFluentIframeBridge } = await import("./hooks/useFluentIframeBridge");
type FluentWidgetRenderContext = import("./FluentWidget").FluentWidgetRenderContext;
type FluentWidgetProps = import("./FluentWidget").FluentWidgetProps;

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

/**
 * What the host saw: the callback's sessions, the render context and hook of the latest render,
 * every widget object any render handed it, and what each render showed of the connection.
 */
let host: {
  sessionChanges: unknown[];
  renderContext: FluentWidgetRenderContext | null;
  hook: FluentWidgetRenderContext | null;
  widgets: unknown[];
  sessionViews: unknown[];
  states: Array<{ session: unknown; status: unknown; address: unknown }>;
};

const EMBEDDED_ORIGIN = "https://market.example";

function HookProbe() {
  host.hook = useFluentWidget();
  host.widgets.push(host.hook.widget);
  host.sessionViews.push(host.hook.session);
  host.states.push({
    session: host.hook.session,
    status: host.hook.status,
    address: host.hook.widget.account.address,
  });
  // An embedded page, answered by the public bridge from the same render context.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useFluentIframeBridge(iframeRef, { allowedOrigin: EMBEDDED_ORIGIN });
  return (
    <div data-testid="hook-probe">
      <iframe ref={iframeRef} title="embedded page" />
    </div>
  );
}

let iframeRequestId = 0;

/** Asks the bridge for the embedded page's accounts, as the page would, and returns the reply. */
async function iframeAccounts(): Promise<unknown> {
  const iframe = screen.getByTitle("embedded page") as HTMLIFrameElement;
  const target = iframe.contentWindow as Window;
  const posted = vi.spyOn(target, "postMessage").mockImplementation(() => {});
  const id = ++iframeRequestId;
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: EMBEDDED_ORIGIN,
      source: target,
      data: { jsonrpc: "2.0", id, method: "eth_accounts" },
    }),
  );
  const reply = await waitFor(() => {
    const found = posted.mock.calls
      .map(([message]) => message as { id?: unknown; result?: unknown })
      .find((message) => message.id === id);
    expect(found).toBeDefined();
    return found;
  });
  posted.mockRestore();
  return reply?.result;
}

function widgetElement(props: Partial<FluentWidgetProps> = {}, config: FluentWidgetConfig = CONFIG) {
  return (
    <FluentWidget
      config={config}
      onSessionChange={(session) => {
        host.sessionChanges.push(session);
      }}
      renderHome={(context) => {
        host.renderContext = context;
        host.widgets.push(context.widget);
        host.sessionViews.push(context.session);
        return <HookProbe />;
      }}
      {...props}
    />
  );
}

function renderWidget(props: Partial<FluentWidgetProps> = {}, config: FluentWidgetConfig = CONFIG) {
  return render(widgetElement(props, config));
}

/** Every key path of a value, nested objects included: `account`, `account.address`, … */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = prefix ? `${prefix}.${key}` : key;
    return [here, ...keyPaths(child, here)];
  });
}

const ALLOWLIST = ["account", "account.address", "account.type", "issuedAt"];

/** What only the stored session holds; none of it may reach the host in any form. */
const STORED_ONLY = [PRIVY_USER, SIGNER, "privy-identity-token", "mock.", "idToken", "scopes"];

/** A stored session for the Privy user the widget signs in, as an earlier page load left it. */
function seedStoredSession() {
  window.localStorage.setItem(
    FLUENT_WIDGET_SESSION_STORAGE_KEY,
    JSON.stringify({
      app: { mode: "registered", origin: "http://localhost", appName: "test" },
      appId: CONFIG.appId,
      idToken: "mock.e30.signature",
      user: { id: PRIVY_USER },
      wallet: { signerAddress: SIGNER, smartAccountAddress: SMART_ACCOUNT },
      scopes: ["openid"],
      issuedAt: 1_760_000_000,
      metadata: { origin: "http://localhost" },
    }),
  );
}

/** The widget object of the latest render, read past the type: some members are under test. */
function widgetObject(): Record<string, unknown> & FluentWidgetRenderContext["widget"] {
  return host.hook?.widget as Record<string, unknown> & FluentWidgetRenderContext["widget"];
}

/** Waits for the sign-in the widget completes on mount, and returns what the callback got. */
async function signedInSession(): Promise<unknown> {
  await waitFor(
    () => expect(host.sessionChanges.some((session) => session !== null)).toBe(true),
    { timeout: 15_000 },
  );
  await waitFor(() => expect(host.renderContext?.session).toBeTruthy());
  await waitFor(() => expect(host.hook?.session).toBeTruthy());
  return host.sessionChanges.filter((session) => session !== null).at(-1);
}

beforeEach(() => {
  host = {
    sessionChanges: [],
    renderContext: null,
    hook: null,
    widgets: [],
    sessionViews: [],
    states: [],
  };
  resetBoundary();
  resetAuthTokenSessions();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubNetwork();
  // `debugLogging` writes the widget's diagnostics to the console; the debug panel's case reads
  // what they carry.
  for (const method of ["log", "debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("criteria 3.2 and 3.3: the host's three views of the session", () => {
  it("after a sign-in, are one allowlisted projection naming the Fluent ID's account", async () => {
    renderWidget();
    const delivered = await signedInSession();
    const views = [delivered, host.renderContext?.session, host.hook?.session];

    // 3.2: each view holds exactly the allowlisted keys, recursively.
    for (const view of views) expect(keyPaths(view).sort()).toEqual(ALLOWLIST);
    expect(typeof (delivered as { issuedAt?: unknown }).issuedAt).toBe("number");
    // 3.2: one projection, equal across the views, holding nothing only the stored session has.
    expect(host.renderContext?.session).toEqual(delivered);
    expect(host.hook?.session).toEqual(delivered);
    for (const view of views) {
      const text = JSON.stringify(view);
      expect(STORED_ONLY.filter((value) => text.includes(value))).toEqual([]);
    }
    // 3.3: the account is the signed-in Fluent ID's address, a smart account.
    const { account } = delivered as { account?: { address?: unknown; type?: unknown } };
    expect(account?.address).toBe(SMART_ACCOUNT);
    expect(account?.type).toBe("smart");
  }, 30_000);

  it("hold exactly the allowlisted keys for a session restored from storage", async () => {
    seedStoredSession();
    renderWidget();

    await waitFor(() => expect(host.renderContext?.session).toBeTruthy());
    expect(keyPaths(host.renderContext?.session).sort()).toEqual(ALLOWLIST);
    expect(keyPaths(host.hook?.session).sort()).toEqual(ALLOWLIST);
    const text = JSON.stringify(host.hook?.session);
    expect(STORED_ONLY.filter((value) => text.includes(value))).toEqual([]);
  }, 30_000);

  it("keep their reference across a no-op render, and turn null on disconnect()", async () => {
    const { rerender } = renderWidget();
    await signedInSession();
    const fromContext = host.renderContext?.session;
    const fromHook = host.hook?.session;
    expect(fromHook).toBe(fromContext);
    const views = host.sessionViews.length;

    rerender(widgetElement());

    await waitFor(() => expect(host.sessionViews.length).toBeGreaterThan(views));
    expect(host.renderContext?.session).toBe(fromContext);
    expect(host.hook?.session).toBe(fromHook);

    await act(async () => {
      await host.hook?.disconnect();
    });

    await waitFor(() => expect(host.sessionChanges.at(-1)).toBeNull());
    await waitFor(() => expect(host.renderContext?.session).toBeNull());
    expect(host.hook?.session).toBeNull();
  }, 30_000);
});

/** What a malformed restore case plants in the stored session's address or issuedAt. */
const PLANTED = { idToken: "mock.e30.signature", user: { id: PRIVY_USER } };

/**
 * No render's session, `widget.account.address` or status, no callback value, no reply to the
 * embedded page and no console argument carries a field of the restored session; and no render
 * showed a connected Fluent ID without its session.
 */
function expectNothingRestoredReachedTheHost(iframeReplies: unknown[]) {
  expect(host.states.filter(({ address }) => address !== undefined && address !== SMART_ACCOUNT))
    .toEqual([]);
  expect(host.states.filter(({ status, session }) => status === "connected" && !session))
    .toEqual([]);
  for (const value of [host.states, host.sessionChanges, iframeReplies]) {
    const text = JSON.stringify(value);
    expect(STORED_ONLY.filter((field) => text.includes(field))).toEqual([]);
  }
  const logged = consoleText();
  expect(logged).not.toContain(PRIVY_USER);
  expect(logged).not.toContain(PLANTED.idToken);
  expect(logged.toLowerCase()).not.toContain(SIGNER.toLowerCase());
}

describe("a restored stored session the host's projection rejects", () => {
  it.each([
    ["an address that is an object and a valid issuedAt", PLANTED, 1_760_000_000],
    ["a valid address and an issuedAt that is an object", SMART_ACCOUNT, PLANTED],
  ])("with %s, reads as none, reaches the host in no form, and Direct login runs again", async (
    _shape,
    smartAccountAddress,
    issuedAt,
  ) => {
    window.localStorage.setItem(
      FLUENT_WIDGET_SESSION_STORAGE_KEY,
      JSON.stringify({
        app: { mode: "registered", origin: "http://localhost", appName: "test" },
        appId: CONFIG.appId,
        idToken: "mock.e30.signature",
        user: { id: PRIVY_USER },
        wallet: { signerAddress: SIGNER, smartAccountAddress },
        issuedAt,
      }),
    );
    renderWidget({ debugLogging: true });
    await waitFor(() => expect(host.hook).not.toBeNull());
    const replies = [await iframeAccounts()];

    // The first render restored no session, and neither then nor after Direct login below does
    // any of the host's views carry a field of the restored session.
    expect(host.states[0]?.session).toBeNull();
    expectNothingRestoredReachedTheHost(replies);

    // Direct login runs again, as for a person with no stored session, and issues a new one.
    const delivered = await signedInSession();
    expect(keyPaths(delivered).sort()).toEqual(ALLOWLIST);
    const stored = JSON.parse(
      window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY) ?? "null",
    ) as { issuedAt?: unknown; wallet?: { smartAccountAddress?: unknown } } | null;
    expect(typeof stored?.issuedAt).toBe("number");
    expect(stored?.wallet?.smartAccountAddress).toBe(SMART_ACCOUNT);
    replies.push(await iframeAccounts());
    expect(replies.at(-1)).toEqual([SMART_ACCOUNT]);
    expectNothingRestoredReachedTheHost(replies);
  }, 30_000);
});

describe("criterion 3.4: the widget's stored session", () => {
  it("keeps today's fields", async () => {
    renderWidget();
    await signedInSession();

    const stored = JSON.parse(
      window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY) ?? "null",
    ) as {
      app?: unknown;
      appId?: unknown;
      user?: { id?: unknown };
      idToken?: unknown;
      wallet?: { smartAccountAddress?: unknown; signerAddress?: unknown };
      issuedAt?: unknown;
      metadata?: unknown;
    } | null;
    expect(stored?.app).toBeTruthy();
    expect(stored?.appId).toBe(CONFIG.appId);
    expect(stored?.user?.id).toBe(PRIVY_USER);
    expect(typeof stored?.idToken).toBe("string");
    expect(stored?.wallet?.smartAccountAddress).toBe(SMART_ACCOUNT);
    expect(stored?.wallet?.signerAddress).toBe(SIGNER);
    expect(typeof stored?.issuedAt).toBe("number");
    expect(stored?.metadata).toBeTruthy();
  }, 30_000);
});

describe("FLU-1638: one stored session", () => {
  it("leaves no fluent:connect:session:v1 copy in localStorage after sign-in", async () => {
    renderWidget();
    await signedInSession();
    // Past the sign-in's own writes: the identity token is stored after both setSession calls.
    await waitFor(() =>
      expect(window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY)).not.toBeNull(),
    );

    const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    );
    expect(keys).toContain(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    expect(keys).not.toContain("fluent:connect:session:v1");
    expect(window.localStorage.getItem("fluent:connect:session:v1")).toBeNull();
    // The widget's stored session is the one key that carries the Privy DID.
    expect(
      keys.filter((key) => key && window.localStorage.getItem(key)?.includes(PRIVY_USER)),
    ).toEqual([FLUENT_WIDGET_SESSION_STORAGE_KEY]);
  }, 30_000);
});

describe("criterion 3.6: a config.scopes a JavaScript host still passes", () => {
  it("is ignored: the widget signs in, and no session it builds carries it", async () => {
    const legacy = { ...CONFIG, scopes: ["legacy-host-scope"] } as unknown as FluentWidgetConfig;
    renderWidget({}, legacy);
    const delivered = await signedInSession();

    expect(JSON.stringify(delivered)).not.toContain("legacy-host-scope");
    expect(window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY) ?? "").not.toContain(
      "legacy-host-scope",
    );
  }, 30_000);
});

/** Every argument the widget passed to the console, as text. */
function consoleText(): string {
  const methods = ["log", "debug", "info", "warn", "error"] as const;
  return methods
    .flatMap((method) => vi.mocked(console[method]).mock.calls.flat())
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ""}`;
      try {
        return JSON.stringify(arg, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        );
      } catch {
        return String(arg);
      }
    })
    .join("\n");
}

describe("criterion 3.7: the debug panel", () => {
  it("shows the projected session, not the stored one", async () => {
    renderWidget({ debugLogging: true });
    await signedInSession();

    const panel = await waitFor(() => {
      const found = Array.from(document.querySelectorAll("pre")).find((pre) =>
        (pre.textContent ?? "").includes(SMART_ACCOUNT),
      );
      expect(found).toBeDefined();
      return found as HTMLPreElement;
    });
    const text = panel.textContent ?? "";
    expect(text).toContain("smart");
    expect(STORED_ONLY.filter((value) => text.includes(value))).toEqual([]);
    expect(screen.queryAllByText(/Host app callback/).length).toBeGreaterThan(0);

    // The console behind the same flag carries neither the Privy DID nor the Signer address.
    const logged = consoleText();
    expect(logged).toContain("[fluent widget] setSession");
    expect(logged).toContain(SMART_ACCOUNT);
    expect(logged).not.toContain(PRIVY_USER);
    expect(logged.toLowerCase()).not.toContain(SIGNER.toLowerCase());
  }, 30_000);
});

describe("criterion 2.2: the widget object", () => {
  it("carries no permission-session members, on any render", async () => {
    renderWidget();
    await signedInSession();

    expect(typeof widgetObject().createBatchOp).toBe("function");
    expect(typeof widgetObject().signMessage).toBe("function");
    expect(host.widgets.length).toBeGreaterThan(0);
    for (const widget of host.widgets) {
      expect(widget).not.toHaveProperty("createPermissionSession");
      expect(widget).not.toHaveProperty("policies");
    }
  }, 30_000);
});

const CALLS = [{ to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const, data: "0x" as const }];

describe("criterion 2.17: Quick sign on, through the widget", () => {
  it("reports Silent mode, and signs a message with no Review, through the Signer", async () => {
    renderWidget();
    await signedInSession();

    expect(widgetObject().signingMode).toBe("silent");
    await expect(widgetObject().signMessage({ message: "hello" })).resolves.toBe(
      PROVIDER_SIGNATURE,
    );
    expect(boundary.providerRequests).toContain("personal_sign");
    expect(boundary.promptSignatures).toBe(0);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  }, 30_000);

  it("sends a batch operation silently, with no Review", async () => {
    renderWidget();
    await signedInSession();
    await waitFor(() => expect(widgetObject().signingMode).toBe("silent"));

    await widgetObject().createBatchOp({ calls: CALLS }).execute();
    expect(methodsAt("bundler")).toContain("eth_sendUserOperation");
    expect(boundary.providerRequests).toContain("personal_sign");
    expect(boundary.promptSignatures).toBe(0);
    expect(document.querySelector('[aria-label="Confirm Fluent transaction"]')).toBeNull();
  }, 30_000);
});

describe("criterion 2.17: Quick sign off, through the widget", () => {
  it("reports Prompt mode, and signs a message only after the Review, through Privy", async () => {
    boundary.quickSign = false;
    renderWidget();
    await signedInSession();
    await waitFor(() => expect(widgetObject().signingMode).toBe("prompt"));

    const signature = widgetObject().signMessage({ message: "hello" });
    const review = await waitFor(() =>
      screen.getByRole("dialog", { name: "Confirm Fluent signature" }),
    );
    expect(boundary.promptSignatures).toBe(0);

    fireEvent.click(within(review).getByRole("button", { name: /Confirm and sign/ }));
    await expect(signature).resolves.toBe(PROMPT_SIGNATURE);
    expect(boundary.promptSignatures).toBe(1);
    expect(boundary.providerRequests).not.toContain("personal_sign");
  }, 30_000);

  it("shows the Review before a batch operation is sent", async () => {
    boundary.quickSign = false;
    renderWidget();
    await signedInSession();
    await waitFor(() => expect(widgetObject().signingMode).toBe("prompt"));

    void widgetObject().createBatchOp({ calls: CALLS }).execute().catch(() => undefined);
    await waitFor(() =>
      expect(document.querySelector('[aria-label="Confirm Fluent transaction"]')).not.toBeNull(),
    );
    expect(methodsAt("bundler")).not.toContain("eth_sendUserOperation");
    expect(boundary.promptSignatures).toBe(0);
  }, 30_000);
});
