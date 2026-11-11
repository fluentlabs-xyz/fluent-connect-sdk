import { useCallback, useEffect, useRef, useState } from "react";

import { FluentReviewRejectedError } from "../reviewRejected";

/**
 * Turns the widget's Review into a promise: an execution calls `request(review)` and awaits it,
 * and the Review's accept or reject settles it. A newer Review rejects any pending one, and
 * unmounting rejects one still open, so an awaiting caller is not left pending. `label` names the
 * Review in the rejection errors ("transaction", "signature").
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
    resolution.current?.reject(new FluentReviewRejectedError(label));
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
