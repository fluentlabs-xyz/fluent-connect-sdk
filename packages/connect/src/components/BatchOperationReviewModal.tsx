import { Button } from "./ui/button";
import { formatAddress } from "../utils/formatAddress";
import type { FluentBatchOperationReview } from "../widget/batchOperation";

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
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#030213]/70 p-6 backdrop-blur-md"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="w-full max-w-[520px] rounded-[18px] border border-[#49eded]/30 bg-[#030213] p-[18px] text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Fluent transaction"
      >
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black uppercase text-[#49eded]">
              Fluent transaction review
            </span>
            <h2 className="mt-1 text-2xl leading-[30px] font-medium">
              {operation.reviewTitle ?? "Confirm transaction"}
            </h2>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Close"
            onClick={onCancel}
          >
            x
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3">
          <span className="text-xs text-white/65">Signing account</span>
          <strong className="text-sm">
            {operation.account?.address ? formatAddress(operation.account.address) : "Fluent account"}
          </strong>
        </div>
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
        <p className="text-xs leading-[18px] text-white/65">
          Confirming allows the Fluent embedded signer to sign this ZeroDev UserOperation.
        </p>
        <div className="mt-3 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2.5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Confirm and sign
          </Button>
        </div>
      </section>
    </div>
  );
}
