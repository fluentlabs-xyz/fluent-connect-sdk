import { WIDGET_STYLE_SCOPE } from "@fluent.xyz/connect/internal/portalContainer";
import type { ReactNode } from "react";

/**
 * How far a piece of UI has moved onto the theme tokens. Maintained by hand:
 * `legacy` means hard-coded colours (`#49eded`, `#030213`, `#ff8fda`, `#5011FF`,
 * `text-white/..`, `bg-neutral-*`), `mixed` means tokens with a few literals left.
 */
export type SpecimenStatus = "tokens" | "mixed" | "legacy";

const STATUS: Record<SpecimenStatus, { label: string; className: string }> = {
  tokens: { label: "tokens", className: "bg-green-400/15 text-green-400" },
  mixed: { label: "mixed", className: "bg-amber-400/15 text-amber-400" },
  legacy: { label: "legacy", className: "bg-[#ff8fda]/15 text-[#ff8fda]" },
};

export function StatusBadge({ status }: { status: SpecimenStatus }) {
  const { label, className } = STATUS[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <dl className="flex flex-col gap-2 text-xs text-white/50">
      <div className="flex items-start gap-2">
        <dt className="shrink-0 pt-px"><StatusBadge status="tokens" /></dt>
        <dd>Built on the theme tokens only.</dd>
      </div>
      <div className="flex items-start gap-2">
        <dt className="shrink-0 pt-px"><StatusBadge status="mixed" /></dt>
        <dd>Tokens, with a few literal colours left (white/neutral/green).</dd>
      </div>
      <div className="flex items-start gap-2">
        <dt className="shrink-0 pt-px"><StatusBadge status="legacy" /></dt>
        <dd>
          Old UI: hard-coded <code>#49eded</code>, <code>#030213</code>, <code>#ff8fda</code>,{" "}
          <code>#5011FF</code> or <code>text-white/…</code>.
        </dd>
      </div>
    </dl>
  );
}

/**
 * One piece of UI, framed like the preview's other cards. The widget's reset and
 * colour tokens are scoped to `.fluent-root`, which only the drawer provides in
 * the live widget, so the card supplies it with the padding DrawerContent gives
 * the wallet menu.
 */
export function Specimen({
  id,
  title,
  note,
  status,
  wide = false,
  padded = true,
  children,
}: {
  id?: string;
  title: string;
  note?: ReactNode;
  status?: SpecimenStatus;
  /** Spans the grid. */
  wide?: boolean;
  /** Off for content that frames itself, such as an overlay. */
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`flex flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950 ${
        wide ? "col-span-full" : ""
      }`}
    >
      <header className="flex flex-col gap-1.5 border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{title}</h3>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        {note ? <p className="text-xs leading-relaxed text-white/40">{note}</p> : null}
      </header>
      <div className={WIDGET_STYLE_SCOPE}>
        <div className={`flex flex-1 flex-col gap-3 bg-black ${padded ? "p-4" : ""}`}>{children}</div>
      </div>
    </section>
  );
}

export function SpecimenGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
      {children}
    </div>
  );
}

/** A page section: an anchor, a heading, a line of context, then its specimens. */
export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-6">
      <header className="flex max-w-[720px] flex-col gap-2">
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-white/50">{note}</p>
      </header>
      {children}
    </section>
  );
}

/** A labelled row inside a specimen, for variants laid side by side. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.055em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
