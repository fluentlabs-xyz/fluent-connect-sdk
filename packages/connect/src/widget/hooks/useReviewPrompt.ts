import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bridges an imperative review modal to a promise: an execution calls
 * `request(review)` and awaits it; the modal's accept/reject resolve or reject
 * that promise. A newer review supersedes any pending one, and unmounting
 * rejects a still-open review so the caller never hangs. `label` names the
 * review in the rejection messages ("transaction", "signature").
 */
export function useReviewPrompt<Review>(options: {
  label: "transaction" | "signature";
  onOpen?: () => void;
}) {
  const { label, onOpen } = options;
  const [review, setReview] = useState<Review | null>(null);
  const resolution = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  const request = useCallback(
    (next: Review) => {
      onOpen?.();
      resolution.current?.reject(new Error(`A newer Fluent ${label} review replaced this request`));
      setReview(next);
      return new Promise<void>((resolve, reject) => {
        resolution.current = { resolve, reject };
      });
    },
    [label, onOpen],
  );

  const accept = useCallback(() => {
    resolution.current?.resolve();
    resolution.current = null;
    setReview(null);
  }, []);

  const reject = useCallback(() => {
    resolution.current?.reject(new Error(`User rejected Fluent ${label} review`));
    resolution.current = null;
    setReview(null);
  }, []);

  useEffect(
    () => () => {
      resolution.current?.reject(new Error(`Fluent ${label} review was closed`));
      resolution.current = null;
    },
    [label],
  );

  return { review, request, accept, reject };
}
