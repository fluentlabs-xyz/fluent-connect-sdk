import { describe, expect, it, vi } from "vitest";
import type { StorageLike } from "@fluent.xyz/connect-sdk";

import { FluentAuthError } from "./authToken";
import {
  FLUENT_LINK_X_MARKER_KEY,
  clearLinkXMarker,
  identityTokenHasLinkedX,
  isLinkXIntentDiscarded,
  linkXIntentDiscardedError,
  ownsLinkXMarker,
  privyUserHasLinkedX,
  readFluentProfile,
  readFluentXAccount,
  readLinkXMarker,
  requestLinkX,
  toLinkXPrivyError,
  writeLinkXMarker,
  type RequestLinkXParams,
} from "./linkX";

/**
 * `requestLinkX` and the pure parts around it: the identity-token probe, the wire readers, the
 * marker, and the error mapping. Nothing here mounts React or touches Privy — the whole point of
 * the core is that it can be driven by hand, and the hop is observed by the order its two
 * side effects happen in rather than by a navigation nobody can perform in a test.
 */

const PUBLIC_API_URL = "https://api.test.fluent.xyz/api/v1";
const SUBJECT = "did:privy:owner";

const X_ACCOUNT = {
  id: "1458",
  handle: "fluentxyz",
  avatarUrl: "https://pbs.twimg.com/profile_images/1458/avatar.jpg",
};

/** A profile body as the service answers it. */
function profileBody(x: unknown = X_ACCOUNT): Record<string, unknown> {
  return { subject: "fcid_owner", appId: "app_00000000000000000000000000000000", x };
}

/**
 * An identity token with the claims given. Unsigned and unverified, which is all the probe
 * reads: it base64url-decodes the payload and nothing else.
 */
function identityTokenWith(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.signature`;
}

/**
 * The claim as Privy really encodes it and the service really models it: a JSON **string**
 * holding the array, with the short keys a captured real token carries.
 */
function linkedAccountsClaim(accounts: ReadonlyArray<Record<string, unknown>>): string {
  return JSON.stringify(accounts);
}

const X_ENTRY = {
  type: "twitter_oauth",
  subject: "1458",
  username: "fluentxyz",
  pfp: "https://pbs.twimg.com/profile_images/1458/avatar.jpg",
  lv: 1_759_800_000,
};
const GOOGLE_ENTRY = { type: "google_oauth", subject: "google-1", email: "owner@example.com" };

const TOKEN_WITH_X = identityTokenWith({
  sub: SUBJECT,
  linked_accounts: linkedAccountsClaim([GOOGLE_ENTRY, X_ENTRY]),
});
const TOKEN_WITHOUT_X = identityTokenWith({
  sub: SUBJECT,
  linked_accounts: linkedAccountsClaim([GOOGLE_ENTRY]),
});

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The order the side effects happened in, which is what the hop path is held to. */
type Journal = string[];

function arrange(
  overrides: Partial<RequestLinkXParams> & { response?: Response } = {},
): { params: RequestLinkXParams; journal: Journal; fetchMock: ReturnType<typeof vi.fn>; storage: StorageLike } {
  const journal: Journal = [];
  const storage = memoryStorage();
  const fetchMock = vi.fn(async () => {
    journal.push("POST");
    return overrides.response ?? jsonResponse(profileBody());
  });
  const params: RequestLinkXParams = {
    authMode: "direct",
    accountKind: "smart",
    subject: SUBJECT,
    publicApiUrl: PUBLIC_API_URL,
    identityToken: TOKEN_WITH_X,
    getAuthToken: async () => "fluent-token",
    getAccessToken: async () => "privy-access-token",
    getIdentityToken: async () => {
      journal.push("refresh");
      return TOKEN_WITHOUT_X;
    },
    linkTwitter: () => {
      journal.push("linkTwitter");
    },
    storage: {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        journal.push(`write:${key}`);
        storage.setItem(key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    },
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...overrides,
  };
  return { params, journal, fetchMock, storage };
}

async function rejection(run: Promise<unknown>): Promise<FluentAuthError> {
  try {
    await run;
  } catch (err) {
    expect(err).toBeInstanceOf(FluentAuthError);
    return err as FluentAuthError;
  }
  throw new Error("expected the call to reject");
}

describe("identityTokenHasLinkedX", () => {
  it("reads a twitter_oauth entry out of the string-valued claim", () => {
    expect(identityTokenHasLinkedX(TOKEN_WITH_X)).toBe(true);
  });

  it("is not linked when the claim lists other providers only", () => {
    expect(identityTokenHasLinkedX(TOKEN_WITHOUT_X)).toBe(false);
  });

  it("is not linked when the claim is an array rather than a JSON string", () => {
    // The shape this SDK has never been handed. Read as "not linked" rather than guessed at:
    // the cost is one Privy round trip, and the alternative is a POST that cannot succeed.
    const token = identityTokenWith({ linked_accounts: [X_ENTRY] });
    expect(identityTokenHasLinkedX(token)).toBe(false);
  });

  it("is not linked when the claim string holds JSON that is not an array", () => {
    expect(identityTokenHasLinkedX(identityTokenWith({ linked_accounts: '{"type":"twitter_oauth"}' }))).toBe(
      false,
    );
  });

  it("is not linked when the claim string is not JSON at all", () => {
    expect(identityTokenHasLinkedX(identityTokenWith({ linked_accounts: "twitter_oauth" }))).toBe(
      false,
    );
  });

  it("is not linked when the claim is absent", () => {
    expect(identityTokenHasLinkedX(identityTokenWith({ sub: SUBJECT }))).toBe(false);
  });

  it("is not linked for a differently cased type", () => {
    const token = identityTokenWith({
      linked_accounts: linkedAccountsClaim([{ ...X_ENTRY, type: "Twitter_OAuth" }]),
    });
    expect(identityTokenHasLinkedX(token)).toBe(false);
  });

  it("never throws on a malformed JWT, an absent token or a non-object entry", () => {
    expect(identityTokenHasLinkedX("not-a-jwt")).toBe(false);
    expect(identityTokenHasLinkedX("")).toBe(false);
    expect(identityTokenHasLinkedX(null)).toBe(false);
    expect(identityTokenHasLinkedX(undefined)).toBe(false);
    expect(
      identityTokenHasLinkedX(identityTokenWith({ linked_accounts: linkedAccountsClaim([]) })),
    ).toBe(false);
    expect(identityTokenHasLinkedX(identityTokenWith({ linked_accounts: '["twitter_oauth"]' }))).toBe(
      false,
    );
  });
});

describe("privyUserHasLinkedX", () => {
  it("reads the completion signal off user.linkedAccounts", () => {
    expect(privyUserHasLinkedX([{ type: "google_oauth" }, { type: "twitter_oauth" }])).toBe(true);
    expect(privyUserHasLinkedX([{ type: "google_oauth" }])).toBe(false);
    expect(privyUserHasLinkedX([])).toBe(false);
    expect(privyUserHasLinkedX(undefined)).toBe(false);
  });
});

describe("readFluentXAccount and readFluentProfile", () => {
  it("reads a valid x", () => {
    expect(readFluentXAccount(X_ACCOUNT)).toEqual(X_ACCOUNT);
    expect(readFluentProfile(profileBody())).toEqual({
      subject: "fcid_owner",
      appId: "app_00000000000000000000000000000000",
      x: X_ACCOUNT,
    });
  });

  it("reads x: null as a profile with no X account", () => {
    expect(readFluentProfile(profileBody(null))?.x).toBeNull();
  });

  it("is no profile when x is missing or malformed", () => {
    const { subject, appId } = profileBody();
    expect(readFluentProfile({ subject, appId })).toBeNull();
    expect(readFluentProfile(profileBody({ id: "1458", handle: "fluentxyz" }))).toBeNull();
    expect(readFluentProfile(profileBody({ id: "1458", handle: "", avatarUrl: "a" }))).toBeNull();
    expect(readFluentProfile(profileBody("fluentxyz"))).toBeNull();
  });

  it("returns no account unless all three fields are non-empty strings", () => {
    expect(readFluentXAccount({ ...X_ACCOUNT, id: "" })).toBeNull();
    expect(readFluentXAccount({ ...X_ACCOUNT, handle: 7 })).toBeNull();
    expect(readFluentXAccount({ ...X_ACCOUNT, avatarUrl: null })).toBeNull();
    expect(readFluentXAccount(null)).toBeNull();
    expect(readFluentXAccount("fluentxyz")).toBeNull();
  });

  it("is no profile without the subject and App the route always sends", () => {
    expect(readFluentProfile({ appId: "app_1", x: null })).toBeNull();
    expect(readFluentProfile({ subject: "fcid_owner", x: null })).toBeNull();
    expect(readFluentProfile(null)).toBeNull();
  });
});

describe("the link-X marker", () => {
  it("round-trips a marker and clears it", () => {
    const storage = memoryStorage();
    writeLinkXMarker(storage, { started: 1_700_000_000_000, subject: SUBJECT });
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: 1_700_000_000_000, subject: SUBJECT },
    });
    clearLinkXMarker(storage);
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("tells an empty tab from one holding something that is not a marker", () => {
    // The caller has to know which: nothing stored is a fresh ask, a leftover is intent to drop
    // and do no work on.
    expect(readLinkXMarker(memoryStorage())).toEqual({ kind: "none" });
    expect(readLinkXMarker(memoryStorage({ [FLUENT_LINK_X_MARKER_KEY]: "{}" }))).toEqual({
      kind: "invalid",
    });
  });

  it("accepts only a finite numeric started and a non-empty string subject", () => {
    const cases = [
      "not-json",
      "null",
      '"a string"',
      JSON.stringify({ subject: SUBJECT }),
      JSON.stringify({ started: "1700000000000", subject: SUBJECT }),
      JSON.stringify({ started: Number.POSITIVE_INFINITY, subject: SUBJECT }),
      JSON.stringify({ started: 1, subject: "" }),
      JSON.stringify({ started: 1, subject: 7 }),
    ];
    for (const raw of cases) {
      const storage = memoryStorage({ [FLUENT_LINK_X_MARKER_KEY]: raw });
      expect(readLinkXMarker(storage), raw).toEqual({ kind: "invalid" });
      // And is gone: a value that is not a marker can only be a leftover, and leaving it would
      // make every later read parse it again.
      expect(storage.getItem(FLUENT_LINK_X_MARKER_KEY), raw).toBeNull();
    }
  });

  it("is owned by the subject that started it, and by nobody else", () => {
    const marker = { started: 1, subject: SUBJECT };
    expect(ownsLinkXMarker(marker, SUBJECT)).toBe(true);
    expect(ownsLinkXMarker(marker, "did:privy:someone-else")).toBe(false);
    expect(ownsLinkXMarker(marker, undefined)).toBe(false);
    expect(ownsLinkXMarker(null, SUBJECT)).toBe(false);
  });

  it("answers for a storage that refuses everything", () => {
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLinkXMarker(refusing)).toEqual({ kind: "none" });
    expect(() => writeLinkXMarker(refusing, { started: 1, subject: SUBJECT })).not.toThrow();
    expect(() => clearLinkXMarker(refusing)).not.toThrow();
    expect(readLinkXMarker(null)).toEqual({ kind: "none" });
  });
});

describe("toLinkXPrivyError", () => {
  it("maps the three codes an integrator can act on, by value", () => {
    expect(toLinkXPrivyError("oauth_user_denied").code).toBe("user_rejected");
    expect(toLinkXPrivyError("exited_link_flow").code).toBe("user_rejected");
    expect(toLinkXPrivyError("linked_to_another_user").code).toBe("linked_to_another_user");
  });

  it("maps everything else, cannot_link_more_of_type included, to link_failed", () => {
    expect(toLinkXPrivyError("cannot_link_more_of_type").code).toBe("link_failed");
    expect(toLinkXPrivyError("unknown_auth_error").code).toBe("link_failed");
    expect(toLinkXPrivyError("").code).toBe("link_failed");
  });

  it("refuses discarded intent under link_failed, and says what to do", () => {
    const error = linkXIntentDiscardedError();
    expect(error).toBeInstanceOf(FluentAuthError);
    expect(error.name).toBe("FluentAuthError");
    expect(error.code).toBe("link_failed");
    expect(error.message).toContain("linkX() again");
  });

  it("tells a discard from any other link_failed", () => {
    expect(isLinkXIntentDiscarded(linkXIntentDiscardedError())).toBe(true);
    expect(isLinkXIntentDiscarded(new FluentAuthError("link_failed", "Privy is unreachable"))).toBe(
      false,
    );
    expect(isLinkXIntentDiscarded(toLinkXPrivyError("cannot_link_more_of_type"))).toBe(false);
    expect(isLinkXIntentDiscarded(new Error("link_failed"))).toBe(false);
  });
});

describe("requestLinkX: a user who already has X", () => {
  it("sends exactly one POST and resolves linked from its body", async () => {
    const { params, journal, fetchMock } = arrange();

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(journal).toEqual(["POST"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("authenticates the request and sends exactly the two fields the route takes", async () => {
    const { params, fetchMock } = arrange();

    await requestLinkX(params);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PUBLIC_API_URL}/me/identity/privy`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer fluent-token",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      accessToken: "privy-access-token",
      identityToken: TOKEN_WITH_X,
    });
  });

  it("never calls GET /me/profile", async () => {
    const { params, fetchMock } = arrange();

    await requestLinkX(params);

    for (const [url] of fetchMock.mock.calls as Array<[string]>) {
      expect(url).not.toContain("/me/profile");
    }
  });
});

describe("requestLinkX: a user who has no X account", () => {
  it("writes the marker, then redirects, and sends nothing", async () => {
    const { params, journal, fetchMock, storage } = arrange({ identityToken: TOKEN_WITHOUT_X });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    // One refresh, then the marker, then the redirect — in that order, because `linkTwitter()`
    // navigates and anything written after it may never run.
    expect(journal).toEqual(["refresh", `write:${FLUENT_LINK_X_MARKER_KEY}`, "linkTwitter"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: SUBJECT },
    });
  });

  it("probes the token it holds before it refreshes anything", async () => {
    const getIdentityToken = vi.fn(async () => TOKEN_WITH_X);
    const { params, journal } = arrange({ identityToken: TOKEN_WITH_X, getIdentityToken });

    await requestLinkX(params);

    expect(getIdentityToken).not.toHaveBeenCalled();
    expect(journal).toEqual(["POST"]);
  });
});

describe("requestLinkX: freshness", () => {
  it("carries the post-link token the refresh produced, and does not redirect", async () => {
    // The identity token the widget holds was minted before the link — the OAuth hop does not
    // refresh it — so the one that reaches the service is the refreshed one, or the route
    // refreshes nothing and answers `x: null`.
    const getIdentityToken = vi.fn(async () => TOKEN_WITH_X);
    const { params, journal, fetchMock } = arrange({
      identityToken: TOKEN_WITHOUT_X,
      getIdentityToken,
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(getIdentityToken).toHaveBeenCalledTimes(1);
    expect(journal).toEqual(["POST"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).identityToken).toBe(TOKEN_WITH_X);
  });

  it("refreshes exactly once and takes the hop when the fresh token still has no X", async () => {
    const getIdentityToken = vi.fn(async () => TOKEN_WITHOUT_X);
    const { params } = arrange({ identityToken: TOKEN_WITHOUT_X, getIdentityToken });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(getIdentityToken).toHaveBeenCalledTimes(1);
  });

  it("fails the call when the refresh does", async () => {
    const { params, fetchMock } = arrange({
      identityToken: TOKEN_WITHOUT_X,
      getIdentityToken: async () => {
        throw new FluentAuthError("link_failed", "Privy did not publish a fresh identity token.");
      },
    });

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("requestLinkX: refusals", () => {
  it("refuses hosted mode before any Privy, wallet or network call", async () => {
    const getIdentityToken = vi.fn();
    const getAccessToken = vi.fn();
    const getAuthToken = vi.fn();
    const linkTwitter = vi.fn();
    const { params, fetchMock, storage } = arrange({
      authMode: "hosted",
      getIdentityToken,
      getAccessToken,
      getAuthToken,
      linkTwitter,
    });

    expect((await rejection(requestLinkX(params))).code).toBe("hosted_not_supported");

    expect(getIdentityToken).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(linkTwitter).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("refuses with not_authenticated when no Fluent ID is connected", async () => {
    expect((await rejection(requestLinkX(arrange({ accountKind: undefined }).params))).code).toBe(
      "not_authenticated",
    );
    expect((await rejection(requestLinkX(arrange({ subject: undefined }).params))).code).toBe(
      "not_authenticated",
    );
  });

  it("refuses an external wallet with link_failed and names the follow-up", async () => {
    const error = await rejection(requestLinkX(arrange({ accountKind: "eoa" }).params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toContain("FLU-1555");
  });

  it("maps the service's own refusals", async () => {
    const cases: Array<[Response, string]> = [
      [jsonResponse({ code: "bad_request", message: "accessToken is required" }, 400), "bad_request"],
      [
        jsonResponse({ code: "privy_identity_already_linked", message: "already linked" }, 409),
        "linked_to_another_user",
      ],
      [
        jsonResponse({ code: "privy_wallet_mismatch", message: "wallet mismatch" }, 403),
        "link_failed",
      ],
      [jsonResponse({ code: "internal", message: "boom" }, 500), "link_failed"],
      [jsonResponse({ code: "rate_limited", message: "slow down" }, 429), "link_failed"],
    ];

    for (const [response, code] of cases) {
      const { params } = arrange({ response });
      expect((await rejection(requestLinkX(params))).code, code).toBe(code);
    }
  });

  it("maps a transport failure to link_failed", async () => {
    const { params } = arrange({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof globalThis.fetch,
    });

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");
  });

  it("refuses a 200 whose x is null, missing or malformed", async () => {
    const bodies = [profileBody(null), { subject: "fcid_owner", appId: "app_1" }, profileBody({ id: "1458" })];

    for (const body of bodies) {
      const { params } = arrange({ response: jsonResponse(body) });
      const error = await rejection(requestLinkX(params));
      expect(error.code, JSON.stringify(body)).toBe("link_failed");
    }
  });

  it("refuses with link_failed when Privy has no access token to send", async () => {
    const { params, fetchMock } = arrange({ getAccessToken: async () => null });

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("requestLinkX: every rejection is one of its own six codes", () => {
  it("keeps a refusal from under the call under link_failed, with its message", async () => {
    // `getAuthToken()` has a vocabulary of its own. A code from it must not reach an integrator's
    // `switch` over `linkX()`'s codes unannounced; what it said is still worth reading.
    const { params, fetchMock } = arrange({
      getAuthToken: async () => {
        throw new FluentAuthError("app_not_auth_enabled", "Auth is disabled for this App.", 403);
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Auth is disabled for this App.");
    expect(error.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an ordinary error from the refresh to link_failed", async () => {
    const { params, fetchMock, journal } = arrange({
      identityToken: TOKEN_WITHOUT_X,
      getIdentityToken: async () => {
        throw new Error("Privy is unreachable");
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Privy is unreachable");
    expect(journal).not.toContain("linkTwitter");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a linkTwitter() that throws to link_failed, and leaves no marker behind", async () => {
    // No navigation started, so no return is coming: a marker left here would make the next
    // call wait for one.
    const { params, storage, fetchMock } = arrange({
      identityToken: TOKEN_WITHOUT_X,
      getIdentityToken: async () => TOKEN_WITHOUT_X,
      linkTwitter: () => {
        throw new Error("no window");
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a non-Error thrown under the call to link_failed", async () => {
    const { params } = arrange({
      getAccessToken: async () => {
        throw "not even an Error";
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("not even an Error");
  });
});
