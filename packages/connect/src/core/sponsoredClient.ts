import type { Chain, Hash } from "viem";

import { FluentAuthError, type FluentAuthErrorCode } from "./authToken";
import { createFluentSponsorshipRpcUrl } from "./zerodevPaymaster";
import {
  FluentSponsorshipFallbackError,
  getSponsorshipFailure,
  type FluentSponsorshipFailure,
  type FluentSponsorshipReason,
} from "./sponsorshipFailure";

/**
 * The sponsored-paymaster decision, kept apart from the React hook.
 *
 * Three seams, each taking its dependencies as arguments so a test can watch the whole path
 * without a kernel, a browser or a network:
 *
 * - `resolveSponsorshipBearer` decides whether this account gets an Auth token, and never throws.
 * - `buildSponsoredClient` hands that token to the paymaster factory as the request's bearer.
 * - `sendWithSponsorship` owns the `401` refresh-and-retry, the `403` latch, the own-gas
 *   fallback and the one-warning-per-operation budget.
 *
 * The bearer on `/paymaster/{app_id}` is the Auth token that `getAuthToken()` mints, not a Privy
 * access token: the service binds the token's `aud` to the App and the user operation's
 * `sender` to an address the user proved, and neither binding applies to a Privy token.
 */

/**
 * Which kind of account is asking, `FluentAccountType | undefined`. Spelled out rather than
 * imported from `widget/batchOperation` so `core/` keeps depending only on `core/`; a call site
 * passing the widget's own type still type-checks, and would stop doing so if that type grew a
 * member sponsorship has not decided about.
 */
export type SponsorshipAccount = "smart" | "eoa" | undefined;

/** How a sponsored operation asks for its Auth token. `fresh` discards a rejected one first. */
export type SponsorshipTokenRequest = (options?: { fresh?: boolean }) => Promise<string>;

/**
 * Either an Auth token to authenticate with, or none and the reason to report. `no_token` is
 * the only reason this resolves to: everything the paymaster itself says about an operation
 * comes back through `getSponsorshipFailure`, after a request was actually made.
 */
export type SponsorshipBearer =
  | { token: string }
  | { token: null; reason: Extract<FluentSponsorshipReason, "no_token"> };

/**
 * The widget's gated console, injected so a test can count the lines. `warn` is budgeted: an
 * unsponsored operation costs at most one warning, whoever emits it.
 */
export type SponsorshipLog = {
  debug: (message: string, detail: Record<string, unknown>) => void;
  warn: (message: string, detail: Record<string, unknown>) => void;
};

/**
 * Returns the Auth token this operation authenticates to the paymaster with, or none with the
 * reason `no_token`.
 *
 * Never throws: a missing token means the account pays its own gas, which is an outcome of the
 * send and not a failure of it. Each way to have no token warns at most once, so the caller's
 * fallback adds no second line:
 *
 * - an External wallet (`"eoa"`), an account the widget has not derived yet, or no
 *   `getAuthToken` is not sponsored at all, and is silent: nothing failed. An External wallet
 *   sends through the wallet rather than through the kernel, so asking for a token would spend
 *   a wallet signature on a bearer nothing would use.
 * - a rejection of `getAuthToken`, a `FluentAuthError` or a network error: one warning carrying
 *   the error's `code` (`"unknown"` for anything else) and nothing more. The next operation asks
 *   again; a failed exchange latches nothing.
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
 * Returns the sponsored kernel client for one attempt: the App travels in the paymaster path,
 * the user's Auth token in the `Authorization` header. Both factories are arguments, so a test
 * reads the bearer that reaches the paymaster without building a kernel.
 */
export function buildSponsoredClient<
  TKernel extends { chain: Chain },
  TPaymaster,
  TClient,
>(params: {
  kernel: TKernel;
  /** The Auth token from `resolveSponsorshipBearer`. */
  bearerToken: string;
  sponsorshipUrl: string;
  appId: string;
  createPaymaster: (args: { chain: Chain; rpcUrl: string; bearerToken: string }) => TPaymaster;
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
 * Submits one user operation, sponsored when it can be and paid for by the account when it
 * cannot, and waits for its receipt.
 *
 * The paymaster is resolved during `prepareUserOperation`, before the account is asked to sign,
 * so a second attempt costs a round trip and not a second prompt. That is what makes the `401`
 * path worth taking: the paymaster rejected this bearer, so mint one fresh Auth token, rebuild
 * the client around it and send once more. Exactly one refresh and one retry, no loop.
 *
 * `403` is the only durable answer: it says the App is not sponsored here, so it calls
 * `disableSponsorship` and the widget stops paying failed round trips. A policy denial, a `502`
 * and a `401` all leave sponsorship on for the next operation.
 *
 * Warning budget: an operation that ends up sponsored warns not at all, including one that got
 * there through the retry: it was never "paying own gas". An operation that falls back warns at
 * most once, either here or already inside `resolveSponsorshipBearer`.
 *
 * Only the submission is guarded. A failure while waiting for the receipt is the operation's
 * failure, not the paymaster's, and propagates. So does a submission failure `isOperationFailure`
 * claims.
 */
export async function sendWithSponsorship<TClient, TReceipt>(params: {
  resolveBearer: (options: { fresh: boolean }) => Promise<SponsorshipBearer>;
  buildClient: (bearerToken: string) => TClient;
  sendSponsored: (client: TClient) => Promise<Hash>;
  sendOwnGas: () => Promise<Hash>;
  /**
   * Which submission failures are the operation's rather than the paymaster's and must reach
   * the caller unchanged.
   *
   * A bundler that rejects the operation's `maxFeePerGas` rejects it whoever pays, and
   * `sendSponsored` has already answered that one itself with a second quote. Without this,
   * such an error would be classified as a policy denial and answered with an own-gas
   * submission — a third operation for a fee the account cannot fix, and a
   * `FluentSponsorshipFallbackError` in place of the bundler's own sentence.
   *
   * Omitted, every submission failure is read as the paymaster's.
   */
  isOperationFailure?: (err: unknown) => boolean;
  /** The kernel's own client: it pays the gas on the fallback, and settles that operation. */
  ownGasClient: TClient;
  waitFor: (args: { client: TClient; userOpHash: Hash }) => Promise<TReceipt>;
  /** Called on a `403`, so the widget stops asking for Sponsorship for the rest of its life. */
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
    isOperationFailure,
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

  const payOwnGas = async (
    reason: FluentSponsorshipReason,
    sponsoredAttempt?: { error: unknown },
  ) => {
    let userOpHash: Hash;
    try {
      userOpHash = await sendOwnGas();
    } catch (fallbackError) {
      if (!sponsoredAttempt) throw fallbackError;
      throw new FluentSponsorshipFallbackError({
        sponsorshipReason: reason,
        sponsorshipError: sponsoredAttempt.error,
        fallbackError,
      });
    }
    // Receipt failures describe an operation that was already submitted; they
    // must propagate without being attributed to the earlier sponsorship failure.
    return settle(ownGasClient, userOpHash, false, reason);
  };

  /**
   * One sponsored submission. Only the submission is inside the `try`: that is the call the
   * paymaster answers, and so the only one whose failure means "not sponsored" — unless
   * `isOperationFailure` says this failure was the operation's, which propagates.
   */
  const submit = async (
    client: TClient,
  ): Promise<
    | { ok: true; userOpHash: Hash }
    | { ok: false; failure: FluentSponsorshipFailure; error: unknown }
  > => {
    try {
      return { ok: true, userOpHash: await sendSponsored(client) };
    } catch (err) {
      if (isOperationFailure?.(err)) throw err;
      const failure = getSponsorshipFailure(err);
      if (failure.disableSponsorship) disableSponsorship();
      return { ok: false, failure, error: err };
    }
  };

  const bearer = await resolveBearer({ fresh: false });
  // No warning here: whatever there was to say about a missing token, `resolveSponsorshipBearer`
  // has already said once.
  if (bearer.token === null) return payOwnGas(bearer.reason);

  const sponsoredClient = buildClient(bearer.token);
  const first = await submit(sponsoredClient);
  if (first.ok) return settle(sponsoredClient, first.userOpHash, true, undefined);
  let failedAttempt = first;

  if (isRejectedBearer(failedAttempt.failure)) {
    const refreshed = await resolveBearer({ fresh: true });
    // The forced exchange failed, and warned. This operation's one warning is spent.
    if (refreshed.token === null) return payOwnGas(refreshed.reason, failedAttempt);
    const retryClient = buildClient(refreshed.token);
    const retry = await submit(retryClient);
    if (retry.ok) return settle(retryClient, retry.userOpHash, true, undefined);
    failedAttempt = retry;
  }

  const { reason } = failedAttempt.failure;
  log.warn("[fluent zerodev] sponsorship unavailable, paying own gas", { reason });
  return payOwnGas(reason, failedAttempt);
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
