import type { FluentBatchOperationReview } from "../batchOperation";
import { useReviewPrompt } from "./useReviewPrompt";

/** The transaction-review modal as a promise; see `useReviewPrompt`. */
export function useBatchReview(options?: { onOpen?: () => void }) {
  const { review, request, accept, reject } = useReviewPrompt<FluentBatchOperationReview>({
    label: "transaction",
    onOpen: options?.onOpen,
  });
  return {
    batchReview: review,
    confirmBatchOperation: request,
    acceptBatchReview: accept,
    rejectBatchReview: reject,
  };
}
