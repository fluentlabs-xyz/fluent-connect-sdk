import type { FluentTokenDefinition, StorageLike } from "@fluent.xyz/connect-sdk";
import { describe, expect, it, vi } from "vitest";

import { FluentAuthError } from "./authToken";
import {
  createFluentSettingsClient,
  FluentSettingsError,
  type FluentSettingsClient,
  type FluentUserSettings,
} from "./settingsClient";
import {
  FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY,
  FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY,
} from "./storageKeys";
import {
  applyUserSettings,
  createUserSettingsController,
  isSettingsSubjectReady,
  resolveGasTokenSymbol,
  resolveSettingsIdentities,
  resolveSettingsSubject,
  settingsAudienceKey,
  settlingHoldsSubject,
  type UserSettingsHandlers,
  type UserSettingsTarget,
} from "./userSettings";
import { deriveWidgetAccount } from "../widget/hooks/useWidgetAccount";

const ADDRESS = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const TOKEN: FluentTokenDefinition = {
  chainId: 20994,
  address: ADDRESS,
  symbol: "SOME",
  name: "Some Token",
  decimals: 6,
};

const DEFAULTS: FluentUserSettings = { quickSign: true, gasTokenSymbol: null, tokens: [] };
/** What the widget preferred before anyone signed in, as the hook passes it. */
const WIDGET_DEFAULTS = { quickSign: true, gasTokenSymbol: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function fakeClient(overrides?: Partial<FluentSettingsClient>): FluentSettingsClient {
  return {
    read: vi.fn(async () => DEFAULTS),
    patch: vi.fn(async (patch) => ({ ...DEFAULTS, ...patch })),
    putToken: vi.fn(async () => {}),
    deleteToken: vi.fn(async () => {}),
    ...overrides,
  } as FluentSettingsClient;
}

function spyHandlers() {
  const applied: Array<{ quickSign: boolean; gasTokenSymbol: string | null }> = [];
  const preferenceErrors: Array<string | null> = [];
  const tokenErrors: Array<string | null> = [];
  const handlers: UserSettingsHandlers = {
    apply: (settings) => applied.push(settings),
    onPreferenceError: (message) => preferenceErrors.push(message),
    onTokenError: (message) => tokenErrors.push(message),
    onChange: () => {},
  };
  return { handlers, applied, preferenceErrors, tokenErrors };
}

/** One App at one service, as the hook's `settingsAudienceKey` spells it. */
const AUDIENCE = settingsAudienceKey({ publicApiUrl: "https://api", appId: "app_1" });

function target(overrides?: Partial<UserSettingsTarget>): UserSettingsTarget {
  return {
    subject: `${AUDIENCE}|privy:did:privy:abc`,
    audience: AUDIENCE,
    client: fakeClient(),
    ready: true,
    inputsKey: "1:1:0",
    ...overrides,
  };
}

/** One microtask turn is enough: every fake here resolves immediately. */
const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("resolveSettingsSubject", () => {
  it("gives a hosted Fluent ID no subject", () => {
    expect(
      resolveSettingsSubject({
        authMode: "hosted",
        accountType: "smart",
        privyUserId: "did:privy:abc",
      }),
    ).toBeNull();
  });

  it("names a direct-mode Fluent ID by its Privy user", () => {
    expect(
      resolveSettingsSubject({
        authMode: "direct",
        accountType: "smart",
        privyUserId: "did:privy:abc",
      }),
    ).toBe("privy:did:privy:abc");
  });

  it("names an external wallet by its lowercased address, in either mode", () => {
    for (const authMode of ["direct", "hosted"] as const) {
      expect(
        resolveSettingsSubject({ authMode, accountType: "eoa", walletAddress: ADDRESS }),
      ).toBe(`wallet:${ADDRESS.toLowerCase()}`);
    }
  });

  it("gives the not-connected state no subject", () => {
    expect(resolveSettingsSubject({ authMode: "direct", accountType: undefined })).toBeNull();
    expect(resolveSettingsSubject({ authMode: "direct", accountType: "smart" })).toBeNull();
    expect(resolveSettingsSubject({ authMode: "direct", accountType: "eoa" })).toBeNull();
  });
});

describe("resolveSettingsIdentities", () => {
  it("names a direct-mode person from Privy alone, with no smart account yet", () => {
    expect(
      resolveSettingsIdentities({ authMode: "direct", privyUserId: "did:privy:abc" }),
    ).toEqual(["privy:did:privy:abc"]);
  });

  it("names an external wallet by its lowercased address, in either mode", () => {
    for (const authMode of ["direct", "hosted"] as const) {
      expect(resolveSettingsIdentities({ authMode, walletAddress: ADDRESS })).toEqual([
        `wallet:${ADDRESS.toLowerCase()}`,
      ]);
    }
  });

  it("offers both subjects a direct-mode person could resolve to", () => {
    expect(
      resolveSettingsIdentities({
        authMode: "direct",
        privyUserId: "did:privy:abc",
        walletAddress: ADDRESS,
      }),
    ).toEqual(["privy:did:privy:abc", `wallet:${ADDRESS.toLowerCase()}`]);
  });

  it("names nobody from a hosted Privy user or from nothing at all", () => {
    expect(resolveSettingsIdentities({ authMode: "hosted", privyUserId: "did:privy:abc" })).toEqual(
      [],
    );
    expect(resolveSettingsIdentities({ authMode: "direct" })).toEqual([]);
  });
});

describe("settlingHoldsSubject", () => {
  const held = "privy:did:privy:abc";
  const current = { subject: held, audience: AUDIENCE };
  const OTHER_AUDIENCE = settingsAudienceKey({ publicApiUrl: "https://api", appId: "app_2" });

  it("holds while the rebuild has named nobody yet", () => {
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, audience: AUDIENCE },
        current,
      }),
    ).toBe(true);
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, knownSubjects: [], audience: AUDIENCE },
        current,
      }),
    ).toBe(true);
  });

  it("holds when the name that arrives is the one already held", () => {
    expect(
      settlingHoldsSubject({
        next: {
          subject: null,
          settling: true,
          knownSubjects: [held, "wallet:0xabc"],
          audience: AUDIENCE,
        },
        current,
      }),
    ).toBe(true);
  });

  it("lets go the moment somebody else is named", () => {
    expect(
      settlingHoldsSubject({
        next: {
          subject: null,
          settling: true,
          knownSubjects: ["privy:did:privy:xyz"],
          audience: AUDIENCE,
        },
        current,
      }),
    ).toBe(false);
  });

  it("lets go when the App or the service changes, named or not", () => {
    // The rehydration grace is the one moment the identity list says nothing;
    // the audience is what still does.
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, knownSubjects: [], audience: OTHER_AUDIENCE },
        current,
      }),
    ).toBe(false);
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, audience: OTHER_AUDIENCE },
        current,
      }),
    ).toBe(false);
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, knownSubjects: [held], audience: OTHER_AUDIENCE },
        current,
      }),
    ).toBe(false);
  });

  it("has nothing to hold without a settling rebuild, a subject or a person", () => {
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: false, audience: AUDIENCE },
        current,
      }),
    ).toBe(false);
    expect(
      settlingHoldsSubject({
        next: { subject: held, settling: true, audience: AUDIENCE },
        current,
      }),
    ).toBe(false);
    expect(
      settlingHoldsSubject({
        next: { subject: null, settling: true, audience: AUDIENCE },
        current: { subject: null, audience: AUDIENCE },
      }),
    ).toBe(false);
  });
});

describe("isSettingsSubjectReady", () => {
  it("waits for the identity token of a direct-mode Fluent ID", () => {
    expect(isSettingsSubjectReady({ accountType: "smart", identityToken: null })).toBe(false);
    expect(isSettingsSubjectReady({ accountType: "smart", identityToken: "id.token" })).toBe(true);
  });

  it("waits for both the address and the signer of an external wallet", () => {
    expect(
      isSettingsSubjectReady({ accountType: "eoa", walletAddress: ADDRESS, hasWalletClient: false }),
    ).toBe(false);
    expect(isSettingsSubjectReady({ accountType: "eoa", hasWalletClient: true })).toBe(false);
    expect(
      isSettingsSubjectReady({ accountType: "eoa", walletAddress: ADDRESS, hasWalletClient: true }),
    ).toBe(true);
  });
});

describe("resolveGasTokenSymbol", () => {
  const available = ["BLEND", "ETH", "USDnr"];

  it("falls back to the widget's default when nothing is stored", () => {
    expect(resolveGasTokenSymbol({ stored: null, available, fallback: "BLEND" })).toBe("BLEND");
  });

  it("keeps a symbol the network can charge gas to, in the set's own spelling", () => {
    expect(resolveGasTokenSymbol({ stored: "usdnr", available, fallback: "BLEND" })).toBe("USDnr");
  });

  it("ignores a symbol outside this network's gas tokens", () => {
    expect(resolveGasTokenSymbol({ stored: "SOME", available, fallback: "BLEND" })).toBe("BLEND");
  });
});

describe("applyUserSettings", () => {
  const available = ["BLEND", "ETH", "USDnr"];

  it("touches the Quick sign commit and the gas setter, and nothing else", () => {
    const read: string[] = [];
    const source = {
      settings: { quickSign: false, gasTokenSymbol: "USDnr" },
      available,
      fallback: "BLEND",
      commitQuickSign: () => {},
      setGasTokenSymbol: () => {},
    };
    // A Proxy records every member the apply path so much as reads, so a future
    // `setSession(...)` or storage write here would show up as an extra name.
    const probe = new Proxy(source, {
      get(objective, property: string) {
        read.push(property);
        return Reflect.get(objective, property) as unknown;
      },
    });

    applyUserSettings(probe as unknown as Parameters<typeof applyUserSettings>[0]);

    const invoked = read.filter(
      (name) => typeof (source as Record<string, unknown>)[name] === "function",
    );
    expect([...new Set(invoked)]).toEqual(["commitQuickSign", "setGasTokenSymbol"]);
  });

  it("hands the gas setter the default for a symbol this network cannot charge", () => {
    const gas: string[] = [];
    const quick: boolean[] = [];
    applyUserSettings({
      settings: { quickSign: true, gasTokenSymbol: "SOME" },
      available,
      fallback: "BLEND",
      commitQuickSign: (enabled) => quick.push(enabled),
      setGasTokenSymbol: (symbol) => gas.push(symbol),
    });

    expect(quick).toEqual([true]);
    expect(gas).toEqual(["BLEND"]);
  });
});

describe("createUserSettingsController: no subject", () => {
  it("makes no request at all for a hosted Fluent ID or the not-connected state", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createFluentSettingsClient({
      publicApiUrl: "https://api.example/api/v1",
      getAuthToken: async () => "token",
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });
    const controller = createUserSettingsController({ storage: null });

    controller.setTarget({ subject: null, audience: AUDIENCE, client, ready: false, inputsKey: "0:0:0" });
    await settle();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe("unavailable");
  });

  it("serves the localStorage store while no subject exists", async () => {
    const storage = memoryStorage();
    const controller = createUserSettingsController({ storage });

    controller.setTarget({ subject: null, audience: AUDIENCE, client: null, ready: false, inputsKey: "0:0:0" });
    await controller.getStore().add(TOKEN);

    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("SOME");
  });
});

describe("createUserSettingsController: the read", () => {
  it("reads once per subject and applies the three values", async () => {
    const { handlers, applied } = spyHandlers();
    const client = fakeClient({
      read: vi.fn(async () => ({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [TOKEN] })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();

    expect(controller.getPhase()).toBe("ready");
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([WIDGET_DEFAULTS, { quickSign: false, gasTokenSymbol: "USDnr" }]);
    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);
  });

  it("does not read again for the same subject, as after a Privy remount", async () => {
    const { handlers } = spyHandlers();
    const client = fakeClient({ read: vi.fn(async () => ({ ...DEFAULTS, tokens: [TOKEN] })) });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    const storeBefore = controller.getStore();

    // What the remounted subtree's effect does on its first render.
    controller.setTarget(target({ client, inputsKey: "1:1:0" }));
    await settle();

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe("ready");
    expect(controller.getStore()).toBe(storeBefore);
    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);
  });

  it("reads again when the subject changes", async () => {
    const { handlers } = spyHandlers();
    const client = fakeClient();
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    controller.setTarget(target({ client, subject: "https://api|app_1|wallet:0xabc" }));
    await settle();

    expect(client.read).toHaveBeenCalledTimes(2);
  });
});

describe("createUserSettingsController: readiness", () => {
  it.each([
    ["a direct-mode Fluent ID", "1:0:0", "1:1:0"],
    ["an external wallet", "0:0:0", "1:0:1"],
  ])("makes no call for %s before its inputs arrive, then reads", async (_l, before, after) => {
    const { handlers } = spyHandlers();
    const client = fakeClient();
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client, ready: false, inputsKey: before }));
    await settle();
    expect(client.read).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe("idle");

    controller.setTarget(target({ client, ready: true, inputsKey: after }));
    await settle();
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe("ready");
  });

  it("retries a not_connected failure for the same subject when the inputs change", async () => {
    const { handlers } = spyHandlers();
    const read = vi
      .fn<() => Promise<FluentUserSettings>>()
      .mockRejectedValueOnce(new FluentAuthError("not_connected", "no signer"))
      .mockResolvedValueOnce(DEFAULTS);
    const client = fakeClient({ read });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client, inputsKey: "1:0:1" }));
    await settle();
    expect(controller.getPhase()).toBe("idle");

    controller.setTarget(target({ client, inputsKey: "1:1:1" }));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getPhase()).toBe("ready");
  });

  it("leaves the widget on localStorage after a failure waiting cannot fix", async () => {
    const { handlers, applied, preferenceErrors } = spyHandlers();
    const storage = memoryStorage();
    const client = fakeClient({
      read: vi.fn(async () => {
        throw new FluentSettingsError("internal", "boom", 500);
      }),
    });
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client }));
    await settle();

    expect(controller.getPhase()).toBe("unavailable");
    // The defaults, and nothing shown: the widget is as it was before this Issue.
    expect(applied).toEqual([WIDGET_DEFAULTS, WIDGET_DEFAULTS]);
    expect(preferenceErrors.filter(Boolean)).toEqual([]);
    await controller.getStore().add(TOKEN);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("SOME");

    // And it retries on the next subject.
    controller.setTarget(target({ client, subject: "https://api|app_1|wallet:0xabc" }));
    await settle();
    expect(client.read).toHaveBeenCalledTimes(2);
  });
});

describe("createUserSettingsController: generations", () => {
  it("applies nothing from a read that belongs to the subject before last", async () => {
    const { handlers, applied } = spyHandlers();
    const slow = deferred<FluentUserSettings>();
    const clientA = fakeClient({ read: vi.fn(() => slow.promise) });
    const clientB = fakeClient({
      read: vi.fn(async () => ({ quickSign: true, gasTokenSymbol: "ETH", tokens: [] })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client: clientA, subject: "api|app|A" }));
    controller.setTarget(target({ client: clientB, subject: "api|app|B" }));
    await settle();

    slow.resolve({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [TOKEN] });
    await settle();

    expect(applied).toEqual([WIDGET_DEFAULTS, WIDGET_DEFAULTS, { quickSign: true, gasTokenSymbol: "ETH" }]);
    expect(controller.getSubject()).toBe("api|app|B");
    await expect(controller.getStore().list(20994)).resolves.toEqual([]);
  });

  it("imports nothing and removes no local key for an abandoned subject", async () => {
    const { handlers } = spyHandlers();
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens: [TOKEN] }),
    });
    const slow = deferred<FluentUserSettings>();
    const clientA = fakeClient({ read: vi.fn(() => slow.promise) });
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client: clientA, subject: "api|app|A" }));
    controller.setTarget({ subject: null, audience: AUDIENCE, client: null, ready: false, inputsKey: "0:0:0" });
    slow.resolve(DEFAULTS);
    await settle();

    expect(clientA.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("SOME");
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
    expect(controller.getPhase()).toBe("unavailable");
  });

  it("reports no error into the current UI from an older generation's write", async () => {
    const { handlers, preferenceErrors } = spyHandlers();
    const failing = deferred<FluentUserSettings>();
    const client = fakeClient({ patch: vi.fn(() => failing.promise) });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    void controller.setQuickSign(false);
    controller.setTarget(target({ client, subject: "api|app|other" }));
    failing.reject(new FluentSettingsError("internal", "boom", 500));
    await settle();

    expect(preferenceErrors.filter(Boolean)).toEqual([]);
  });
  it("keeps the new subject's write serialization when an older write lands", async () => {
    const { handlers } = spyHandlers();
    const oldPatch = deferred<FluentUserSettings>();
    const newPatch = deferred<FluentUserSettings>();
    const clientA = fakeClient({ patch: vi.fn(() => oldPatch.promise) });
    const clientB = fakeClient({
      patch: vi
        .fn()
        .mockImplementationOnce(() => newPatch.promise)
        .mockImplementation(async (patch: Record<string, unknown>) => ({ ...DEFAULTS, ...patch })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client: clientA, subject: "api|app|A" }));
    await settle();
    void controller.setQuickSign(false);

    controller.setTarget(target({ client: clientB, subject: "api|app|B" }));
    await settle();
    void controller.setQuickSign(false);

    // A's answer arrives after B took over. It publishes nothing...
    oldPatch.resolve({ ...DEFAULTS, gasTokenSymbol: "OLD" });
    await settle();
    expect(controller.getSettings()?.gasTokenSymbol).toBeNull();

    // ...and it does not free B's guard: B's second choice waits its turn
    // rather than racing the request already in flight.
    void controller.setQuickSign(true);
    await settle();
    expect(clientB.patch).toHaveBeenCalledTimes(1);

    newPatch.resolve({ ...DEFAULTS, quickSign: false });
    await settle();

    expect(clientB.patch).toHaveBeenCalledTimes(2);
    expect(clientB.patch).toHaveBeenNthCalledWith(2, { quickSign: true });
    // The value that lands is the one the user picked last.
    expect(controller.getSettings()?.quickSign).toBe(true);
  });

  it("does not resume one person's import into another person's list", async () => {
    const { handlers } = spyHandlers();
    const other = { ...TOKEN, address: "0x000000000000000000000000000000000000dEaD" as const };
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        tokens: [TOKEN, other],
      }),
    });
    let puts = 0;
    const clientA = fakeClient({
      putToken: vi.fn(async () => {
        puts += 1;
        if (puts > 1) throw new FluentSettingsError("internal", "boom", 500);
      }),
    });
    const clientB = fakeClient({
      read: vi.fn(async () => ({ ...DEFAULTS, tokens: [other] })),
    });
    const controller = createUserSettingsController({ storage, handlers });

    // A's import stops halfway and leaves the remainder, and its marker, behind.
    controller.setTarget(target({ client: clientA, subject: "api|app|A" }));
    await settle();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("dEaD");
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBe("api|app|A");

    // B signs in on the same browser, with a list of their own already there.
    controller.setTarget(target({ client: clientB, subject: "api|app|B" }));
    await settle();

    expect(clientB.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("dEaD");
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBe("api|app|A");
  });

});

/**
 * The three states a direct-mode Fluent ID passes through when applying Quick
 * sign remounts the `PrivyProvider`, as `useFluentZeroDevAccount` reports them:
 * ready, then the rebuilt subtree's empty kernels, then ready again.
 */
const SMART_READY = {
  smartAccountReady: true,
  smartAccountAddress: ADDRESS,
  privyReady: true,
  privyAuthenticated: true,
  embeddedWalletCount: 1,
};
const SMART_REBUILDING = { ...SMART_READY, smartAccountReady: false, smartAccountAddress: undefined };
const SMART_SIGNED_OUT = {
  smartAccountReady: false,
  privyReady: true,
  privyAuthenticated: false,
  embeddedWalletCount: 0,
};

/** The target the hook builds from one account snapshot, derivation included. */
function targetFromAccount(
  smartAccount: Parameters<typeof deriveWidgetAccount>[0]["smartAccount"],
  client: FluentSettingsClient | null,
  /** Who Privy names on this render — not who the smart account is ready for. */
  privyUserId = "did:privy:abc",
  /** The App and the service the host configured this render with. */
  audience = AUDIENCE,
) {
  const derived = deriveWidgetAccount({
    smartAccount,
    wallet: null,
    sessionUserId: privyUserId,
    directAuth: true,
  });
  const subject = resolveSettingsSubject({
    authMode: "direct",
    accountType: derived.widgetAccount.type,
    privyUserId,
  });
  const ready = isSettingsSubjectReady({
    accountType: derived.widgetAccount.type,
    identityToken: "id.token",
  });
  return {
    status: derived.status,
    target: {
      subject,
      audience,
      client: subject ? client : null,
      ready,
      settling: derived.status === "connecting" || derived.status === "restoring",
      knownSubjects: resolveSettingsIdentities({ authMode: "direct", privyUserId }),
      inputsKey: `${ready ? "1" : "0"}:1:0`,
    } satisfies UserSettingsTarget,
  };
}

describe("createUserSettingsController: the Privy remount", () => {
  it("holds the person's settings through the rebuild a Quick sign apply causes", async () => {
    const { handlers, applied } = spyHandlers();
    const client = fakeClient({
      read: vi.fn(async () => ({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [TOKEN] })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    const signedIn = targetFromAccount(SMART_READY, client);
    expect(signedIn.status).toBe("connected");
    controller.setTarget(signedIn.target);
    await settle();
    const storeBefore = controller.getStore();
    expect(controller.getPhase()).toBe("ready");

    // The apply changed the provider key. The rebuilt subtree has no ready
    // smart account, so the derivation reports `connecting` and no subject at
    // all — which is "not yet", not "signed out".
    const rebuilding = targetFromAccount(SMART_REBUILDING, null);
    expect(rebuilding.status).toBe("connecting");
    expect(rebuilding.target.subject).toBeNull();
    controller.setTarget(rebuilding.target);
    await settle();

    expect(controller.getPhase()).toBe("ready");
    expect(controller.getSubject()).toBe(signedIn.target.subject);
    expect(controller.getStore()).toBe(storeBefore);
    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);

    // And when the smart account is ready again, there is nothing left to read.
    controller.setTarget(targetFromAccount(SMART_READY, client).target);
    await settle();

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe("ready");
    expect(controller.getStore()).toBe(storeBefore);
    expect(applied).toEqual([WIDGET_DEFAULTS, { quickSign: false, gasTokenSymbol: "USDnr" }]);
  });

  it("still lets go when the person actually signs out", async () => {
    const { handlers, applied } = spyHandlers();
    const client = fakeClient({
      read: vi.fn(async () => ({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [TOKEN] })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(targetFromAccount(SMART_READY, client).target);
    await settle();

    const out = targetFromAccount(SMART_SIGNED_OUT, null);
    expect(out.status).toBe("disconnected");
    expect(out.target.settling).toBe(false);
    controller.setTarget(out.target);
    await settle();

    expect(controller.getPhase()).toBe("unavailable");
    expect(controller.getSubject()).toBeNull();
    expect(controller.getStore()).toBe(controller.getLocalStore());
    // And the next person does not inherit this one's preferences.
    expect(applied.at(-1)).toEqual(WIDGET_DEFAULTS);
  });

  it("lets go of one person's pending read as soon as another is named", async () => {
    // B is signed in and their smart account is still being built. The
    // derivation cannot name an account type yet, so the target looks exactly
    // like A's own rebuild — except that Privy already says B.
    const { handlers, applied } = spyHandlers();
    const pending = deferred<FluentUserSettings>();
    const clientA = fakeClient({ read: vi.fn(() => pending.promise) });
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens: [TOKEN] }),
    });
    const controller = createUserSettingsController({ storage, handlers });

    const signedIn = targetFromAccount(SMART_READY, clientA);
    controller.setTarget(signedIn.target);
    await settle();
    expect(clientA.read).toHaveBeenCalledTimes(1);

    const other = targetFromAccount(SMART_REBUILDING, null, "did:privy:xyz");
    expect(other.status).toBe("connecting");
    expect(other.target.subject).toBeNull();
    expect(other.target.settling).toBe(true);
    expect(other.target.knownSubjects).toEqual(["privy:did:privy:xyz"]);
    controller.setTarget(other.target);
    applied.length = 0;

    pending.resolve({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [] });
    await settle();

    // A's answer belongs to nobody: not one of B's preferences, not B's list,
    // and not this browser's local key, which A's import would have emptied
    // into A's account.
    expect(applied).toEqual([]);
    expect(clientA.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, tokens: [TOKEN] }),
    );
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
    expect(controller.getSubject()).toBeNull();
    expect(controller.getPhase()).toBe("unavailable");
    expect(controller.getStore()).toBe(controller.getLocalStore());
  });

  it("holds on while nobody is named yet, as Privy rehydrates under the rebuild", async () => {
    const { handlers } = spyHandlers();
    const client = fakeClient({
      read: vi.fn(async () => ({ quickSign: false, gasTokenSymbol: null, tokens: [TOKEN] })),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    const signedIn = targetFromAccount(SMART_READY, client);
    controller.setTarget(signedIn.target);
    await settle();
    const storeBefore = controller.getStore();

    // The rebuilt provider has not restored its user yet: no subject, and no
    // name either. That is "not yet", not "somebody else".
    controller.setTarget({
      subject: null,
      audience: AUDIENCE,
      client: null,
      ready: false,
      settling: true,
      knownSubjects: [],
      inputsKey: "0:1:0",
    });
    await settle();

    expect(controller.getSubject()).toBe(signedIn.target.subject);
    expect(controller.getPhase()).toBe("ready");
    expect(controller.getStore()).toBe(storeBefore);
    expect(client.read).toHaveBeenCalledTimes(1);
  });
});

describe("createUserSettingsController: the audience", () => {
  const A = { publicApiUrl: "https://service-a/api/v1", appId: "app-a" };
  const AUDIENCE_A = settingsAudienceKey(A);
  const LOCAL_LIST = JSON.stringify({ version: 1, tokens: [TOKEN] });

  /** A signed in, their settings read still in flight, one token stored locally. */
  function pendingRead() {
    const { handlers, applied } = spyHandlers();
    const pending = deferred<FluentUserSettings>();
    const clientA = fakeClient({ read: vi.fn(() => pending.promise) });
    const storage = memoryStorage({ [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: LOCAL_LIST });
    const controller = createUserSettingsController({ storage, handlers });

    const signedIn = targetFromAccount(SMART_READY, clientA, "did:privy:abc", AUDIENCE_A);
    controller.setTarget(signedIn.target);
    return { applied, clientA, controller, pending, signedIn, storage };
  }

  /**
   * The render a host produces by re-rendering the widget for another App, or
   * against another service, while Privy is rehydrating: no subject, nobody
   * named, `settling` — the same shape as the person's own rebuild.
   */
  function rehydrating(audience: string): UserSettingsTarget {
    return {
      subject: null,
      audience,
      client: null,
      ready: false,
      settling: true,
      knownSubjects: [],
      inputsKey: "0:1:0",
    };
  }

  it.each([
    ["the App changes", settingsAudienceKey({ ...A, appId: "app-b" })],
    ["the service changes", settingsAudienceKey({ ...A, publicApiUrl: "https://service-b/api/v1" })],
  ])("lets go of a pending read when %s under a rehydrating Privy", async (_label, audienceB) => {
    const { applied, clientA, controller, pending, storage } = pendingRead();
    await settle();
    expect(clientA.read).toHaveBeenCalledTimes(1);
    applied.length = 0;

    controller.setTarget(rehydrating(audienceB));
    pending.resolve({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [] });
    await settle();

    // A's token was minted for A's App at A's service: its answer belongs to
    // nobody here. Nothing of A's is applied, nothing is pushed to A's account,
    // and this browser's local list is still waiting for whoever signs in next.
    expect(applied).toEqual([WIDGET_DEFAULTS]);
    expect(clientA.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBe(LOCAL_LIST);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
    expect(controller.getSubject()).toBeNull();
    expect(controller.getAudience()).toBe(audienceB);
    expect(controller.getPhase()).toBe("unavailable");
  });

  it("holds the same pending read when the audience does not change", async () => {
    const { applied, clientA, controller, pending, signedIn, storage } = pendingRead();
    await settle();
    applied.length = 0;

    controller.setTarget(rehydrating(AUDIENCE_A));
    pending.resolve({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [] });
    await settle();

    expect(applied).toEqual([{ quickSign: false, gasTokenSymbol: "USDnr" }]);
    expect(controller.getSubject()).toBe(signedIn.target.subject);
    expect(controller.getAudience()).toBe(AUDIENCE_A);
    expect(controller.getPhase()).toBe("ready");
    expect(clientA.read).toHaveBeenCalledTimes(1);
    // The hold is what carries this browser's list into the account it was
    // read for, once and for that person only.
    expect(clientA.putToken).toHaveBeenCalledWith(TOKEN);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
  });
});

describe("createUserSettingsController: the defaults between subjects", () => {
  it("returns to the widget's defaults when a new subject's read fails", async () => {
    const { handlers, applied } = spyHandlers();
    const clientA = fakeClient({
      read: vi.fn(async () => ({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [] })),
    });
    const clientB = fakeClient({
      read: vi.fn(async () => {
        throw new FluentSettingsError("internal", "boom", 500);
      }),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client: clientA, subject: "api|app|A" }));
    await settle();
    expect(applied.at(-1)).toEqual({ quickSign: false, gasTokenSymbol: "USDnr" });

    controller.setTarget(target({ client: clientB, subject: "api|app|B" }));
    await settle();

    // Not A's `false` and not A's `USDnr`: B gets the widget as it was before
    // this Issue, both while the read is in flight and after it failed.
    expect(controller.getPhase()).toBe("unavailable");
    // The defaults twice: once when the subject changed, once when B's read
    // failed for a reason waiting cannot fix.
    expect(applied.slice(2)).toEqual([WIDGET_DEFAULTS, WIDGET_DEFAULTS]);
    expect(controller.getStore()).toBe(controller.getLocalStore());
  });

  it("applies whatever defaults it was given", async () => {
    const { handlers, applied } = spyHandlers();
    const controller = createUserSettingsController({
      storage: null,
      handlers,
      defaults: { quickSign: false, gasTokenSymbol: "ETH" },
    });

    controller.setTarget(target({ client: fakeClient() }));
    await settle();

    expect(applied[0]).toEqual({ quickSign: false, gasTokenSymbol: "ETH" });
  });
});

describe("createUserSettingsController: teardown", () => {
  it("applies, imports and clears nothing once the widget itself is gone", async () => {
    const { handlers, applied } = spyHandlers();
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens: [TOKEN] }),
    });
    const slow = deferred<FluentUserSettings>();
    const client = fakeClient({ read: vi.fn(() => slow.promise) });
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client }));
    await settle();
    const appliedBefore = applied.length;

    // What `FluentWidget`'s unmount cleanup does.
    controller.reset();
    slow.resolve({ quickSign: false, gasTokenSymbol: "USDnr", tokens: [] });
    await settle();

    expect(applied).toHaveLength(appliedBefore);
    expect(client.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("SOME");
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
    expect(controller.getPhase()).toBe("unavailable");
  });
});

describe("createUserSettingsController: writes", () => {
  it("writes each preference back on its own", async () => {
    const { handlers } = spyHandlers();
    const client = fakeClient();
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    await controller.setQuickSign(false);
    await controller.setGasTokenSymbol("USDnr");

    expect(client.patch).toHaveBeenNthCalledWith(1, { quickSign: false });
    expect(client.patch).toHaveBeenNthCalledWith(2, { gasTokenSymbol: "USDnr" });
  });

  it("writes nothing before the read has landed", async () => {
    const { handlers } = spyHandlers();
    const pending = deferred<FluentUserSettings>();
    const client = fakeClient({ read: vi.fn(() => pending.promise) });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await controller.setQuickSign(false);

    expect(client.patch).not.toHaveBeenCalled();
    pending.resolve(DEFAULTS);
    await settle();
  });

  it("serializes two quick choices so the last one is the value that lands", async () => {
    const { handlers } = spyHandlers();
    const first = deferred<FluentUserSettings>();
    const patch = vi
      .fn<(body: { quickSign?: boolean }) => Promise<FluentUserSettings>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (body) => ({ ...DEFAULTS, ...body }));
    const client = fakeClient({ patch: patch as unknown as FluentSettingsClient["patch"] });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();

    const flush = controller.setQuickSign(false);
    void controller.setQuickSign(true);
    void controller.setQuickSign(false);
    // Only the first request is out; the rest coalesce into one more.
    expect(patch).toHaveBeenCalledTimes(1);
    first.resolve({ ...DEFAULTS, quickSign: false });
    await flush;

    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(1, { quickSign: false });
    expect(patch).toHaveBeenNthCalledWith(2, { quickSign: false });
  });

  it("keeps the user's choice and reports the message when the write fails", async () => {
    const { handlers, preferenceErrors, applied } = spyHandlers();
    const client = fakeClient({
      patch: vi.fn(async () => {
        throw new FluentSettingsError("internal", "Storage is unavailable", 500);
      }),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    await controller.setQuickSign(false);

    expect(preferenceErrors.at(-1)).toBe("Storage is unavailable");
    // Nothing re-applied: the local value the user chose stands.
    expect(applied).toEqual([WIDGET_DEFAULTS, WIDGET_DEFAULTS]);
  });

  it("clears a stale error when the next preference action begins", async () => {
    const { handlers, preferenceErrors } = spyHandlers();
    const patch = vi
      .fn<(body: unknown) => Promise<FluentUserSettings>>()
      .mockRejectedValueOnce(new FluentSettingsError("internal", "boom", 500))
      .mockResolvedValue(DEFAULTS);
    const client = fakeClient({ patch: patch as unknown as FluentSettingsClient["patch"] });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    await controller.setQuickSign(false);
    expect(preferenceErrors.at(-1)).toBe("boom");

    await controller.setGasTokenSymbol("ETH");
    expect(preferenceErrors.at(-1)).toBeNull();
  });
});

describe("createUserSettingsController: the one-time import", () => {
  it("carries the local list over on the first read and clears the key", async () => {
    const { handlers } = spyHandlers();
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens: [TOKEN] }),
    });
    const client = fakeClient();
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client }));
    await settle();

    expect(client.putToken).toHaveBeenCalledWith(TOKEN);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
    // The list the menu first shows already holds it: no second round trip.
    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  it("imports nothing when the service already holds a list", async () => {
    const { handlers } = spyHandlers();
    const storage = memoryStorage({
      [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens: [TOKEN] }),
    });
    const remote = { ...TOKEN, address: "0x000000000000000000000000000000000000dEaD" as const };
    const client = fakeClient({ read: vi.fn(async () => ({ ...DEFAULTS, tokens: [remote] })) });
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client }));
    await settle();

    expect(client.putToken).not.toHaveBeenCalled();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toContain("SOME");
  });
});

describe("createUserSettingsController: getLocalStore", () => {
  it("hands back the localStorage store even while a backend one is live", async () => {
    const { handlers } = spyHandlers();
    const storage = memoryStorage();
    const client = fakeClient({ read: vi.fn(async () => ({ ...DEFAULTS, tokens: [TOKEN] })) });
    const controller = createUserSettingsController({ storage, handlers });

    controller.setTarget(target({ client }));
    await settle();

    expect(controller.getPhase()).toBe("ready");
    await expect(controller.getStore().list(20994)).resolves.toEqual([TOKEN]);
    // What a render whose subject the controller has not been told about yet
    // must use, so the previous person's list is never on screen.
    await expect(controller.getLocalStore().list(20994)).resolves.toEqual([]);
  });
});

describe("createUserSettingsController: the token list's own error", () => {
  it("reports a failed removal through the token error handler", async () => {
    const { handlers, tokenErrors } = spyHandlers();
    const client = fakeClient({
      read: vi.fn(async () => ({ ...DEFAULTS, tokens: [TOKEN] })),
      deleteToken: vi.fn(async () => {
        throw new FluentSettingsError("internal", "Could not remove it", 500);
      }),
    });
    const controller = createUserSettingsController({ storage: null, handlers });

    controller.setTarget(target({ client }));
    await settle();
    await controller.getStore().remove({ chainId: 20994, address: ADDRESS });

    expect(tokenErrors.at(-1)).toBe("Could not remove it");
  });
});
