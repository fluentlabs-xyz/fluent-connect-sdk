import { useCallback, useEffect, useRef, useState } from "react";

import type { FluentBatchOperationReview } from "../batchOperation";

/**
 * Bridges the imperative Fluent transaction-review modal to a promise: an
 * execution calls `confirmBatchOperation(review)` and awaits it; the modal's
 * accept/reject resolve or reject that promise. A newer review supersedes any
 * pending one, and unmounting rejects a still-open review so `execute()` never
 * hangs.
 */
export function useBatchReview(options?: { onOpen?: () => void }) {
  const [batchReview, setBatchReview] = useState<FluentBatchOperationReview | null>(null);
  const resolution = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const onOpen = options?.onOpen;

  const confirmBatchOperation = useCallback(
    (operation: FluentBatchOperationReview) => {
      onOpen?.();
      resolution.current?.reject(
        new Error("A newer Fluent transaction review replaced this request"),
      );
      setBatchReview(operation);
      return new Promise<void>((resolve, reject) => {
        resolution.current = { resolve, reject };
      });
    },
    [onOpen],
  );

  const acceptBatchReview = useCallback(() => {
    resolution.current?.resolve();
    resolution.current = null;
    setBatchReview(null);
  }, []);

  const rejectBatchReview = useCallback(() => {
    resolution.current?.reject(new Error("User rejected Fluent transaction review"));
    resolution.current = null;
    setBatchReview(null);
  }, []);

  useEffect(
    () => () => {
      resolution.current?.reject(new Error("Fluent transaction review was closed"));
      resolution.current = null;
    },
    [],
  );

  return { batchReview, confirmBatchOperation, acceptBatchReview, rejectBatchReview };
}
