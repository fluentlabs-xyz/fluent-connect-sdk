/** Which Review the person dismissed: a Batch operation's or a signature's. */
export type FluentReviewRejectedErrorCode =
  | "transaction_review_rejected"
  | "signature_review_rejected";

/**
 * The person dismissed a Review (transaction or signature) instead of confirming it.
 *
 * A class with a `code`, not a message, so a host branches on `code` and callers that translate
 * errors for another party — the iframe bridge maps it to EIP-1193 `4001` — recognise it
 * without parsing prose.
 *
 * @example
 * ```ts
 * try {
 *   await widget.createBatchOp({ calls }).execute();
 * } catch (error) {
 *   if (error instanceof FluentReviewRejectedError) return; // the person said no
 *   throw error;
 * }
 * ```
 */
export class FluentReviewRejectedError extends Error {
  readonly code: FluentReviewRejectedErrorCode;

  constructor(readonly review: "transaction" | "signature") {
    super(`User rejected Fluent ${review} review`);
    this.name = "FluentReviewRejectedError";
    this.code =
      review === "transaction" ? "transaction_review_rejected" : "signature_review_rejected";
  }
}
