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
  privyUserHasExternalWallet,
  privyUserHasLinkedX,
  privyUserOwnsWallet,
  readFluentProfile,
  readFluentXAccount,
  readLinkXMarker,
  requestLinkX,
  toLinkXPrivyError,
  writeLinkXMarker,
  type FluentLinkXPrivyUser,
  type LinkXSiweInput,
  type LinkXWalletInput,
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

/** The connected external wallet, as a connector spells it: lowercase, like wagmi's `address`. */
const EOA = "0x2222222222222222222222222222222222222222";
const EOA_CHECKSUM = "0x2222222222222222222222222222222222222222";
/** An address whose EIP-55 form differs from both its lowercase and its uppercase spelling. */
const MIXED_EOA_CHECKSUM = "0x092AE7564C6611a114C20C6df766B5B35A52334A";
const MIXED_EOA_LOWER = MIXED_EOA_CHECKSUM.toLowerCase();
const MIXED_EOA_UPPER = `0x${MIXED_EOA_CHECKSUM.slice(2).toUpperCase()}`;
const OTHER_EOA = "0x3333333333333333333333333333333333333333";
const CHAIN_ID = 20994;
/** The Privy user SIWE signs the wallet in as. */
const WALLET_SUBJECT = "did:privy:wallet-owner";
const SIWE_MESSAGE = "localhost wants you to sign in with your Ethereum account:\n0x2222…\n\nNonce: n-1";
const SIGNATURE = "0xsigned-siwe-message";

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
/** The wallet user's own token, as the refresh after SIWE produces it once they have X. */
const WALLET_TOKEN_WITH_X = identityTokenWith({
  sub: WALLET_SUBJECT,
  linked_accounts: linkedAccountsClaim([{ type: "wallet", chain_type: "ethereum", address: EOA }, X_ENTRY]),
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

/** A Privy user with an Ethereum wallet linked, as `loginWithSiwe` resolves one. */
function walletUser(address: string, id = WALLET_SUBJECT): FluentLinkXPrivyUser {
  return {
    id,
    linkedAccounts: [{ type: "wallet", chainType: "ethereum", address }],
  };
}

/** The embedded wallet's address on a Fluent ID's Privy user. */
const EMBEDDED_WALLET = "0x1111111111111111111111111111111111111111";

/** A Privy embedded wallet entry, marked as Privy marks one (`walletClientType: "privy"`). */
function embeddedWalletEntry(address = EMBEDDED_WALLET) {
  return {
    type: "wallet",
    chainType: "ethereum",
    address,
    walletClientType: "privy",
    connectorType: "embedded",
  };
}

/** A Fluent ID's Privy user: an X login and an embedded wallet, at an address of its own. */
function fluentIdUser(id = SUBJECT): FluentLinkXPrivyUser {
  return {
    id,
    linkedAccounts: [{ type: "google_oauth" }, embeddedWalletEntry()],
  };
}

/**
 * The connected wallet and Privy's SIWE, each step writing to the journal with what it was
 * handed, so a case can assert the order and the arguments together.
 */
function siweArrange(
  journal: Journal,
  options: {
    address?: string;
    session?: FluentLinkXPrivyUser | null;
    fluentSessionUserId?: string;
    signedInUser?: (address: string) => FluentLinkXPrivyUser;
  } = {},
): { wallet: LinkXWalletInput; siwe: LinkXSiweInput } {
  const address = options.address ?? EOA;
  const wallet: LinkXWalletInput = {
    address,
    chainId: CHAIN_ID,
    signMessage: async (message) => {
      journal.push(`sign:${message}`);
      return SIGNATURE;
    },
  };
  const siwe: LinkXSiweInput = {
    session: options.session ?? null,
    fluentSessionUserId: options.fluentSessionUserId,
    logout: async () => {
      journal.push("logout");
    },
    generateSiweMessage: async ({ address: forAddress, chainId }) => {
      journal.push(`generateSiweMessage:${forAddress}:${chainId}`);
      return SIWE_MESSAGE;
    },
    loginWithSiwe: async ({ message, signature }) => {
      journal.push(`loginWithSiwe:${message}:${signature}`);
      return (options.signedInUser ?? walletUser)(address);
    },
  };
  return { wallet, siwe };
}

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
    wallet: null,
    siwe: siweArrange(journal).siwe,
    publicApiUrl: PUBLIC_API_URL,
    readIdentityToken: () => TOKEN_WITH_X,
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

/**
 * `arrange` for an external wallet: `accountKind: "eoa"`, no Fluent ID subject, the wallet, the
 * SIWE steps and the Fluent token's mint journaled. `readIdentityToken` answers `null`, as it
 * does for a wallet user whose Privy session the widget has not seen a token for yet; the
 * refresh after SIWE answers it.
 *
 * `getAuthToken` journals its first call only — the mint — the way the widget's own answers
 * every later call of a page from its cache: the POST that follows a mint costs the wallet
 * nothing, and the journal says so by not listing it.
 */
function arrangeWallet(
  options: Parameters<typeof siweArrange>[1] & {
    overrides?: Partial<RequestLinkXParams> & { response?: Response };
  } = {},
) {
  const { overrides = {}, ...siweOptions } = options;
  const arranged = arrange({
    accountKind: "eoa",
    subject: undefined,
    readIdentityToken: () => null,
    ...overrides,
  });
  const { wallet, siwe } = siweArrange(arranged.journal, siweOptions);
  arranged.params.wallet = overrides.wallet === undefined ? wallet : overrides.wallet;
  arranged.params.siwe = overrides.siwe ?? siwe;
  if (overrides.getAuthToken === undefined) {
    let minted = false;
    arranged.params.getAuthToken = async () => {
      if (!minted) arranged.journal.push("getAuthToken");
      minted = true;
      return "fluent-token";
    };
  }
  return arranged;
}

const MARKER_WRITE = `write:${FLUENT_LINK_X_MARKER_KEY}`;
const SIWE_STEPS = [
  `generateSiweMessage:${EOA_CHECKSUM}:eip155:${CHAIN_ID}`,
  `sign:${SIWE_MESSAGE}`,
  `loginWithSiwe:${SIWE_MESSAGE}:${SIGNATURE}`,
];

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

describe("privyUserOwnsWallet", () => {
  it("is owned through an Ethereum wallet entry at the address, in any case", () => {
    expect(privyUserOwnsWallet(walletUser(EOA), EOA)).toBe(true);
    expect(privyUserOwnsWallet(walletUser(MIXED_EOA_CHECKSUM), MIXED_EOA_LOWER)).toBe(true);
    expect(privyUserOwnsWallet(walletUser(MIXED_EOA_LOWER), MIXED_EOA_UPPER)).toBe(true);
  });

  it("is not owned by a user whose wallets are elsewhere, or who has none", () => {
    expect(privyUserOwnsWallet(walletUser(OTHER_EOA), EOA)).toBe(false);
    // A Fluent ID's embedded wallet is an Ethereum wallet entry too, at its own address.
    expect(privyUserOwnsWallet(fluentIdUser(), EOA)).toBe(false);
    expect(privyUserOwnsWallet({ id: SUBJECT, linkedAccounts: [] }, EOA)).toBe(false);
  });

  it("reads only entries that are Ethereum wallets", () => {
    const user: FluentLinkXPrivyUser = {
      id: WALLET_SUBJECT,
      linkedAccounts: [
        { type: "wallet", chainType: "solana", address: EOA },
        { type: "smart_wallet", chainType: "ethereum", address: EOA },
        { type: "wallet", address: EOA },
      ],
    };
    expect(privyUserOwnsWallet(user, EOA)).toBe(false);
  });

  it("is never owned without a user, an address, or the accounts to read", () => {
    expect(privyUserOwnsWallet(null, EOA)).toBe(false);
    expect(privyUserOwnsWallet(undefined, EOA)).toBe(false);
    expect(privyUserOwnsWallet(walletUser(EOA), undefined)).toBe(false);
    expect(privyUserOwnsWallet({ id: WALLET_SUBJECT } as unknown as FluentLinkXPrivyUser, EOA)).toBe(false);
  });
});

describe("privyUserHasExternalWallet", () => {
  it("holds one through an Ethereum wallet entry Privy has not marked embedded", () => {
    // As SIWE leaves it: no client or connector recorded.
    expect(privyUserHasExternalWallet(walletUser(EOA))).toBe(true);
    // As a wallet verified through a connector carries them.
    expect(
      privyUserHasExternalWallet({
        id: WALLET_SUBJECT,
        linkedAccounts: [
          { type: "wallet", chainType: "ethereum", address: EOA, walletClientType: "metamask", connectorType: "injected" },
        ],
      }),
    ).toBe(true);
  });

  it("holds none through a Fluent ID's embedded wallet, however Privy marks it", () => {
    expect(privyUserHasExternalWallet(fluentIdUser())).toBe(false);
    for (const marked of [
      { walletClientType: "privy" },
      { walletClientType: "privy-v2" },
      { connectorType: "embedded" },
    ]) {
      expect(
        privyUserHasExternalWallet({
          id: SUBJECT,
          linkedAccounts: [{ type: "twitter_oauth" }, { type: "wallet", chainType: "ethereum", address: EMBEDDED_WALLET, ...marked }],
        }),
      ).toBe(false);
    }
  });

  it("still holds one with an embedded wallet beside it, whichever wallet is connected", () => {
    const user: FluentLinkXPrivyUser = {
      id: WALLET_SUBJECT,
      linkedAccounts: [{ type: "wallet", chainType: "ethereum", address: OTHER_EOA }, embeddedWalletEntry()],
    };
    expect(privyUserHasExternalWallet(user)).toBe(true);
    // Not the connected wallet's — a mismatched session — yet an external wallet's all the same.
    expect(privyUserOwnsWallet(user, EOA)).toBe(false);
  });

  it("reads only entries that are Ethereum wallets", () => {
    expect(
      privyUserHasExternalWallet({
        id: WALLET_SUBJECT,
        linkedAccounts: [
          { type: "wallet", chainType: "solana", address: EOA },
          { type: "smart_wallet", chainType: "ethereum", address: EOA },
          { type: "wallet", address: EOA },
          { type: "google_oauth" },
        ],
      }),
    ).toBe(false);
  });

  it("holds none without a user or the accounts to read", () => {
    expect(privyUserHasExternalWallet(null)).toBe(false);
    expect(privyUserHasExternalWallet(undefined)).toBe(false);
    expect(privyUserHasExternalWallet({ id: SUBJECT, linkedAccounts: [] })).toBe(false);
    expect(privyUserHasExternalWallet({ id: WALLET_SUBJECT } as unknown as FluentLinkXPrivyUser)).toBe(false);
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
    const { params, journal, fetchMock, storage } = arrange({ readIdentityToken: () => TOKEN_WITHOUT_X });

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
    const { params, journal } = arrange({ readIdentityToken: () => TOKEN_WITH_X, getIdentityToken });

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
      readIdentityToken: () => TOKEN_WITHOUT_X,
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
    const { params } = arrange({ readIdentityToken: () => TOKEN_WITHOUT_X, getIdentityToken });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(getIdentityToken).toHaveBeenCalledTimes(1);
  });

  it("fails the call when the refresh does", async () => {
    const { params, fetchMock } = arrange({
      readIdentityToken: () => TOKEN_WITHOUT_X,
      getIdentityToken: async () => {
        throw new FluentAuthError("link_failed", "Privy did not publish a fresh identity token.");
      },
    });

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("requestLinkX: an external wallet signs in to Privy first", () => {
  it("runs SIWE — message, signature, login — and only then the marker and the redirect", async () => {
    const { params, journal, fetchMock, storage } = arrangeWallet();

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    // The three SIWE steps in order, with exactly what each was handed: Privy's message for the
    // EIP-55 address on the widget's chain, the wallet's signature over that very message, and
    // the login with the two — then FLU-1552's path with the signed-in user as the subject.
    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: WALLET_SUBJECT },
    });
  });

  it.each([
    ["lowercase", MIXED_EOA_LOWER],
    ["EIP-55", MIXED_EOA_CHECKSUM],
    ["uppercase", MIXED_EOA_UPPER],
  ])("hands Privy the EIP-55 form of a %s address, and changes the connected one nowhere", async (_, address) => {
    const { params, journal } = arrangeWallet({ address });

    await requestLinkX(params);

    expect(journal[0]).toBe(`generateSiweMessage:${MIXED_EOA_CHECKSUM}:eip155:${CHAIN_ID}`);
    // The connector's spelling is what the ownership check compared against, and what the
    // widget's Fluent subject and cache key keep reading: nothing here rewrote it.
    expect(params.wallet?.address).toBe(address);
  });

  it("signs exactly the message Privy generated, and logs in with that message and signature", async () => {
    const signMessage = vi.fn(async () => SIGNATURE);
    const loginWithSiwe = vi.fn(async () => walletUser(EOA));
    const { params } = arrangeWallet();
    params.wallet = { ...params.wallet!, signMessage };
    params.siwe = { ...params.siwe, loginWithSiwe };

    await requestLinkX(params);

    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(SIWE_MESSAGE);
    expect(loginWithSiwe).toHaveBeenCalledTimes(1);
    expect(loginWithSiwe).toHaveBeenCalledWith({ message: SIWE_MESSAGE, signature: SIGNATURE });
  });

  it("refreshes after SIWE even when the widget holds a token with X from before it", async () => {
    // A token left from whoever was signed in before — not this wallet's user, since nobody was
    // signed in as them. It says nothing about the user SIWE just made.
    const { params, journal, fetchMock } = arrangeWallet({ overrides: { readIdentityToken: () => TOKEN_WITH_X } });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves linked after SIWE for a wallet user whose Privy user already has X", async () => {
    const { params, journal, fetchMock } = arrangeWallet({
      overrides: { getIdentityToken: async () => TOKEN_WITH_X },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken", "POST"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("requestLinkX: a wallet user with a live Privy session of their own", () => {
  it("runs no SIWE step and no logout on a repeat call, and resolves linked", async () => {
    const { params, journal } = arrangeWallet({
      session: walletUser(EOA),
      overrides: { readIdentityToken: () => TOKEN_WITH_X },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(journal).toEqual(["getAuthToken", "POST"]);
  });

  it("runs no SIWE step and no logout on a repeat call, and takes the hop", async () => {
    const { params, journal, storage } = arrangeWallet({ session: walletUser(EOA) });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual(["getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: WALLET_SUBJECT },
    });
  });

  it("owns the session through the address in any case, with the embedded wallet beside it", async () => {
    // A SIWE session whose Privy user also carries an embedded wallet — tolerated, never read:
    // the ownership is through the connected address, and the subject is the user's id.
    const session: FluentLinkXPrivyUser = {
      id: WALLET_SUBJECT,
      linkedAccounts: [
        { type: "wallet", chainType: "ethereum", address: "0x1111111111111111111111111111111111111111" },
        { type: "wallet", chainType: "ethereum", address: MIXED_EOA_CHECKSUM },
      ],
    };
    const { params, journal } = arrangeWallet({ address: MIXED_EOA_LOWER, session });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual(["getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
  });
});

describe("requestLinkX: the wallet's Fluent token is minted before the hop", () => {
  // Criterion 13: the wallet signs everything before the page leaves for X. The token's mint
  // runs with the session settled — after SIWE, or at once on a live owning session — and
  // before the probe, the marker and the redirect, so that the return page renews the token
  // from the credential the mint persisted and opens the wallet for nothing.

  it("mints the token after SIWE and before the probe, the marker and the redirect", async () => {
    const getAuthToken = vi.fn(async () => {
      journal.push("getAuthToken");
      return "fluent-token";
    });
    const { params, journal, storage } = arrangeWallet({ overrides: { getAuthToken } });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: WALLET_SUBJECT },
    });
  });

  it("mints it on a repeat call with a live owning session too, before the hop", async () => {
    const getAuthToken = vi.fn(async () => {
      journal.push("getAuthToken");
      return "fluent-token";
    });
    const { params, journal } = arrangeWallet({ session: walletUser(EOA), overrides: { getAuthToken } });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(journal).toEqual(["getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
  });

  it.each([
    [
      "as getAuthToken() reports it",
      new FluentAuthError("request_failed", "User rejected the request.\n\nDetails: MetaMask Typed Message Signature: User denied message signature."),
    ],
    ["as the wallet throws it", Object.assign(new Error("User rejected the request."), { code: 4001 })],
  ])("maps a refused challenge signature — %s — to user_rejected, with no marker and no redirect", async (_, thrown) => {
    const { params, journal, fetchMock, storage } = arrangeWallet({
      overrides: {
        getAuthToken: async () => {
          journal.push("getAuthToken");
          throw thrown;
        },
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("user_rejected");
    // SIWE had run, and the mint was the last thing: no probe, no marker, no redirect, no POST.
    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("keeps a mint that failed for any other reason under link_failed, with its message", async () => {
    const { params, journal, storage } = arrangeWallet({
      overrides: {
        getAuthToken: async () => {
          journal.push("getAuthToken");
          throw new FluentAuthError("origin_mismatch", "Challenge origin https://elsewhere does not match https://here");
        },
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Challenge origin https://elsewhere does not match https://here");
    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken"]);
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("mints nothing while ownership is unsettled: a failed check, a mismatch, a refused signature", async () => {
    const getAuthToken = vi.fn(async () => "fluent-token");
    const failedOwnership = arrangeWallet({
      signedInUser: () => walletUser(OTHER_EOA),
      overrides: { getAuthToken },
    });
    expect((await rejection(requestLinkX(failedOwnership.params))).code).toBe("link_failed");

    const mismatchUnsettled = arrangeWallet({
      session: walletUser(OTHER_EOA, "did:privy:other-wallet"),
      overrides: { getAuthToken },
    });
    mismatchUnsettled.params.siwe = {
      ...mismatchUnsettled.params.siwe,
      logout: async () => {
        throw new FluentAuthError("link_failed", "Privy did not sign the previous session out.");
      },
    };
    expect((await rejection(requestLinkX(mismatchUnsettled.params))).code).toBe("link_failed");

    const refusedSiwe = arrangeWallet({ overrides: { getAuthToken } });
    refusedSiwe.params.wallet = {
      ...refusedSiwe.params.wallet!,
      signMessage: async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      },
    };
    expect((await rejection(requestLinkX(refusedSiwe.params))).code).toBe("user_rejected");

    expect(getAuthToken).not.toHaveBeenCalled();
  });
});

describe("requestLinkX: a live Privy session that is not the connected wallet's", () => {
  it("logs it out, waits, then signs the wallet in — the wallet and its Fluent session untouched", async () => {
    const { params, journal, storage } = arrangeWallet({ session: walletUser(OTHER_EOA, "did:privy:other-wallet") });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual(["logout", ...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: WALLET_SUBJECT },
    });
  });

  it("never probes or sends the replaced session's identity token: the signed-in wallet's own is refreshed", async () => {
    // The other wallet's user has X, and the token the widget holds is theirs and says so. The
    // wallet signing in now has no X: it must take the hop, and nothing of the other user's may
    // be read as its answer or sent under its name.
    const { params, journal, fetchMock, storage } = arrangeWallet({
      session: walletUser(OTHER_EOA, "did:privy:other-wallet"),
      overrides: { readIdentityToken: () => TOKEN_WITH_X },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual(["logout", ...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, "linkTwitter"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({
      kind: "marker",
      marker: { started: expect.any(Number), subject: WALLET_SUBJECT },
    });
  });

  it("sends the token the refresh produced after SIWE, never the one held before it", async () => {
    const { params, fetchMock } = arrangeWallet({
      session: walletUser(OTHER_EOA, "did:privy:other-wallet"),
      overrides: { readIdentityToken: () => TOKEN_WITH_X, getIdentityToken: async () => WALLET_TOKEN_WITH_X },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      accessToken: "privy-access-token",
      identityToken: WALLET_TOKEN_WITH_X,
    });
  });

  it("reaches no probe, no refresh, no marker, no redirect and no POST before the mismatch is settled", async () => {
    // The ownership check comes first. Nothing of FLU-1552's path runs as the connected wallet
    // until the mismatched session is gone and the wallet is signed in.
    const logout = vi.fn(async () => {
      throw new FluentAuthError("link_failed", "Privy did not sign the previous session out.");
    });
    const { params, journal, fetchMock, storage } = arrangeWallet({
      session: fluentIdUser("did:privy:somebody-else"),
      overrides: { readIdentityToken: () => TOKEN_WITH_X },
    });
    params.siwe = { ...params.siwe, logout };

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");

    expect(logout).toHaveBeenCalledTimes(1);
    expect(journal).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("rejects link_failed, calling neither logout nor any SIWE step, when the Fluent session names that user", async () => {
    // A Fluent ID whose smart account is still arriving reads as `eoa` while an external wallet
    // is connected. Signing it out from under the person is not this call's to do.
    const { params, journal, fetchMock, storage } = arrangeWallet({
      session: fluentIdUser(SUBJECT),
      fluentSessionUserId: SUBJECT,
      overrides: { readIdentityToken: () => TOKEN_WITH_X },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(journal).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("fails link_failed when the logout does not complete within the bound", async () => {
    const { params, journal } = arrangeWallet({ session: walletUser(OTHER_EOA, "did:privy:other-wallet") });
    params.siwe = {
      ...params.siwe,
      logout: async () => {
        throw new FluentAuthError("link_failed", "Privy did not sign the previous session out.");
      },
    };

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(journal).toEqual([]);
  });
});

describe("requestLinkX: what SIWE can fail with", () => {
  it.each([
    ["an EIP-1193 4001 on the error", Object.assign(new Error("User rejected the request."), { code: 4001 })],
    ["an EIP-1193 4001 on the cause", Object.assign(new Error("Signature failed"), { cause: { code: 4001 } })],
    ["a wallet that says so in prose", new Error("MetaMask Message Signature: User denied message signature.")],
  ])("maps a refused signature — %s — to user_rejected, and logs nothing in", async (_, thrown) => {
    const loginWithSiwe = vi.fn();
    const { params, journal, fetchMock, storage } = arrangeWallet();
    params.wallet = {
      ...params.wallet!,
      signMessage: async () => {
        throw thrown;
      },
    };
    params.siwe = { ...params.siwe, loginWithSiwe };

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("user_rejected");
    expect(loginWithSiwe).not.toHaveBeenCalled();
    expect(journal).toEqual([SIWE_STEPS[0]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("maps a signature that failed for any other reason to link_failed", async () => {
    const { params } = arrangeWallet();
    params.wallet = {
      ...params.wallet!,
      signMessage: async () => {
        throw new Error("Wallet is locked");
      },
    };

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Wallet is locked");
  });

  it("maps a failed message generation to link_failed, before the wallet is asked anything", async () => {
    const signMessage = vi.fn();
    const { params, journal } = arrangeWallet();
    params.wallet = { ...params.wallet!, signMessage };
    params.siwe = {
      ...params.siwe,
      generateSiweMessage: async () => {
        throw new Error("Privy is unreachable");
      },
    };

    expect((await rejection(requestLinkX(params))).code).toBe("link_failed");

    expect(signMessage).not.toHaveBeenCalled();
    expect(journal).toEqual([]);
  });

  it("maps a login Privy refused to link_failed, with no marker", async () => {
    const { params, journal, storage } = arrangeWallet();
    params.siwe = {
      ...params.siwe,
      loginWithSiwe: async () => {
        throw new Error("User already authenticated");
      },
    };

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("User already authenticated");
    expect(journal).toEqual(SIWE_STEPS.slice(0, 2));
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it.each([
    ["owns another wallet", walletUser(OTHER_EOA)],
    ["owns no wallet at all", { id: WALLET_SUBJECT, linkedAccounts: [{ type: "google_oauth" }] }],
    ["has no id", { id: "", linkedAccounts: [{ type: "wallet", chainType: "ethereum", address: EOA }] }],
    ["is not a user", null as unknown as FluentLinkXPrivyUser],
  ])("fails closed when the user loginWithSiwe resolved %s: nothing probed, written or sent, and that session logged out", async (_, signedIn) => {
    const { params, journal, fetchMock, storage } = arrangeWallet({
      signedInUser: () => signedIn,
      overrides: { readIdentityToken: () => TOKEN_WITH_X },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    // The logout is the last thing the call does — after SIWE, and with no probe, refresh,
    // marker or POST anywhere: the session Privy made is not left behind.
    expect(journal).toEqual([...SIWE_STEPS, "logout"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("does not settle the failed-ownership rejection before the logout has", async () => {
    let release!: () => void;
    const loggedOut = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { params, journal } = arrangeWallet({ signedInUser: () => walletUser(OTHER_EOA) });
    params.siwe = {
      ...params.siwe,
      logout: async () => {
        journal.push("logout");
        await loggedOut;
      },
    };
    let settled: FluentAuthError | null = null;
    const pending: Promise<FluentAuthError> = requestLinkX(params).then(
      () => {
        throw new Error("expected the call to reject");
      },
      (err: FluentAuthError) => {
        settled = err;
        return err;
      },
    );

    // SIWE has run and the logout has been asked for; the call is waiting on it.
    await Promise.resolve();
    for (let round = 0; round < 10; round += 1) await Promise.resolve();
    expect(journal).toEqual([...SIWE_STEPS, "logout"]);
    expect(settled).toBeNull();

    release();
    const error = await pending;
    expect(error).toBeInstanceOf(FluentAuthError);
    expect(error.code).toBe("link_failed");
    expect(error.message).toContain("signed out");
  });

  it("still fails link_failed when the logout after a failed ownership check does not complete within the bound", async () => {
    const { params, journal, fetchMock, storage } = arrangeWallet({
      signedInUser: () => walletUser(OTHER_EOA),
    });
    params.siwe = {
      ...params.siwe,
      logout: async () => {
        journal.push("logout");
        throw new FluentAuthError("link_failed", "Privy did not sign the previous session out.");
      },
    };

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toContain("did not confirm");
    expect(journal).toEqual([...SIWE_STEPS, "logout"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("keeps 403 privy_wallet_mismatch as link_failed on the wallet path", async () => {
    const { params } = arrangeWallet({
      session: walletUser(EOA),
      overrides: {
        readIdentityToken: () => TOKEN_WITH_X,
        response: jsonResponse({ code: "privy_wallet_mismatch", message: "wallet mismatch" }, 403),
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.status).toBe(403);
  });
});

/**
 * Criterion 17: the hop is Privy's `linkTwitter()` for the user the call is linking, awaited.
 * The core cannot pick the render Privy's function comes from — that is the widget's — but it
 * can name the user, and it can refuse to answer `redirecting` until the hop has settled: a
 * refusal Privy raises before the page leaves is this call's rejection, not a status nobody
 * comes back from.
 */
describe("requestLinkX: the hop is the signed-in user's, and is awaited", () => {
  it("hands linkTwitter the user SIWE signed in, and resolves redirecting only once the hop has settled", async () => {
    let requestNavigation: () => void = () => {};
    const { params, journal } = arrangeWallet({
      overrides: {
        linkTwitter: (subject) =>
          new Promise<void>((resolve) => {
            journal.push(`linkTwitter:${subject}`);
            requestNavigation = resolve;
          }),
      },
    });

    let answer: unknown = null;
    const pending = requestLinkX(params).then((result) => {
      answer = result;
      return result;
    });
    await vi.waitFor(() => expect(journal.at(-1)).toBe(`linkTwitter:${WALLET_SUBJECT}`));
    // Privy has been asked and has not navigated yet: the call has no answer.
    await Promise.resolve();
    expect(answer).toBeNull();

    requestNavigation();
    await expect(pending).resolves.toEqual({ status: "redirecting" });
    expect(journal).toEqual([...SIWE_STEPS, "getAuthToken", "refresh", MARKER_WRITE, `linkTwitter:${WALLET_SUBJECT}`]);
  });

  it("hands linkTwitter a Fluent ID's own subject", async () => {
    const { params, journal } = arrange({
      readIdentityToken: () => TOKEN_WITHOUT_X,
      linkTwitter: (subject) => {
        journal.push(`linkTwitter:${subject}`);
      },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "redirecting" });

    expect(journal).toEqual(["refresh", MARKER_WRITE, `linkTwitter:${SUBJECT}`]);
  });

  it.each([
    ["link_failed", "Privy could not link X (must_be_authenticated)."],
    ["user_rejected", "The user did not finish linking X."],
    ["linked_to_another_user", "That X account is already linked to another Fluent user."],
  ] as const)(
    "rejects with the %s Privy raised before the page left, and clears the marker",
    async (code, message) => {
      const { params, storage, fetchMock } = arrangeWallet({
        overrides: {
          linkTwitter: async () => {
            throw new FluentAuthError(code, message);
          },
        },
      });

      const error = await rejection(requestLinkX(params));

      expect(error.code).toBe(code);
      expect(error.message).toBe(message);
      expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("maps a hop that rejects with something else to link_failed, and clears the marker", async () => {
    const { params, storage } = arrangeWallet({
      overrides: {
        linkTwitter: async () => {
          throw new Error("Privy did not publish the user it signed in.");
        },
      },
    });

    const error = await rejection(requestLinkX(params));

    expect(error.code).toBe("link_failed");
    expect(error.message).toBe("Privy did not publish the user it signed in.");
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
  });

  it("reads the identity token when the probe runs, not when the call started", async () => {
    // The wallet path with an owning session: the token the widget holds is read at the probe,
    // after the Fluent token's mint — which is the earliest the wallet path reads it at all.
    const reads: string[] = [];
    const { params, journal, fetchMock } = arrangeWallet({
      session: walletUser(EOA),
      overrides: {
        readIdentityToken: () => {
          reads.push("read");
          journal.push("readIdentityToken");
          return WALLET_TOKEN_WITH_X;
        },
      },
    });

    await expect(requestLinkX(params)).resolves.toEqual({ status: "linked", x: X_ACCOUNT });

    expect(reads).toEqual(["read"]);
    expect(journal.indexOf("readIdentityToken")).toBeGreaterThan(journal.indexOf("getAuthToken"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("refuses hosted mode for an external wallet too, before SIWE", async () => {
    const { params, journal, fetchMock } = arrangeWallet({ overrides: { authMode: "hosted" } });

    expect((await rejection(requestLinkX(params))).code).toBe("hosted_not_supported");

    expect(journal).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses with not_authenticated when no Fluent ID is connected", async () => {
    expect((await rejection(requestLinkX(arrange({ accountKind: undefined }).params))).code).toBe(
      "not_authenticated",
    );
    expect((await rejection(requestLinkX(arrange({ subject: undefined }).params))).code).toBe(
      "not_authenticated",
    );
  });

  it("refuses with not_authenticated when the external wallet has no signer yet", async () => {
    const { params, journal, fetchMock, storage } = arrangeWallet({ overrides: { wallet: null } });

    expect((await rejection(requestLinkX(params))).code).toBe("not_authenticated");

    expect(journal).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLinkXMarker(storage)).toEqual({ kind: "none" });
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
      readIdentityToken: () => TOKEN_WITHOUT_X,
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
      readIdentityToken: () => TOKEN_WITHOUT_X,
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
