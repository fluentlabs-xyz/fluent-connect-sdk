import type { FluentExecuteTiming } from "@fluent.xyz/connect";

/**
 * One stage of a send, ready to be shown. `value` is `null` when the stage was not measured, and
 * the renderer says so rather than print a zero: an unread block and a stage that took no time
 * are opposite facts.
 */
export type TimelineRow = {
  /** The stage, in the words this page uses for it. */
  label: string;
  /** The measurement with its unit, or `null` when there is none. */
  value: string | null;
  /** A signed estimate across two clocks, not a direct measurement. */
  approximate: boolean;
  /** What the number is, for the reader who stops on it. */
  note: string;
};

/**
 * The caveat for the two `≈` rows, which may read negative: each subtracts two clocks, one with
 * one-second resolution, and the result is not clamped to zero.
 */
export const TIMELINE_APPROXIMATE_NOTE =
  "Inclusion and detection are estimates: they compare this browser's clock with the including " +
  "block's timestamp, which the chain records in whole seconds. Nothing is clamped, so a small " +
  "value may read negative.";

/**
 * Returns the displayed stages of one send, in the order they happened. Empty for a send with no
 * timing: one in flight, one that failed, or one through an External wallet, which has no
 * observable boundary between signing and broadcasting.
 */
export function timelineRows(timing: FluentExecuteTiming | undefined): TimelineRow[] {
  if (!timing) return [];
  const attempts = timing.instants.attempts;
  return [
    {
      label: "prepare",
      value: formatMs(timing.prepareMs),
      approximate: false,
      note:
        "Building the operation — nonce, gas estimate, paymaster — up to the signature request.",
    },
    {
      label: "sign",
      value: formatMs(timing.signMs),
      approximate: false,
      note: "Producing the signature.",
    },
    {
      label: "broadcast",
      value: formatMs(timing.broadcastMs),
      approximate: false,
      note: "Handing the signed operation to the bundler.",
    },
    {
      label: "inclusion",
      value: formatMs(timing.inclusionMs, true),
      approximate: true,
      note:
        "The bundler accepting the operation to the including block's timestamp: " +
        "bundling and block time.",
    },
    {
      label: "detect",
      value: formatMs(timing.detectMs, true),
      approximate: true,
      note:
        "The including block's timestamp to the moment this page held the receipt: " +
        "how long the inclusion took to notice.",
    },
    {
      label: "retry",
      value: formatMs(timing.retryMs),
      approximate: false,
      note:
        attempts > 1
          ? `${attempts} operations were submitted; this is what the ones that did not settle ` +
            "cost — a refused bearer, or a fallback to the account's own gas. Counted in the " +
            "total, and in no stage."
          : "Submitted once, so nothing was spent on a retry or a fallback.",
    },
    {
      label: "total",
      value: formatMs(timing.totalMs),
      approximate: false,
      note:
        "Measured from the first submission to the receipt in hand. Not the sum of the stages: " +
        "it also covers the waiting between them, and it excludes the account setup before " +
        "the send.",
    },
  ];
}

/** Returns the caveat these rows need, or null when none of them is an estimate. */
export function timelineCaveat(rows: readonly TimelineRow[]): string | null {
  const estimated = rows.some((row) => row.approximate && row.value !== null);
  return estimated ? TIMELINE_APPROXIMATE_NOTE : null;
}

/**
 * Formats whole milliseconds with the sign kept; `≈` marks the two cross-clock estimates, so
 * neither reads as a direct measurement.
 */
function formatMs(ms: number | undefined, approximate = false): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  return `${approximate ? "≈ " : ""}${Math.round(ms)} ms`;
}
