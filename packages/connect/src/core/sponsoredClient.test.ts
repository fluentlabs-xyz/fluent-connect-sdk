import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { BaseError, HttpRequestError, type Chain, type Hash } from "viem";
import { describe, expect, it, vi } from "vitest";

import { FluentAuthError } from "./authToken";
import { createFluentZeroDevSponsoredPaymaster } from "./zerodevPaymaster";
import {
  buildSponsoredClient,
  resolveSponsorshipBearer,
  sendWithSponsorship,
  type SponsorshipBearer,
  type SponsorshipLog,
} from "./sponsoredClient";

const APP_ID = "app_8908941315934a06b738c6804ce26132";
const SPONSORSHIP_URL = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
const PAYMASTER_URL = `${SPONSORSHIP_URL}/paymaster/${APP_ID}`;
/** A Fluent token, as `getAuthToken()` mints it. Never a Privy access token. */
const FLUENT_TOKEN = "fluent.token.first";
const FRESH_TOKEN = "fluent.token.forced-refresh";
const SPONSORED_HASH = `0x${"11".repeat(32)}` as Hash;
const RETRY_HASH = `0x${"22".repeat(32)}` as Hash;
const OWN_GAS_HASH = `0x${"33".repeat(32)}` as Hash;

type FakeClient = { id: string };
type FakeReceipt = { settledBy: string; userOpHash: Hash };

function makeLog() {
  return { debug: vi.fn(), warn: vi.fn() } satisfies SponsorshipLog;
}

/** A send failure as viem wraps the paymaster proxy's HTTP answer. */
function paymasterHttpError(status: number) {
  return new BaseError("sendUserOperation failed", {
    cause: new HttpRequestError({ status, url: PAYMASTER_URL }),
  });
}

describe("resolveSponsorshipBearer", () => {
  it("gives a Fluent ID in direct mode the token getAuthToken() minted", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => FLUENT_TOKEN);

    await expect(
      resolveSponsorshipBearer({ accountType: "smart", getAuthToken, log }),
    ).resolves.toEqual({ token: FLUENT_TOKEN });
    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(getAuthToken).toHaveBeenCalledWith({ fresh: false });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("forces a new exchange when the paymaster rejected the last token", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => FRESH_TOKEN);

    await expect(
      resolveSponsorshipBearer({ accountType: "smart", getAuthToken, fresh: true, log }),
    ).resolves.toEqual({ token: FRESH_TOKEN });
    expect(getAuthToken).toHaveBeenCalledWith({ fresh: true });
  });

  it("does not sponsor an external wallet, and mints it no token", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => FLUENT_TOKEN);

    await expect(
      resolveSponsorshipBearer({ accountType: "eoa", getAuthToken, log }),
    ).resolves.toEqual({ token: null, reason: "no_token" });
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("asks for nothing before the widget has derived an account", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => FLUENT_TOKEN);

    await expect(
      resolveSponsorshipBearer({ accountType: undefined, getAuthToken, log }),
    ).resolves.toEqual({ token: null, reason: "no_token" });
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("leaves a hosted Fluent ID with no token, warning once and throwing nothing", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => {
      throw new FluentAuthError("hosted_not_supported", 'needs authMode: "direct"');
    });

    await expect(
      resolveSponsorshipBearer({ accountType: "smart", getAuthToken, log }),
    ).resolves.toEqual({ token: null, reason: "no_token" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { code: "hosted_not_supported" });
  });

  it("names the code of any other FluentAuthError the exchange rejects with", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => {
      throw new FluentAuthError("origin_not_allowed", "register this origin on your App");
    });

    await expect(
      resolveSponsorshipBearer({ accountType: "smart", getAuthToken, log }),
    ).resolves.toEqual({ token: null, reason: "no_token" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { code: "origin_not_allowed" });
  });

  it("normalizes anything else to unknown, and logs neither the error nor a token", async () => {
    const log = makeLog();
    const getAuthToken = vi.fn(async () => {
      throw new Error(`fetch failed while exchanging ${FLUENT_TOKEN}`);
    });

    await expect(
      resolveSponsorshipBearer({ accountType: "smart", getAuthToken, log }),
    ).resolves.toEqual({ token: null, reason: "no_token" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { code: "unknown" });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(FLUENT_TOKEN);
  });
});

describe("buildSponsoredClient", () => {
  it("puts the App in the paymaster path and the Fluent token in the bearer", () => {
    const createPaymaster = vi.fn((args: { bearerToken: string }) => ({ carries: args.bearerToken }));
    const createClient = vi.fn(
      ({ paymaster }: { paymaster: { carries: string } }) => ({ id: "sponsored", paymaster }),
    );
    const kernel = { chain: fluentTestnet, zeroDevRpcUrl: "https://rpc.zerodev.example" };

    const client = buildSponsoredClient({
      kernel,
      bearerToken: FLUENT_TOKEN,
      sponsorshipUrl: SPONSORSHIP_URL,
      appId: APP_ID,
      createPaymaster,
      createClient,
    });

    expect(createPaymaster).toHaveBeenCalledWith({
      chain: fluentTestnet,
      rpcUrl: PAYMASTER_URL,
      bearerToken: FLUENT_TOKEN,
    });
    expect(createClient).toHaveBeenCalledWith({
      kernel,
      paymaster: { carries: FLUENT_TOKEN },
    });
    expect(client).toEqual({ id: "sponsored", paymaster: { carries: FLUENT_TOKEN } });
  });

  it("sends the Fluent token to /paymaster/{app_id} as the Authorization bearer", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const paymaster = buildSponsoredClient({
        kernel: { chain: fluentTestnet },
        bearerToken: FLUENT_TOKEN,
        sponsorshipUrl: SPONSORSHIP_URL,
        appId: APP_ID,
        createPaymaster: createFluentZeroDevSponsoredPaymaster,
        createClient: ({ paymaster: built }) => built,
      });

      // The answer above is not a real sponsorship result; only the request is under test.
      await paymaster.getPaymasterData({ chainId: fluentTestnet.id } as never).catch(
        () => undefined,
      );

      expect(fetchSpy).toHaveBeenCalled();
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(PAYMASTER_URL);
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${FLUENT_TOKEN}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * One scripted operation: the bearers `resolveBearer` answers with in order, and the answers
 * `sendSponsored` gives in order — a hash for a submission that went through, an error for one
 * the paymaster refused.
 */
function harness(script: { bearers: SponsorshipBearer[]; sponsored: Array<Hash | Error> }) {
  const bearers = [...script.bearers];
  const sponsored = [...script.sponsored];
  const log = makeLog();
  const ownGasClient: FakeClient = { id: "own-gas" };
  const resolveBearer = vi.fn(async (): Promise<SponsorshipBearer> => {
    const next = bearers.shift();
    if (!next) throw new Error("resolveBearer was called more often than the script allows");
    return next;
  });
  const buildClient = vi.fn(
    (bearerToken: string): FakeClient => ({ id: `sponsored:${bearerToken}` }),
  );
  // Takes the client so the test can read which one each attempt was made with.
  const sendSponsored = vi.fn(async (_client: FakeClient): Promise<Hash> => {
    const next = sponsored.shift();
    if (next === undefined) {
      throw new Error("sendSponsored was called more often than the script allows");
    }
    if (next instanceof Error) throw next;
    return next;
  });
  const sendOwnGas = vi.fn(async (): Promise<Hash> => OWN_GAS_HASH);
  const waitFor = vi.fn(
    async (args: { client: FakeClient; userOpHash: Hash }): Promise<FakeReceipt> => ({
      settledBy: args.client.id,
      userOpHash: args.userOpHash,
    }),
  );
  const disableSponsorship = vi.fn();

  return {
    log,
    ownGasClient,
    resolveBearer,
    buildClient,
    sendSponsored,
    sendOwnGas,
    waitFor,
    disableSponsorship,
    run: () =>
      sendWithSponsorship<FakeClient, FakeReceipt>({
        resolveBearer,
        buildClient,
        sendSponsored,
        sendOwnGas,
        ownGasClient,
        waitFor,
        disableSponsorship,
        log,
      }),
  };
}

describe("sendWithSponsorship", () => {
  it("sponsors the operation with the token it resolved, and warns not at all", async () => {
    const h = harness({ bearers: [{ token: FLUENT_TOKEN }], sponsored: [SPONSORED_HASH] });

    const outcome = await h.run();

    expect(h.resolveBearer).toHaveBeenCalledWith({ fresh: false });
    expect(h.buildClient).toHaveBeenCalledWith(FLUENT_TOKEN);
    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.sendOwnGas).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      userOpHash: SPONSORED_HASH,
      receipt: { settledBy: `sponsored:${FLUENT_TOKEN}`, userOpHash: SPONSORED_HASH },
      settlementClient: { id: `sponsored:${FLUENT_TOKEN}` },
      sponsored: true,
      sponsorshipReason: undefined,
    });
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("pays own gas with reason no_token when no token could be resolved, building no client", async () => {
    const h = harness({ bearers: [{ token: null, reason: "no_token" }], sponsored: [] });

    const outcome = await h.run();

    expect(h.buildClient).not.toHaveBeenCalled();
    expect(h.sendSponsored).not.toHaveBeenCalled();
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsored).toBe(false);
    expect(outcome.sponsorshipReason).toBe("no_token");
    expect(outcome.settlementClient).toBe(h.ownGasClient);
    expect(outcome.receipt).toEqual({ settledBy: "own-gas", userOpHash: OWN_GAS_HASH });
    // The one warning about a missing token belongs to `resolveSponsorshipBearer`.
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("answers a first 401 with one fresh token, one rebuild and one retry", async () => {
    const h = harness({
      bearers: [{ token: FLUENT_TOKEN }, { token: FRESH_TOKEN }],
      sponsored: [paymasterHttpError(401), RETRY_HASH],
    });

    const outcome = await h.run();

    expect(h.resolveBearer.mock.calls).toEqual([[{ fresh: false }], [{ fresh: true }]]);
    expect(h.buildClient.mock.calls).toEqual([[FLUENT_TOKEN], [FRESH_TOKEN]]);
    expect(h.sendSponsored).toHaveBeenCalledTimes(2);
    expect(h.sendSponsored.mock.calls[1]?.[0]).toEqual({ id: `sponsored:${FRESH_TOKEN}` });
    expect(h.sendOwnGas).not.toHaveBeenCalled();
    expect(h.disableSponsorship).not.toHaveBeenCalled();
    // Settled through the client that submitted the retry, not the one whose token was rejected.
    expect(h.waitFor).toHaveBeenCalledTimes(1);
    expect(h.waitFor).toHaveBeenCalledWith({
      client: { id: `sponsored:${FRESH_TOKEN}` },
      userOpHash: RETRY_HASH,
    });
    expect(outcome.userOpHash).toBe(RETRY_HASH);
    expect(outcome.settlementClient).toEqual({ id: `sponsored:${FRESH_TOKEN}` });
    expect(outcome.sponsored).toBe(true);
    expect(outcome.sponsorshipReason).toBeUndefined();
    // A recoverable 401 was never "paying own gas": no warning before the refresh or after it.
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("falls back once after a second 401, with reason unauthorized and no latch", async () => {
    const h = harness({
      bearers: [{ token: FLUENT_TOKEN }, { token: FRESH_TOKEN }],
      sponsored: [paymasterHttpError(401), paymasterHttpError(401)],
    });

    const outcome = await h.run();

    expect(h.sendSponsored).toHaveBeenCalledTimes(2);
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(h.disableSponsorship).not.toHaveBeenCalled();
    expect(outcome.sponsored).toBe(false);
    expect(outcome.sponsorshipReason).toBe("unauthorized");
    expect(outcome.settlementClient).toBe(h.ownGasClient);
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.any(String), { reason: "unauthorized" });
  });

  it("latches sponsorship off on a 403 and retries nothing", async () => {
    const h = harness({ bearers: [{ token: FLUENT_TOKEN }], sponsored: [paymasterHttpError(403)] });

    const outcome = await h.run();

    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.resolveBearer).toHaveBeenCalledTimes(1);
    expect(h.disableSponsorship).toHaveBeenCalledTimes(1);
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsorshipReason).toBe("unauthorized");
    expect(outcome.sponsored).toBe(false);
    expect(h.log.warn).toHaveBeenCalledTimes(1);
  });

  it("latches sponsorship off on a 403 answering the retry, and attempts nothing further", async () => {
    const h = harness({
      bearers: [{ token: FLUENT_TOKEN }, { token: FRESH_TOKEN }],
      sponsored: [paymasterHttpError(401), paymasterHttpError(403)],
    });

    const outcome = await h.run();

    expect(h.sendSponsored).toHaveBeenCalledTimes(2);
    expect(h.disableSponsorship).toHaveBeenCalledTimes(1);
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsorshipReason).toBe("unauthorized");
    expect(h.log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for a 502: the bearer was never the problem", async () => {
    const h = harness({ bearers: [{ token: FLUENT_TOKEN }], sponsored: [paymasterHttpError(502)] });

    const outcome = await h.run();

    expect(h.resolveBearer).toHaveBeenCalledTimes(1);
    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.disableSponsorship).not.toHaveBeenCalled();
    expect(outcome.sponsorshipReason).toBe("unreachable");
    expect(h.log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for a policy denial", async () => {
    const h = harness({
      bearers: [{ token: FLUENT_TOKEN }],
      sponsored: [new Error("rule refused the operation")],
    });

    const outcome = await h.run();

    expect(h.resolveBearer).toHaveBeenCalledTimes(1);
    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.disableSponsorship).not.toHaveBeenCalled();
    expect(outcome.sponsorshipReason).toBe("denied");
  });

  it("lets a failure waiting for the receipt through: that one is not the paymaster's", async () => {
    const h = harness({ bearers: [{ token: FLUENT_TOKEN }], sponsored: [SPONSORED_HASH] });
    h.waitFor.mockRejectedValueOnce(paymasterHttpError(401));

    await expect(h.run()).rejects.toThrow();
    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.sendOwnGas).not.toHaveBeenCalled();
  });
});

/**
 * The resolver and the orchestrator over one `log`, which is how the widget wires them: the
 * whole path from "which account is connected" to "what the paymaster was sent", with the
 * warning budget countable across both.
 */
describe("the sponsored-client path, end to end", () => {
  function compose(params: {
    accountType: "smart" | "eoa" | undefined;
    getAuthToken: (options?: { fresh?: boolean }) => Promise<string>;
    sendSponsored: () => Promise<Hash>;
    createPaymaster?: typeof createFluentZeroDevSponsoredPaymaster;
  }) {
    const log = makeLog();
    const ownGasClient: FakeClient = { id: "own-gas" };
    const createPaymaster = vi.fn<
      (args: { chain: Chain; rpcUrl: string; bearerToken: string }) => unknown
    >(params.createPaymaster ?? ((args) => ({ fake: true, args })));
    const sendSponsored = vi.fn(params.sendSponsored);
    const sendOwnGas = vi.fn(async (): Promise<Hash> => OWN_GAS_HASH);
    const disableSponsorship = vi.fn();

    return {
      log,
      ownGasClient,
      createPaymaster,
      sendSponsored,
      sendOwnGas,
      disableSponsorship,
      run: () =>
        sendWithSponsorship<FakeClient, FakeReceipt>({
          resolveBearer: ({ fresh }) =>
            resolveSponsorshipBearer({
              accountType: params.accountType,
              getAuthToken: params.getAuthToken,
              fresh,
              log,
            }),
          buildClient: (bearerToken) =>
            buildSponsoredClient({
              kernel: { chain: fluentTestnet },
              bearerToken,
              sponsorshipUrl: SPONSORSHIP_URL,
              appId: APP_ID,
              createPaymaster,
              createClient: () => ({ id: `sponsored:${bearerToken}` }),
            }),
          sendSponsored,
          sendOwnGas,
          ownGasClient,
          waitFor: async ({ client, userOpHash }) => ({ settledBy: client.id, userOpHash }),
          disableSponsorship,
          log,
        }),
    };
  }

  it("authenticates the paymaster with the Fluent token, never with a Privy access token", async () => {
    // Fails the test if the sponsored-client path reaches for Privy at all.
    const getAccessToken = vi.fn(async () => {
      throw new Error("the sponsored-client path must not consult Privy's getAccessToken");
    });
    const getAuthToken = vi.fn(async () => FLUENT_TOKEN);
    const h = compose({
      accountType: "smart",
      getAuthToken,
      sendSponsored: async () => SPONSORED_HASH,
      createPaymaster: createFluentZeroDevSponsoredPaymaster,
    });

    const outcome = await h.run();

    expect(h.createPaymaster).toHaveBeenCalledWith({
      chain: fluentTestnet,
      rpcUrl: PAYMASTER_URL,
      bearerToken: FLUENT_TOKEN,
    });
    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(outcome.sponsored).toBe(true);
    expect(outcome.sponsorshipReason).toBeUndefined();
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("exchanges no token for an external wallet, and sponsors nothing", async () => {
    const getAuthToken = vi.fn(async () => FLUENT_TOKEN);
    const h = compose({
      accountType: "eoa",
      getAuthToken,
      sendSponsored: async () => SPONSORED_HASH,
    });

    const outcome = await h.run();

    expect(getAuthToken).not.toHaveBeenCalled();
    expect(h.createPaymaster).not.toHaveBeenCalled();
    expect(h.sendSponsored).not.toHaveBeenCalled();
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsored).toBe(false);
    expect(outcome.sponsorshipReason).toBe("no_token");
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("leaves a hosted Fluent ID paying its own gas, on one warning and no throw", async () => {
    const getAuthToken = vi.fn(async () => {
      throw new FluentAuthError("hosted_not_supported", 'needs authMode: "direct"');
    });
    const h = compose({
      accountType: "smart",
      getAuthToken,
      sendSponsored: async () => SPONSORED_HASH,
    });

    const outcome = await h.run();

    expect(h.sendSponsored).not.toHaveBeenCalled();
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsored).toBe(false);
    expect(outcome.sponsorshipReason).toBe("no_token");
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.any(String), { code: "hosted_not_supported" });
  });

  it("spends exactly one warning when a 401's forced refresh then fails", async () => {
    const getAuthToken = vi.fn(async (options?: { fresh?: boolean }) => {
      if (options?.fresh) throw new FluentAuthError("rate_limited", "slow down");
      return FLUENT_TOKEN;
    });
    const h = compose({
      accountType: "smart",
      getAuthToken,
      sendSponsored: async () => {
        throw paymasterHttpError(401);
      },
    });

    const outcome = await h.run();

    expect(getAuthToken.mock.calls).toEqual([[{ fresh: false }], [{ fresh: true }]]);
    // Token resolution returned nothing, so there was no second client to try.
    expect(h.sendSponsored).toHaveBeenCalledTimes(1);
    expect(h.sendOwnGas).toHaveBeenCalledTimes(1);
    expect(outcome.sponsored).toBe(false);
    expect(outcome.sponsorshipReason).toBe("no_token");
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.any(String), { code: "rate_limited" });
  });

  it("recovers a 401 with a fresh Fluent token and stays silent", async () => {
    const getAuthToken = vi.fn(async (options?: { fresh?: boolean }) =>
      options?.fresh ? FRESH_TOKEN : FLUENT_TOKEN,
    );
    const hashes = [paymasterHttpError(401), RETRY_HASH];
    const h = compose({
      accountType: "smart",
      getAuthToken,
      sendSponsored: async () => {
        const next = hashes.shift();
        if (next instanceof Error) throw next;
        return next as Hash;
      },
      createPaymaster: createFluentZeroDevSponsoredPaymaster,
    });

    const outcome = await h.run();

    expect(h.createPaymaster.mock.calls.map((call) => call[0].bearerToken)).toEqual([
      FLUENT_TOKEN,
      FRESH_TOKEN,
    ]);
    expect(outcome.sponsored).toBe(true);
    expect(outcome.settlementClient).toEqual({ id: `sponsored:${FRESH_TOKEN}` });
    expect(h.log.warn).not.toHaveBeenCalled();
  });
});
