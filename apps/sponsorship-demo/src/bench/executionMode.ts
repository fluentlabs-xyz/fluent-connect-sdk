import type { FluentWidgetExecution } from "@fluent.xyz/connect";

/**
 * The two execution paths this bench compares. Each switches its three settings as one, because
 * every number on the timeline belongs to a whole path: `chain` is the widget's default, and
 * `zerodev` takes the fee quote and the receipt from the bundler and checks the chain before a
 * signature.
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

/** Returns the settings of one path; an unknown id takes the default path rather than none. */
export function executionFor(id: ExecutionModeId): Required<FluentWidgetExecution> {
  const mode = EXECUTION_MODES.find((candidate) => candidate.id === id);
  return (mode ?? EXECUTION_MODES[0]).execution;
}
