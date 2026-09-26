import type { Chain, Hash } from "viem";

import { FluentAuthError, type FluentAuthErrorCode } from "./authToken";
import { createFluentSponsorshipRpcUrl } from "./zerodevPaymaster";
import {
  getSponsorshipFailure,
  type FluentSponsorshipFailure,
  type FluentSponsorshipReason,
} from "./sponsorshipFailure";

/**
 * The sponsored-paymaster decision, out of the React hook that used to hold it.
 *
 * Three seams, each taking its dependencies as arguments so a test can watch the whole path
 * without a kernel, a browser or a network:
 *
 * - `resolveSponsorshipBearer` decides whether this account gets a Fluent token, and never throws.
 * - `buildSponsoredClient` hands that token to the paymaster factory as the request's bearer.
 * - `sendWithSponsorship` owns the `401` refresh-and-retry, the `403` latch, the own-gas
 *   fallback and the one-warning-per-operation budget.
 *
 * The bearer on `/paymaster/{app_id}` is the Fluent token that `getAuthToken()` mints, never a
 * Privy access token: the service binds the token's `aud` to the App and the UserOp `sender` to
 * an address the user proved, and neither binding applies to a Privy token.
 */

/**
 * Which kind of account is asking, `FluentAccountType | undefined`. Spelled out rather than
 * imported from `widget/batchOperation` so `core/` keeps depending only on `core/`; a call site
 * passing the widget's own type still type-checks, and would stop doing so if that type grew a
 * member sponsorship has not decided about.
 */
export type SponsorshipAccount = "smart" | "eoa" | undefined;

/** How a sponsored operation asks for its Fluent token. `fresh` discards a rejected one first. */
export type SponsorshipTokenRequest = (options?: { fresh?: boolean }) => Promise<string>;

/**
 * Either a Fluent token to authenticate with, or none and the reason to report. `no_token` is
 * the only reason this resolves to: everything the paymaster itself says about an operation
 * comes back through `getSponsorshipFailure`, after a request was actually made.
 */
export type SponsorshipBearer =
  | { token: string }
  | { token: null; reason: Extract<FluentSponsorshipReason, "no_token"> };

/**
 * The widget's gated console, injected so a test can count the lines. `warn` is budgeted: one
 * unsponsored operation costs exactly one warning, whoever emits it.
 */
export type SponsorshipLog = {
  debug: (message: string, detail: Record<string, unknown>) => void;
  warn: (message: string, detail: Record<string, unknown>) => void;
};

/**
 * The Fluent token this operation authenticates to the paymaster with, or none.
 *
 * Never throws and never rethrows: a missing token means the account pays its own gas, which is
 * an outcome of the send and not a failure of it. Each of the three ways to have no token warns
 * at most once, so the caller's fallback adds no second line:
 *
 * - an external wallet (`"eoa"`), or an account the widget has not derived yet, is not sponsored
 *   at all — it sends through the wallet rather than through the kernel, so asking for a token
 *   would spend a wallet signature on a bearer nothing would use. Silent: nothing failed.
 * - a Fluent ID in hosted mode: `getAuthToken()` rejects with `hosted_not_supported`, because
 *   that Privy session lives on the authorize page. One warning.
 * - any other rejection — another `FluentAuthError`, a network error: one warning carrying the
 *   normalized error code and nothing else. The next operation asks again; a failed exchange
 *   latches nothing.
 */
export async function resolveSponsorshipBearer(params: {
  accountType: SponsorshipAccount;
  getAuthToken: SponsorshipTokenRequest | undefined;
  /** Force a new exchange, discarding the token the paymaster just rejected. */
  fresh?: boolean;
  log: SponsorshipLog;
}): Promise<SponsorshipBearer> {
  const { accountType, getAuthToken, fresh, log } = params;
  if (accountType !== "smart" || !getAuthToken) return { token: null, reason: "no_token" };
  try {
    return { token: await getAuthToken({ fresh: fresh === true }) };
  } catch (err) {
    log.warn("[fluent zerodev] no Fluent token for sponsorship, paying own gas", {
      code: sponsorshipTokenErrorCode(err),
    });
    return { token: null, reason: "no_token" };
  }
}

/**
 * The sponsored kernel client for one attempt: the App travels in the paymaster path, the user's
 * Fluent token in the `Authorization` header. Both factories are arguments, so a test reads the
 * bearer that reaches the paymaster without building a kernel.
 */
export function buildSponsoredClient<TKernel extends { chain: Chain }, TPaymaster, TClient>(params: {
  kernel: TKernel;
  /** The Fluent token from `resolveSponsorshipBearer`. */
  bearerToken: string;
  sponsorshipUrl: string;
  appId: string;
  createPaymaster: (args: {
    chain: Chain;
    rpcUrl: string;
    bearerToken: string;
  }) => TPaymaster;
  createClient: (args: { kernel: TKernel; paymaster: TPaymaster }) => TClient;
}): TClient {
  return params.createClient({
    kernel: params.kernel,
    paymaster: params.createPaymaster({
      chain: params.kernel.chain,
      rpcUrl: createFluentSponsorshipRpcUrl({
        sponsorshipUrl: params.sponsorshipUrl,
        appId: params.appId,
      }),
      bearerToken: params.bearerToken,
    }),
  });
}

export type SponsoredSendOutcome<TClient, TReceipt> = {
  userOpHash: Hash;
  receipt: TReceipt;
  /** The client that submitted the operation, and so the one that waited for its receipt. */
  settlementClient: TClient;
  /** Whether the operation was submitted through a sponsored client, before the receipt is read. */
  sponsored: boolean;
  sponsorshipReason: FluentSponsorshipReason | undefined;
};

/**
 * One user operation, sponsored when it can be and paid for by the account when it cannot.
 *
 * The paymaster is resolved during `prepareUserOperation`, before the account is asked to sign,
 * so a second attempt costs a round trip and not a second prompt. That is what makes the `401`
 * path worth taking: the paymaster rejected this bearer, so mint one fresh Fluent token, rebuild
 * the client around it and send once more. Exactly one refresh and one retry — no loop.
 *
 * `403` is the only durable answer: it says the App is not sponsored here, so it calls
 * `disableSponsorship` and the widget stops paying failed round trips. A policy denial, a `502`
 * and a `401` all leave sponsorship on for the next operation.
 *
 * Warning budget: an operation that ends up sponsored warns not at all, including one that got
 * there through the retry — it was never "paying own gas". An operation that falls back warns
 * exactly once, either here or already inside `resolveSponsorshipBearer`.
 *
 * Only the submission is guarded. A failure while waiting for the receipt is the operation's
 * failure, not the paymaster's, and propagates.
 */
export async function sendWithSponsorship<TClient, TReceipt>(params: {
  resolveBearer: (options: { fresh: boolean }) => Promise<SponsorshipBearer>;
  buildClient: (bearerToken: string) => TClient;
  sendSponsored: (client: TClient) => Promise<Hash>;
  sendOwnGas: () => Promise<Hash>;
  /** The kernel's own client: it pays the gas on the fallback, and settles that operation. */
  ownGasClient: TClient;
  waitFor: (args: { client: TClient; userOpHash: Hash }) => Promise<TReceipt>;
  /** Called on a `403`, so the widget stops offering sponsorship for the rest of its life. */
  disableSponsorship: () => void;
  log: SponsorshipLog;
}): Promise<SponsoredSendOutcome<TClient, TReceipt>> {
  const {
    resolveBearer,
    buildClient,
    sendSponsored,
    sendOwnGas,
    ownGasClient,
    waitFor,
    disableSponsorship,
    log,
  } = params;

  const settle = async (
    settlementClient: TClient,
    userOpHash: Hash,
    sponsored: boolean,
    sponsorshipReason: FluentSponsorshipReason | undefined,
  ): Promise<SponsoredSendOutcome<TClient, TReceipt>> => {
    log.debug("[fluent zerodev] sendCalls userOp submitted", { userOpHash, sponsored });
    return {
      userOpHash,
      receipt: await waitFor({ client: settlementClient, userOpHash }),
      settlementClient,
      sponsored,
      sponsorshipReason,
    };
  };

  const payOwnGas = async (reason: FluentSponsorshipReason) =>
    settle(ownGasClient, await sendOwnGas(), false, reason);

  /**
   * One sponsored submission. Only the submission is inside the `try`: that is the call the
   * paymaster answers, and so the only one whose failure means "not sponsored".
   */
  const submit = async (
    client: TClient,
  ): Promise<{ ok: true; userOpHash: Hash } | { ok: false; failure: FluentSponsorshipFailure }> => {
    try {
      return { ok: true, userOpHash: await sendSponsored(client) };
    } catch (err) {
      const failure = getSponsorshipFailure(err);
      if (failure.disableSponsorship) disableSponsorship();
      return { ok: false, failure };
    }
  };

  const bearer = await resolveBearer({ fresh: false });
  // No warning here: whatever there was to say about a missing token, `resolveSponsorshipBearer`
  // has already said once.
  if (bearer.token === null) return payOwnGas(bearer.reason);

  const sponsoredClient = buildClient(bearer.token);
  const first = await submit(sponsoredClient);
  if (first.ok) return settle(sponsoredClient, first.userOpHash, true, undefined);
  let failure = first.failure;

  if (isRejectedBearer(failure)) {
    const refreshed = await resolveBearer({ fresh: true });
    // The forced exchange failed, and warned. This operation's one warning is spent.
    if (refreshed.token === null) return payOwnGas(refreshed.reason);
    const retryClient = buildClient(refreshed.token);
    const retry = await submit(retryClient);
    if (retry.ok) return settle(retryClient, retry.userOpHash, true, undefined);
    failure = retry.failure;
  }

  log.warn("[fluent zerodev] sponsorship unavailable, paying own gas", { reason: failure.reason });
  return payOwnGas(failure.reason);
}

/**
 * A `401` and nothing else. `getSponsorshipFailure` gives `401` and `403` the same reason and
 * separates them by whether sponsorship latches off, so "unauthorized, but not durably" is the
 * paymaster saying it rejected this particular bearer — the one failure a fresh token fixes.
 */
function isRejectedBearer(failure: FluentSponsorshipFailure): boolean {
  return failure.reason === "unauthorized" && !failure.disableSponsorship;
}

/** What to log about a failed exchange: the code alone, never the error and never a token. */
function sponsorshipTokenErrorCode(err: unknown): FluentAuthErrorCode | "unknown" {
  return err instanceof FluentAuthError ? err.code : "unknown";
}
