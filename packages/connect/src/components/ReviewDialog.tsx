import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { formatAddress } from "../utils";

/**
 * The frame every Fluent review shares — transaction or signature: a blocking backdrop,
 * the eyebrow and title, the signing account, the review body, a footnote and the
 * cancel / confirm pair. Dismissing the backdrop counts as cancel.
 */
export function ReviewDialog({
  eyebrow,
  title,
  ariaLabel,
  address,
  footnote,
  onConfirm,
  onCancel,
  children,
}: {
  eyebrow: string;
  title: string;
  ariaLabel: string;
  address?: string;
  footnote: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
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
        aria-label={ariaLabel}
      >
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black uppercase text-[#49eded]">{eyebrow}</span>
            <h2 className="mt-1 text-2xl leading-[30px] font-medium">{title}</h2>
          </div>
          <Button type="button" variant="secondary" size="icon" aria-label="Close" onClick={onCancel}>
            x
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3">
          <span className="text-xs text-white/65">Signing account</span>
          <strong className="text-sm">{address ? formatAddress(address) : "Fluent account"}</strong>
        </div>
        {children}
        <p className="text-xs leading-[18px] text-white/65">{footnote}</p>
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
