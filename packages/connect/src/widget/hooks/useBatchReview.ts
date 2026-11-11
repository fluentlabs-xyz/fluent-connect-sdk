import type { FluentBatchOperationReview } from "../batchOperation";
import { useReviewPrompt } from "./useReviewPrompt";

/** Returns the Review of a Batch operation as a promise; see `useReviewPrompt`. */
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
