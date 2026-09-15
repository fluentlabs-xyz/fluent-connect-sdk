import { formatAddress } from "../utils";
import type { FluentBatchOperationReview } from "../widget/batchOperation";
import { ReviewDialog } from "./ReviewDialog";

export function BatchOperationReviewModal({
  operation,
  onConfirm,
  onCancel,
}: {
  operation: FluentBatchOperationReview | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!operation) return null;

  return (
    <ReviewDialog
      eyebrow="Fluent transaction review"
      title={operation.reviewTitle ?? "Confirm transaction"}
      ariaLabel="Confirm Fluent transaction"
      address={operation.account?.address}
      footnote="Confirming allows the Fluent embedded signer to sign this ZeroDev UserOperation."
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="my-3 flex list-none flex-col gap-2 p-0" aria-label="Transaction calls">
        {operation.encodedCalls.map((call, index) => (
          <li
            className="flex flex-col gap-1 rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3"
            key={call.id ?? `${call.to}-${index}`}
          >
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm">
                {call.label ?? operation.calls[index]?.method ??
                  operation.calls[index]?.functionName ?? "Contract call"}
              </strong>
              <span className="text-xs text-white/65">{formatAddress(call.to)}</span>
            </div>
            {call.value > 0n ? (
              <small className="text-xs text-white/65">Value {call.value.toString()} wei</small>
            ) : null}
          </li>
        ))}
      </ul>
    </ReviewDialog>
  );
}
