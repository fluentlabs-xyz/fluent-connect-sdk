import { CircleHelp } from "lucide-react";
import { formatUnits } from "viem";

import { formatFluentLocaleAmount } from "../utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The pieces every money-moving page in the drawer is built from — Bridge and
 * Send share them so an amount typed on one looks like an amount typed on the
 * other: the Portal's amount card, its fee summary rows, and the figure that
 * shrinks to stay on one line.
 */

/** Six fraction digits is where a figure stops being readable in 384px. */
export function formatAmount(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "—";
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** The Portal's tiers: cents from a dollar up, finer below it. */
export function formatUsd(usd: number): string {
  return `$${formatFluentLocaleAmount(usd, usd >= 1 ? 2 : usd >= 0.01 ? 3 : 4)}`;
}

/** The typed amount in USD — "$0" while empty, as under the Portal's figure. */
export function formatAmountUsd(amount: string, usdPrice: number | undefined): string | undefined {
  if (usdPrice === undefined) return undefined;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? formatUsd(value * usdPrice) : "$0";
}

const AMOUNT_MAX_PX = 24;
const AMOUNT_MIN_PX = 14;
/** Digits in the widget's sans run about 0.6em; the separator is narrower, which keeps this conservative. */
const AMOUNT_CHAR_WIDTH_EM = 0.6;

/**
 * Shrinks a figure so a long value stays on one line, sized against its
 * wrapper (`container-type: inline-size`) rather than fixed breakpoints, as the
 * Portal's amount cards do — so sibling cards' figures shrink in step.
 */
export function getAmountFontStyle(value: string): React.CSSProperties {
  const width = (Math.max(value.length, 1) * AMOUNT_CHAR_WIDTH_EM).toFixed(2);
  return { fontSize: `clamp(${AMOUNT_MIN_PX}px, calc(100cqi / ${width}), ${AMOUNT_MAX_PX}px)` };
}

/** The input a figure goes into on an `AmountCard`; the caller sizes it with `getAmountFontStyle`. */
export const AMOUNT_INPUT_CLASS =
  "w-full min-w-0 border-none bg-transparent p-0 font-medium leading-[1.2] text-foreground outline-none placeholder:text-foreground/40 disabled:opacity-50";

export function AmountCard({
  label,
  children,
  footer,
}: {
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-2xl bg-foreground/5 p-5">
      <span className="text-sm text-foreground/60">{label}</span>
      {children}
      {footer}
    </div>
  );
}

/**
 * One line of a fee summary, laid out as the Portal's: the label, with a help
 * tip when the row wants explaining; the figure; and a dot-separated secondary
 * such as its value in USD. Needs a `TooltipProvider` above it when `tooltip`
 * is set.
 */
export function SummaryRow({
  label,
  value,
  secondary,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  secondary?: string;
  tooltip?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-5 text-sm">
      <span className="inline-flex items-center gap-1 text-foreground/80">
        {label}
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              tabIndex={0}
              aria-label={`About the ${label.toLowerCase()}`}
              render={<span className="inline-flex cursor-default rounded-sm" />}
            >
              <CircleHelp className="size-4 text-foreground/45" />
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span className="flex items-center gap-2 text-right">
        <span className="text-foreground">{value}</span>
        {secondary ? <span className="size-0.5 rounded-full bg-foreground/50" /> : null}
        {secondary ? <span className="text-foreground/60">{secondary}</span> : null}
      </span>
    </div>
  );
}
