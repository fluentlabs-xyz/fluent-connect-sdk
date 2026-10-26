/**
 * @vitest-environment jsdom
 *
 * How a Sponsorship refusal is classified, and the error a send rejects with when both
 * Sponsorship and the own-gas fallback failed.
 *
 * `getSponsorshipFailure` is called directly with the errors viem raises for the sponsorship
 * paymaster's answers; it needs no fake. So is the `FluentSponsorshipFallbackError` constructor in
 * the `cause` and `fallbackError` cases (FLU-1637), with hand-built vendor errors.
 *
 * The fallback cases (FLU-1622, criterion 4.2) check standard A3's shape: a `name` and a string
 * `code`, the `FluentSponsorshipReason`, beside the `sponsorshipReason` it already carried. Each
 * sends through `sendCalls` of `useFluentZeroDevAccount` with the App's Sponsorship configured,
 * rendered as the widget renders it (`test/fakes/smartAccountSend.ts`): the sponsorship
 * paymaster refuses the operation in one of the ways it can, and the bundler then rejects the
 * own-gas submission, so the rejection is the one a host's `execute()` receives.
 * `core/sponsoredClient.ts` and `core/sponsorshipFailure.ts` classify the refusal for real.
 *
 * The FLU-1637 cases take the same route to what a host that logs the error reads: its `message`,
 * its `cause` and its `fallbackError` hold no URL, request body, `0x` address, hash, bearer token
 * or `did:` id from the vendor errors under them, on both paths that wrap (the forced token
 * refresh after a 401 fails, or a sponsored submission fails). The sponsorship paymaster and the
 * bundler echo identifiers back in their refusals (`vendorDetail`), and the bundler's URL holds
 * the ZeroDev project id, so the raw errors viem and ZeroDev build carry all of them.
 *
 * Fakes, and nothing else, for the cases that send (`test/fakes/fluentId.ts` says what each
 * mirrors): Privy 2.25.0 with a signed-in user and one Signer; the smart account `@zerodev/sdk`
 * 5.5.10 derives and its `@zerodev/ecdsa-validator` 5.4.9 validator; and `fetch`, answering as
 * the widget chain, the ZeroDev bundler, the sponsorship paymaster and fluent-connect-service.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { BaseError, HttpRequestError, RpcRequestError, encodeErrorResult, parseAbi } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRIVY_USER,
  SIGNER,
  SMART_ACCOUNT,
  USER_OP_HASH,
  methodsAt,
  privyUserRejection,
  resetBoundary,
  stubNetwork,
  type Boundary,
} from "../../test/fakes/fluentId";
import { renderSmartAccount } from "../../test/fakes/smartAccountSend";
import { resetAuthTokenSessions } from "../widget/hooks/useAuthToken";
import { getFluentZeroDevProjectId } from "./config";
import {
  FluentSponsorshipFallbackError,
  type FluentSponsorshipReason,
  getSponsorshipFailure,
} from "./sponsorshipFailure";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

function httpError(status: number) {
  const cause = new HttpRequestError({ status, url: "https://sponsorship.example/paymaster/p" });
  const wrapper = new BaseError("send failed", { cause });
  return wrapper;
}

describe("getSponsorshipFailure", () => {
  it("treats a non-HTTP error as a per-operation policy denial", () => {
    expect(getSponsorshipFailure(new Error("rule refused the operation"))).toEqual({
      reason: "denied",
      disableSponsorship: false,
    });
  });

  it("disables sponsorship on 403 — the App is not sponsored here", () => {
    expect(getSponsorshipFailure(httpError(403))).toEqual({
      reason: "unauthorized",
      disableSponsorship: true,
    });
  });

  it("keeps sponsorship on for a 401: one fresh Fluent token and one retry answer it", () => {
    expect(getSponsorshipFailure(httpError(401))).toEqual({
      reason: "unauthorized",
      disableSponsorship: false,
    });
  });

  it("treats a 502 as transient", () => {
    expect(getSponsorshipFailure(httpError(502))).toEqual({
      reason: "unreachable",
      disableSponsorship: false,
    });
  });
});

const CALLS = [{ to: "0x3333333333333333333333333333333333333333" as const, data: "0x" as const }];

/** Read past the type: `code` is the field this criterion adds. */
function codeOf(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

describe("criterion 4.2: a sponsored send whose own-gas fallback failed too", () => {
  beforeEach(() => {
    resetAuthTokenSessions();
    stubNetwork();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each<[string, Partial<Boundary>, FluentSponsorshipReason]>([
    ["the paymaster denies the operation", { sponsorship: "denies" }, "denied"],
    ["the paymaster refuses the App (403)", { sponsorship: 403 }, "unauthorized"],
    ["the paymaster is not there (404)", { sponsorship: 404 }, "unreachable"],
    [
      "the paymaster rejects the token (401) and no fresh one is issued",
      { sponsorship: 401, exchanges: ["token", 401] },
      "no_token",
    ],
  ])("rejects with code %s → %s beside the same sponsorshipReason", async (_, script, reason) => {
    resetBoundary({ ...script, submissions: ["reject"] });
    const account = renderSmartAccount({ sponsored: true });
    await waitFor(() => expect(account.current.privyAuthenticated).toBe(true));

    const error = await account.current
      .sendCalls(CALLS, { confirmation: "prompt" })
      .then(() => undefined, (caught: unknown) => caught);

    expect(methodsAt("sponsorship")[0]).toBe("zd_sponsorUserOperation");
    expect(methodsAt("bundler")).toContain("eth_sendUserOperation");
    expect(error).toBeInstanceOf(FluentSponsorshipFallbackError);
    const fallback = error as FluentSponsorshipFallbackError;
    expect(fallback.name).toBe("FluentSponsorshipFallbackError");
    expect(fallback.sponsorshipReason).toBe(reason);
    expect(codeOf(fallback)).toBe(reason);
  });
});

describe("FluentSponsorshipFallbackError's cause and fallbackError", () => {
  const fallbackOf = (sponsorshipError: unknown, fallbackError: unknown) =>
    new FluentSponsorshipFallbackError({
      sponsorshipReason: "denied",
      sponsorshipError,
      fallbackError,
    });

  it("keeps the HTTP status of an error nested anywhere in the chain, and no chain", () => {
    const error = fallbackOf(httpError(502), new Error("own gas failed"));

    expect(error.cause).toStrictEqual({
      name: "BaseError",
      message: "HTTP request failed.",
      status: 502,
    });
    expect(error.fallbackError).toStrictEqual({ name: "Error", message: "own gas failed" });
  });

  it("replaces emails, UUIDs, call data and signatures in a vendor's text", () => {
    const signature = `0x${"ab".repeat(65)}`;
    const error = fallbackOf(
      new RpcRequestError({
        body: { method: "zd_sponsorUserOperation", params: [] },
        error: {
          code: -32602,
          message: `denied for ana@example.com in project 893acc63-da39-4b57-8789-5784ed7f1969`,
        },
        url: "https://sponsorship.example/paymaster/p",
      }),
      new Error(`signature ${signature} rejected`),
    );

    expect(error.cause).toStrictEqual({
      name: "RpcRequestError",
      message: "denied for [email] in project [id]",
    });
    expect(error.fallbackError).toStrictEqual({
      name: "Error",
      message: "signature [data 0xabababab] rejected",
    });
    expect(error.message).toBe(
      "Gas sponsorship failed: denied for [email] in project [id]\n" +
        "Paying gas from the smart account also failed: signature [data 0xabababab] rejected",
    );
  });

  it("reads a thrown value that is not an Error as an Error named Error", () => {
    const error = fallbackOf({ code: 4001, message: "refused by did:privy:cm1a2b3c" }, "offline");

    expect(error.cause).toStrictEqual({ name: "Error", message: "refused by [id]" });
    expect(error.fallbackError).toStrictEqual({ name: "Error", message: "offline" });
  });

  it("reads the innermost text of a plain Error's cause chain, and of an AggregateError", () => {
    const wrapped = new Error("wrapper", { cause: new Error("AA23 reverted: quota exceeded") });
    const aggregate = new AggregateError(
      [new Error("AA21 didn't pay prefund"), "bundler offline"],
      "all bundlers failed",
    );

    const error = fallbackOf(wrapped, aggregate);

    expect(error.cause).toStrictEqual({ name: "Error", message: "AA23 reverted: quota exceeded" });
    expect(error.fallbackError).toStrictEqual({
      name: "AggregateError",
      message: "AA21 didn't pay prefund; bundler offline",
    });
  });

  it("ends a cause chain that points back at itself", () => {
    const looped = new BaseError("send failed");
    Object.defineProperty(looped, "cause", { value: looped });
    const ring = new Error("first");
    ring.cause = new Error("second", { cause: ring });

    const error = fallbackOf(looped, ring);

    expect(error.cause).toStrictEqual({ name: "BaseError", message: "send failed" });
    expect(error.fallbackError).toStrictEqual({ name: "Error", message: "second" });
  });

  it.each<[string, () => unknown]>([
    ["a name getter that throws", () => {
      const thrown = new Error("AA21");
      Object.defineProperty(thrown, "name", {
        get() {
          throw new Error(`name getter leaked ${"0x" + "12".repeat(20)}`);
        },
      });
      return thrown;
    }],
    ["a message getter that throws", () => ({
      get message(): string {
        throw new Error("message getter leaked did:privy:secret-person");
      },
    })],
    ["an object without a prototype", () => Object.create(null)],
    ["a proxy whose every trap throws", () =>
      new Proxy({}, {
        get() {
          throw new Error("proxy leaked did:privy:secret-person");
        },
        getPrototypeOf() {
          throw new Error("proxy leaked did:privy:secret-person");
        },
      })],
  ])("never throws and never lets a vendor error out for %s", (_, hostile) => {
    const error = fallbackOf(hostile(), hostile());

    expect(error).toBeInstanceOf(FluentSponsorshipFallbackError);
    expect(error.code).toBe("denied");
    expect(error.message).not.toMatch(/leaked/);
    for (const summary of [error.cause, error.fallbackError]) {
      expect(JSON.stringify(summary)).not.toMatch(/leaked/);
    }
  });

  it("keeps a JSON details body's message rather than the whole body", () => {
    const error = fallbackOf(
      new HttpRequestError({
        status: 403,
        url: "https://sponsorship.example/paymaster/p",
        details: JSON.stringify({ code: "policy_denied", message: "App not sponsored" }),
      }),
      new Error("own gas failed"),
    );

    expect(error.cause).toStrictEqual({
      name: "HttpRequestError",
      message: "App not sponsored",
      status: 403,
    });
  });
});

const BEARER =
  "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJkaWQ6cHJpdnk6Zmx1ZW50LWlkLW93bmVyIn0.c2lnbmF0dXJlLWJ5dGVz";
const API_KEY = "sk_live_51HxAbCdEf0123456789";
const VENDOR_URL = `https://rpc.zerodev.app/api/v3/proj-key-7d1e/chain/20994?apikey=${API_KEY}`;
/** What a vendor may echo back about the request it refused. */
const VENDOR_DETAIL = [
  `for userOp ${USER_OP_HASH}`,
  `sender ${SMART_ACCOUNT} signer ${SIGNER}`,
  `owner ${PRIVY_USER}`,
  `Authorization: Bearer ${BEARER}`,
  `at ${VENDOR_URL}`,
  `request {"method":"eth_sendUserOperation","params":[{"sender":"${SMART_ACCOUNT}"}]}`,
].join(", ");

/** Each string a host could reach from `value`: own properties, enumerable or not, and causes. */
function textsOf(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "bigint") return [String(value)];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.getOwnPropertyNames(value).flatMap((key) =>
    textsOf(Reflect.get(value, key), seen),
  );
}

/** Every identifier this file plants or the real request carries, as a host would grep. */
const LEAKS: Array<[string, RegExp]> = [
  ["a URL", /\b[a-z][a-z\d+.-]*:\/\//i],
  ["the ZeroDev project id", new RegExp(getFluentZeroDevProjectId("testnet"))],
  ["an API key", new RegExp(API_KEY)],
  ["a request body", /eth_sendUserOperation|zd_sponsorUserOperation|"method"|"params"/],
  ["a 0x address or hash", /0x[\da-f]{40}/i],
  ["the user operation hash", new RegExp(USER_OP_HASH.slice(2), "i")],
  ["the smart account", new RegExp(SMART_ACCOUNT.slice(2), "i")],
  ["the Signer", new RegExp(SIGNER.slice(2), "i")],
  ["a bearer token", new RegExp(BEARER.split(".")[0] ?? BEARER)],
  ["a did:privy: id", /did:privy:/i],
];

async function sendAndFail(
  script: Partial<Boundary>,
  vendorDetail: string = VENDOR_DETAIL,
): Promise<FluentSponsorshipFallbackError> {
  resetBoundary({ submissions: ["reject"], ...script, vendorDetail });
  const account = renderSmartAccount({ sponsored: true });
  await waitFor(() => expect(account.current.privyAuthenticated).toBe(true));

  const error = await account.current
    .sendCalls(CALLS, { confirmation: "prompt" })
    .then(() => undefined, (caught: unknown) => caught);

  expect(methodsAt("sponsorship")[0]).toBe("zd_sponsorUserOperation");
  // A refused signature ends the own-gas submission before it reaches the bundler.
  if (!script.promptRefusal) expect(methodsAt("bundler")).toContain("eth_sendUserOperation");
  expect(error).toBeInstanceOf(FluentSponsorshipFallbackError);
  if (!(error instanceof FluentSponsorshipFallbackError)) throw error;
  return error;
}

/**
 * What a host's log of the error shows: its message, its stack and the two summaries. The stack's
 * frames name the host's own modules, so only its other lines are read.
 */
function readByHost(error: FluentSponsorshipFallbackError): Record<string, string> {
  const stackText = (error.stack ?? "").split("\n").filter((line) => !/^\s+at /.test(line));
  return {
    message: error.message,
    stack: stackText.join("\n"),
    cause: textsOf(error.cause).join("\n"),
    fallbackError: textsOf(error.fallbackError).join("\n"),
  };
}

function expectNoIdentifier(error: FluentSponsorshipFallbackError, leaks = LEAKS): void {
  for (const [field, text] of Object.entries(readByHost(error))) {
    for (const [what, pattern] of leaks) {
      expect(pattern.test(text), `${field} holds ${what}: ${text}`).toBe(false);
    }
  }
}

/** The bundler's own sentence survives, and the five-error chain under it is one object. */
const FALLBACK = {
  name: "UserOperationExecutionError",
  message: expect.stringMatching(/^AA21 didn't pay prefund for userOp \[hash\]/),
};

describe("FLU-1637: what a host that logs a FluentSponsorshipFallbackError reads", () => {
  beforeEach(() => {
    resetAuthTokenSessions();
    stubNetwork();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("a FluentSponsorshipFallbackError after the forced token refresh failed", () => {
    it("carries the paymaster's 401 and the bundler's refusal without an identifier", async () => {
      const error = await sendAndFail({ sponsorship: 401, exchanges: ["token", 401] });

      expect(error.code).toBe("no_token");
      expect(error.cause).toStrictEqual({
        name: "HttpRequestError",
        message: expect.stringMatching(/^refused for userOp \[hash\]/),
        status: 401,
      });
      expect(error.fallbackError).toStrictEqual(FALLBACK);
      expect(error.message).toContain("AA21 didn't pay prefund");
      expectNoIdentifier(error);
    });
  });

  describe("a FluentSponsorshipFallbackError after a failed sponsored submission", () => {
    it.each<[string, Partial<Boundary>, FluentSponsorshipReason, Record<string, unknown>]>([
      [
        "the paymaster denies the operation",
        { sponsorship: "denies" },
        "denied",
        {
          name: "InvalidParamsRpcError",
          message: expect.stringMatching(/^the App's sponsorship policy denies this call for/),
        },
      ],
      [
        "the paymaster refuses the App (403)",
        { sponsorship: 403 },
        "unauthorized",
        { name: "HttpRequestError", message: expect.stringMatching(/^refused for/), status: 403 },
      ],
      [
        "the paymaster rejects the fresh token too (401)",
        { sponsorship: 401 },
        "unauthorized",
        { name: "HttpRequestError", message: expect.stringMatching(/^refused for/), status: 401 },
      ],
      [
        "the paymaster is not there (404)",
        { sponsorship: 404 },
        "unreachable",
        { name: "HttpRequestError", message: expect.stringMatching(/^refused for/), status: 404 },
      ],
    ])("carries no identifier when %s", async (_, script, code, cause) => {
      const error = await sendAndFail(script);

      expect(error.code).toBe(code);
      expect(error.cause).toStrictEqual(cause);
      expect(error.fallbackError).toStrictEqual(FALLBACK);
      expectNoIdentifier(error);
    });
  });

  /** A JWT whose JSON header has spaces, so its base64url does not start `eyJ` but `eyAi`. */
  const SPACED_JWT = [
    Buffer.from('{ "alg": "HS256", "typ": "JWT" }').toString("base64url"),
    Buffer.from('{ "sub": "secret-person-subject" }').toString("base64url"),
    "c2lnbmF0dXJlLWJ5dGVz",
  ].join(".");

  describe("vendor text a refusal echoes, through a failed sponsored submission", () => {
    it.each<[string, string, string]>([
      ["a quoted bearer", 'Authorization: Bearer "opaque-secret-person"', "opaque-secret-person"],
      ["a bearer after %20", "auth=Bearer%20opaque-secret-person", "opaque-secret-person"],
      ["a bearer after +", "auth=Bearer+opaque-secret-person", "opaque-secret-person"],
      ["a JWT whose header starts eyAi", `token ${SPACED_JWT}`, SPACED_JWT.split(".")[1] ?? ""],
      ["a JWT after a word character", `id_token_${BEARER}`, BEARER.split(".")[1] ?? ""],
      ["a JWT after %20", `auth=%20${BEARER}`, BEARER.split(".")[1] ?? ""],
      ["a URL with an apostrophe", "at https://rpc.example/key'private-secret", "private-secret"],
      ["a JSON array", 'echo ["sk_live_secret_person", "app_identifying_id"]', "secret_person"],
      ["a quoted brace in a body", 'echo {"note":"a } brace","key":"sk_hidden"}', "sk_hidden"],
    ])("leaves nothing of %s", async (_, vendorDetail, secret) => {
      const error = await sendAndFail({ sponsorship: "denies" }, vendorDetail);

      expectNoIdentifier(error, [["the secret", new RegExp(secret.replace(/[+]/g, "\\+"))]]);
      expect(error.cause).toMatchObject({
        message: expect.stringMatching(/^the App's sponsorship policy denies this call /),
      });
    });

    it("keeps the vendor's text between two bodies", async () => {
      const error = await sendAndFail(
        { sponsorship: "denies" },
        'request {"id":"req-7"}; AA23 reverted: quota exceeded; response {"error":"denied"}',
      );

      expect(error.cause).toStrictEqual({
        name: "InvalidParamsRpcError",
        message:
          "the App's sponsorship policy denies this call " +
          "request [body]; AA23 reverted: quota exceeded; response [body]",
      });
    });

    it("keeps a revert's selector, and the decoded reason of an Error(string)", async () => {
      const reason = encodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        errorName: "Error",
        args: [`insufficient balance of ${SMART_ACCOUNT}`],
      });
      const custom = encodeErrorResult({
        abi: parseAbi(["error NotOwner(address)"]),
        errorName: "NotOwner",
        args: [SMART_ACCOUNT],
      });
      const error = await sendAndFail(
        { sponsorship: "denies" },
        `AA23 reverted ${reason} ${custom}`,
      );

      expect(error.fallbackError).toStrictEqual({
        name: "UserOperationExecutionError",
        message:
          "AA21 didn't pay prefund AA23 reverted " +
          `[data 0x08c379a0: insufficient balance of [address]] [data ${custom.slice(0, 10)}]`,
      });
      expectNoIdentifier(error);
    });
  });

  describe("a FluentSponsorshipFallbackError whose own-gas submission the Signer refused", () => {
    it("says the person refused, after a failed sponsored submission", async () => {
      const error = await sendAndFail({
        sponsorship: "denies",
        submissions: ["accept"],
        promptRefusal: privyUserRejection,
      });

      expect(error.code).toBe("denied");
      expect(error.fallbackError).toStrictEqual({
        name: "Error",
        message: "The user rejected the request.",
      });
      expect(methodsAt("bundler")).not.toContain("eth_sendUserOperation");
      expectNoIdentifier(error);
    });

    it("says the person refused, after the forced token refresh failed", async () => {
      const error = await sendAndFail({
        sponsorship: 401,
        exchanges: ["token", 401],
        submissions: ["accept"],
        promptRefusal: privyUserRejection,
      });

      expect(error.code).toBe("no_token");
      expect(error.fallbackError).toStrictEqual({
        name: "Error",
        message: "The user rejected the request.",
      });
    });

    it("stays a FluentSponsorshipFallbackError when reading the refusal throws", async () => {
      const hostile = () => {
        const refusal = new Error("AA21 insufficient prefund");
        Object.defineProperty(refusal, "status", {
          get() {
            throw new Error(`vendor status getter leaked ${PRIVY_USER}`);
          },
        });
        return refusal;
      };
      const error = await sendAndFail({
        sponsorship: "denies",
        submissions: ["accept"],
        promptRefusal: hostile,
      });

      expect(error.code).toBe("denied");
      expect(error.fallbackError).toStrictEqual({ name: "Error", message: "[unreadable error]" });
      expectNoIdentifier(error);
    });
  });
});
