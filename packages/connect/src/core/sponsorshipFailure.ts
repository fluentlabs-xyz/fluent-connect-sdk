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
   * something durable about the *partner* ("not sponsored here"). A 401 says the bearer was
   * not accepted, which an expired or mid-refresh Privy access token produces just as well —
   * latching on it would leave a long-lived tab paying its own gas after the token silently
   * refreshes.
   */
  disableSponsorship: boolean;
};

/**
 * A policy denial arrives as an RPC error; the proxy's own 401/403/502 arrive as HTTP
 * errors. Same fallback, different reason.
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
