import { Check, X } from "lucide-react";

/** Where one step of a Two-step deposit stands. */
export type DepositStepStatus = "waiting" | "active" | "done" | "failed";

export type DepositStep = {
  title: string;
  /** What this step does, in one line — the Portal's step card caption. */
  caption: string;
  status: DepositStepStatus;
};

/** The Portal's pink pill that names the flow, above the headline. */
const BADGE_CLASS =
  "rounded-full bg-[#ff8fda] px-2 py-0.5 text-[10px] font-medium tracking-wide " +
  "uppercase text-black";

const BAR_BY_STATUS: Record<DepositStepStatus, string> = {
  waiting: "w-0",
  // The Portal's pink marks the step in progress; a finished one settles to the
  // foreground, so "where am I" reads before any label does.
  active: "w-full bg-[#ff8fda]",
  done: "w-full bg-foreground",
  failed: "w-full bg-destructive",
};

/**
 * The Portal's two-step progress, drawn for the drawer's width: what the whole
 * deposit is doing, then the two steps stacked rather than side by side.
 *
 * The Bridge page no longer draws it — the form, the confirm view and the
 * status views each tell a Two-step deposit in one line — so only the widget
 * preview's Bridge section renders it today.
 */
export function DepositSteps({
  headline,
  description,
  steps,
  busy,
}: {
  headline: string;
  description: string;
  /** Step 1 is the bridge, step 2 the Fluent swap. */
  steps: readonly [DepositStep, DepositStep];
  /** A transaction is out: the step in progress pulses while it is. */
  busy?: boolean;
}) {
  const current = steps.findIndex((step) => step.status === "active" || step.status === "failed");
  const stepNumber = current === -1 ? steps.length : current + 1;

  const bars = (
    <div className="grid grid-cols-2 gap-1.5">
      {steps.map((step, index) => (
        <div key={step.title} className="flex flex-col gap-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                BAR_BY_STATUS[step.status]
              } ${step.status === "active" && busy ? "animate-pulse" : ""}`}
            />
          </div>
          <div
            aria-current={step.status === "active" ? "step" : undefined}
            className={`flex items-center gap-1.5 text-xs ${
              step.status === "failed"
                ? "text-destructive"
                : step.status === "active"
                  ? "text-foreground"
                  : step.status === "done"
                    ? "text-foreground/60"
                    : "text-foreground/40"
            }`}
          >
            {step.status === "done" ? (
              <Check aria-hidden className="size-3 shrink-0" strokeWidth={3} />
            ) : step.status === "failed" ? (
              <X aria-hidden className="size-3 shrink-0" strokeWidth={3} />
            ) : (
              <span className="tabular-nums">{index + 1}.</span>
            )}
            <span className="truncate">{step.title}</span>
          </div>
          <span className="text-[11px] leading-snug text-foreground/45">{step.caption}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div
      role="group"
      aria-label={`Step ${stepNumber} of ${steps.length}`}
      className="flex flex-col gap-3 rounded-2xl bg-foreground/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={BADGE_CLASS}>2-step deposit</span>
        <span className="text-sm font-medium">{headline}</span>
      </div>
      <span className="text-xs text-foreground/60">{description}</span>
      {bars}
    </div>
  );
}
