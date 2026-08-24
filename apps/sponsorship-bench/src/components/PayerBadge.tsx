import { zeroAddress, type Address } from "viem";
import type { FluentGasPaymentSymbol } from "@fluent.xyz/connect";

import { ERC20_PAYMASTER, SPONSORSHIP_PAYMASTER } from "../consts";

/**
 * Who paid, as the settled operation records it — never as the selector intended.
 *
 * "SPONSORED" was a lie for a token payment: somebody paid, and it was the user, in
 * BLEND. The three ways an operation gets paid for are three payers, and each has an
 * address (or the absence of one) that says so on chain.
 *
 * `unrecognised` is not a rounding error. A non-zero paymaster that is neither of the two
 * this bench knows means the service is pointed somewhere else, and collapsing it into
 * either answer would hide exactly the misconfiguration worth finding.
 * `unreadable` is a measurement failure and must never collapse into a payer.
 */
export type Payer =
  | "partner-budget"
  | "user-token"
  | "user-eth"
  | "unrecognised"
  | "unreadable";

export type SendOutcome = {
  hash?: `0x${string}`;
  /** Undefined until the send settles. */
  payer?: Payer;
  /** Who the EntryPoint charged. Undefined means we could not read it — say so. */
  paymaster?: Address;
  /**
   * The mode the send asked for, recorded when it was sent rather than read off the
   * selector at render: the selector can move while a send settles, and a result that
   * renamed its own intent afterwards would be worse than no intent at all.
   */
  requested?: FluentGasPaymentSymbol;
  /** What the send threw, verbatim. */
  error?: string;
  /** A plainer reading of `error` when one could be established — e.g. an empty balance. */
  errorNote?: string;
};

/**
 * Read only off the settled operation, and only by address.
 *
 * Deliberately not the widget's own `sponsored` flag: that falls back to "we built a
 * sponsored client, so presumably it worked" when the paymaster cannot be read, and on
 * this page that guess has already been wrong — three sends reported SPONSORED while the
 * EntryPoint recorded the zero address and the account paid. And deliberately not the
 * selected mode: the mode is the intent, the paymaster is the fact, and the whole point
 * of this bench is that they can differ.
 */
export function classifyPayer(paymaster: Address | undefined): Payer {
  if (!paymaster) return "unreadable";
  const paid = paymaster.toLowerCase();
  if (paid === zeroAddress) return "user-eth";
  if (paid === SPONSORSHIP_PAYMASTER) return "partner-budget";
  if (paid === ERC20_PAYMASTER) return "user-token";
  return "unrecognised";
}

const BADGE: Record<Payer, { label: string; className: string }> = {
  // Cyan is reserved for one thing on this page: a partner's budget paid, and was seen
  // to pay. A token payment is the ordinary outcome of asking for one, so it gets no ink.
  "partner-budget": { label: "SPONSORED", className: "badge badge-sponsored" },
  "user-token": { label: "PAID IN TOKEN", className: "badge badge-token" },
  "user-eth": { label: "PAID OWN GAS", className: "badge badge-self" },
  unrecognised: { label: "UNKNOWN PAYMASTER", className: "badge badge-unknown" },
  unreadable: { label: "UNKNOWN", className: "badge badge-unknown" },
};

/**
 * One sentence: whose money moved, and — when the intent and the fact disagree — that
 * they did. The disagreement is the sentence worth reading, so it replaces the plain one
 * rather than being appended to it.
 */
export function payerSentence(outcome: SendOutcome): string | null {
  switch (outcome.payer) {
    case "partner-budget":
      return outcome.requested === "ETH"
        ? "The partner's budget paid, through the sponsorship paymaster."
        : `The partner's budget paid, though the send asked to pay in ${outcome.requested}.`;
    case "user-token":
      return `You paid, through the ERC-20 paymaster. The send asked for ${outcome.requested}.`;
    case "user-eth":
      return outcome.requested === "ETH"
        // Why nothing sponsored it is not something the zero address can say: an
        // uncovered action and a refused proxy look identical from here. Name both, and
        // leave the dry run beside it to say which.
        ? "Nothing sponsored it: your account paid its own ETH — no rule covered it, or sponsorship refused."
        : `Your account paid its own ETH, though the send asked to pay in ${outcome.requested}.`;
    case "unrecognised":
      return "A paymaster paid, but neither the sponsorship nor the ERC-20 one this bench knows.";
    case "unreadable":
      return "The paymaster could not be read from the settled operation.";
    default:
      return null;
  }
}

/**
 * The first display requirement, not a nicety. Any refusal in the sponsorship proxy is a
 * flat 403 and the widget then quietly pays the account's own gas, so a bench without
 * this shows the same picture for "working" and "working but not sponsoring".
 */
export function PayerBadge({ outcome }: { outcome: SendOutcome }) {
  if (outcome.error) {
    return (
      <span className="badge badge-error" title={outcome.error}>
        FAILED
      </span>
    );
  }
  if (!outcome.payer) return null;
  const badge = BADGE[outcome.payer];
  return <span className={badge.className}>{badge.label}</span>;
}
