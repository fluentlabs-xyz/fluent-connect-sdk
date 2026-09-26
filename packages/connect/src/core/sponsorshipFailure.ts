import { BaseError, HttpRequestError } from "viem";

/** Why an operation was not sponsored, when sponsorship was configured for it. */
/**
 * Why an operation was not sponsored. `not_requested` is the only one that is not a failure:
 * the caller asked to pay its own gas, so the sponsorship paymaster was never contacted.
 */
export type FluentSponsorshipReason =
  | "no_token"
  | "denied"
  | "unauthorized"
  | "unreachable"
  | "not_requested";

export type FluentSponsorshipFailure = {
  reason: FluentSponsorshipReason;
  /**
   * Whether the widget should stop trying for the rest of its life. Only a 403 says
   * something durable about the *App* ("not sponsored here"). A 401 says only that this
   * bearer was not accepted, and the bearer is the short-lived Fluent token from
   * `getAuthToken()`: the caller answers it by forcing one fresh token and retrying the
   * operation once (`sendWithSponsorship`). Latching on a 401 would leave a long-lived tab
   * paying its own gas over a token that the next exchange replaces.
   */
  disableSponsorship: boolean;
};

/**
 * A policy denial arrives as an RPC error; the proxy's own 401/403/502 arrive as HTTP
 * errors. Same fallback, different reason. 401 and 403 share the reason and are told apart by
 * `disableSponsorship`, which is also what marks the 401 as the one failure a fresh Fluent
 * token can fix.
 */
export function getSponsorshipFailure(err: unknown): FluentSponsorshipFailure {
  const httpError =
    err instanceof BaseError
      ? (err.walk((e) => e instanceof HttpRequestError) as HttpRequestError | null)
      : null;
  if (!httpError) return { reason: "denied", disableSponsorship: false };
  if (httpError.status === 403) return { reason: "unauthorized", disableSponsorship: true };
  if (httpError.status === 401) return { reason: "unauthorized", disableSponsorship: false };
  return { reason: "unreachable", disableSponsorship: false };
}
