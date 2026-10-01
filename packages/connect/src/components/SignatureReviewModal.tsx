import { bytesToHex, type SignableMessage } from "viem";

import { stringifyWithBigInt } from "../utils";
import type { FluentSignatureReview } from "../widget/signRequest";
import { ReviewDialog } from "./ReviewDialog";

/** Renders a signable message as text; raw bytes are shown as hex. */
function formatMessage(message: SignableMessage): string {
  if (typeof message === "string") return message;
  return typeof message.raw === "string" ? message.raw : bytesToHex(message.raw);
}

const ROW = "rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3";
const CODE = "max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs";

/**
 * The review every signature goes through: who is asking (the page origin), which account
 * signs, and exactly what — the message, or the EIP-712 domain, primary type and message.
 * Quick sign does not skip this modal.
 */
export function SignatureReviewModal({
  review,
  onConfirm,
  onCancel,
}: {
  review: FluentSignatureReview | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!review) return null;

  return (
    <ReviewDialog
      eyebrow="Fluent signature review"
      title={review.kind === "message" ? "Sign message" : "Sign typed data"}
      ariaLabel="Confirm Fluent signature"
      address={review.address}
      footnote={
        review.account.type === "smart"
          ? "Confirming signs this request with your Fluent ID. Nothing is sent on chain."
          : "Confirming opens your wallet's own signature prompt. Nothing is sent on chain."
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="my-3 flex flex-col gap-2">
        <div className={`flex items-center justify-between gap-3 ${ROW}`}>
          <span className="text-xs text-white/65">Requested by</span>
          <strong className="break-all text-sm">{review.origin}</strong>
        </div>
        {review.kind === "message" ? (
          <pre className={`${ROW} ${CODE}`} aria-label="Message">
            {formatMessage(review.message)}
          </pre>
        ) : (
          <>
            <div className={`flex flex-col gap-1 ${ROW}`}>
              <span className="text-xs text-white/65">Domain</span>
              <pre className={CODE}>{stringifyWithBigInt(review.typedData.domain ?? {}, 2)}</pre>
            </div>
            <div className={`flex items-center justify-between gap-3 ${ROW}`}>
              <span className="text-xs text-white/65">Primary type</span>
              <strong className="text-sm">{review.typedData.primaryType}</strong>
            </div>
            <pre className={`${ROW} ${CODE}`} aria-label="Message">
              {stringifyWithBigInt(review.typedData.message, 2)}
            </pre>
          </>
        )}
      </div>
    </ReviewDialog>
  );
}
