import type { FluentSignatureReview } from "../signRequest";
import { useReviewPrompt } from "./useReviewPrompt";

/** Returns the Review of a signature as a promise; see `useReviewPrompt`. */
export function useSignatureReview(options?: { onOpen?: () => void }) {
  const { review, request, accept, reject } = useReviewPrompt<FluentSignatureReview>({
    label: "signature",
    onOpen: options?.onOpen,
  });
  return {
    signatureReview: review,
    confirmSignature: request,
    acceptSignatureReview: accept,
    rejectSignatureReview: reject,
  };
}
