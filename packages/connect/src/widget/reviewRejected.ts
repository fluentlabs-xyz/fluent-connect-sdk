/**
 * The user dismissed a review (transaction or signature) instead of confirming it.
 * A class, not a message, so callers that translate errors for another party — the
 * iframe bridge maps it to EIP-1193 `4001` — can recognise it without parsing prose.
 */
export class FluentReviewRejectedError extends Error {
  constructor(readonly review: "transaction" | "signature") {
    super(`User rejected Fluent ${review} review`);
    this.name = "FluentReviewRejectedError";
  }
}
