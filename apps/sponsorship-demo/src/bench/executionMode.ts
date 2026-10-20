import type { FluentWidgetExecution } from "@fluent.xyz/connect";

/**
 * The two execution paths this bench compares, and the one switch between them.
 *
 * Three settings per position, switched as one, because the comparison is between two whole
 * paths and not between their parts: every number on the timeline belongs to one of them, and a
 * reader mixing the three would be measuring something nobody ships. `chain` is what the widget
 * does out of the box; `zerodev` is what it did before FLU-1591, kept so the two can be recorded
 * one after the other in the same page session.
 */
export type ExecutionModeId = "chain" | "zerodev";

export type ExecutionMode = {
  id: ExecutionModeId;
  /** The word in the control, which is also the word a recorded run is labelled with. */
  label: string;
  execution: Required<FluentWidgetExecution>;
};

export const EXECUTION_MODES: readonly ExecutionMode[] = [
  {
    id: "chain",
    label: "chain",
    execution: {
      feeSource: "chain",
      receiptSource: "chain",
      chainCheckBeforeSign: false,
    },
  },
  {
    id: "zerodev",
    label: "ZeroDev",
    execution: {
      feeSource: "bundler",
      receiptSource: "bundler",
      chainCheckBeforeSign: true,
    },
  },
];

/** The settings of one position. An unknown id takes the default path rather than none. */
export function executionFor(id: ExecutionModeId): Required<FluentWidgetExecution> {
  const mode = EXECUTION_MODES.find((candidate) => candidate.id === id);
  return (mode ?? EXECUTION_MODES[0]).execution;
}
