import type { FluentExecuteTiming } from "@fluent.xyz/connect";
import { zeroAddress, type Address } from "viem";

import {
  sponsorshipPaymasterFor,
  sponsorshipPaymasterOf,
  type GasOptionId,
  type SponsorshipPaymasterKind,
} from "../consts";

/**
 * Who paid, as the settled operation records it — never as the selector intended.
 *
 * "SPONSORED" was a lie for a token payment: somebody paid, and it was the user, in
 * BLEND. Each way an operation gets paid for is a payer, and each has an address (or the
 * absence of one) that says so on chain. An App's budget pays through one of the Network's two
 * sponsorship paymasters, and the two are two payers, because which one paid is the fact a
 * Network with both exists to tell apart.
 *
 * `unrecognised` is not a rounding error. A non-zero paymaster that is neither of the
 * sponsorship ones nor the ERC-20 one the SDK resolved means somebody is pointed somewhere
 * else, and collapsing it into either answer would hide exactly the misconfiguration
 * worth finding.
 * `unreadable` is a measurement failure and must never collapse into a payer.
 */
export type Payer =
  | `app-budget-${SponsorshipPaymasterKind}`
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
  requested?: GasOptionId;
  /** What the send threw, verbatim. */
  error?: string;
  /** A plainer reading of `error` when one could be established — e.g. an empty balance. */
  errorNote?: string;
  /**
   * Where this send's milliseconds went, as the widget measured them. Undefined while the send is
   * in flight, and for a send that failed before a receipt — neither has a timeline yet.
   */
  timing?: FluentExecuteTiming;
};

/**
 * Read only off the settled operation, and only by address.
 *
 * Deliberately not the widget's own `sponsored` flag: that falls back to "we built a
 * sponsored client, so presumably it worked" when the paymaster cannot be read, and on
 * this page that guess has already been wrong — sends reported SPONSORED while the
 * EntryPoint recorded the zero address and the account paid. And deliberately not the
 * selected mode: the mode is the intent, the paymaster is the fact, and the whole point
 * of this bench is that they can differ.
 *
 * The `paymaster` is the settled operation's, as `bench/settledPaymaster.ts` reads it: the
 * zero address for a self-paid operation, and undefined only when no event could be read.
 */
export function classifyPayer(
  paymaster: Address | undefined,
  /**
   * The ERC-20 paymaster as the SDK resolved it, not as any chart records it. Undefined
   * when the resolve failed, and then a token-paid operation reads `unrecognised` — which
   * is the honest answer: we could not establish who that address is.
   */
  erc20Paymaster: Address | undefined,
): Payer {
  if (!paymaster) return "unreadable";
  const paid = paymaster.toLowerCase();
  if (paid === zeroAddress) return "user-eth";
  const sponsorship = sponsorshipPaymasterFor(paymaster);
  if (sponsorship) return `app-budget-${sponsorship.kind}`;
  if (erc20Paymaster && paid === erc20Paymaster.toLowerCase()) return "user-token";
  return "unrecognised";
}

/** The sponsorship paymaster a payer names; undefined for a payer that is not an App's budget. */
function sponsorshipOf(payer: Payer) {
  return payer === "app-budget-own" || payer === "app-budget-zerodev"
    ? sponsorshipPaymasterOf(payer.slice("app-budget-".length) as SponsorshipPaymasterKind)
    : undefined;
}

/**
 * What the badge shows for a payer.
 *
 * Cyan is reserved for one thing on this page: an App's budget paid, and was seen to pay —
 * through either sponsorship paymaster, so both sponsored badges wear it and differ only in
 * the name after the dot. A token payment is the ordinary outcome of asking for one, so it
 * gets no ink.
 */
export function badgeFor(payer: Payer): { label: string; className: string } {
  const sponsorship = sponsorshipOf(payer);
  if (sponsorship) {
    return { label: `SPONSORED · ${sponsorship.badge}`, className: "badge badge-sponsored" };
  }
  switch (payer) {
    case "user-token":
      return { label: "PAID IN TOKEN", className: "badge badge-token" };
    case "user-eth":
      return { label: "PAID OWN GAS", className: "badge badge-self" };
    case "unrecognised":
      return { label: "UNKNOWN PAYMASTER", className: "badge badge-unknown" };
    default:
      return { label: "UNKNOWN", className: "badge badge-unknown" };
  }
}

/**
 * One sentence: whose money moved, and — when the intent and the fact disagree — that
 * they did. The disagreement is the sentence worth reading, so it replaces the plain one
 * rather than being appended to it.
 */
export function payerSentence(outcome: SendOutcome): string | null {
  if (!outcome.payer) return null;
  const sponsorship = sponsorshipOf(outcome.payer);
  if (sponsorship) {
    return outcome.requested === "sponsored"
      ? `The App's budget paid, through ${sponsorship.name}.`
      : `The App's budget paid, through ${sponsorship.name}, though the send asked for ` +
          `${outcome.requested}.`;
  }
  switch (outcome.payer) {
    case "user-token":
      return `You paid, through the ERC-20 paymaster. The send asked for ${outcome.requested}.`;
    case "user-eth":
      // A `self` send is the one case where paying your own ETH is the answer rather than
      // the fallback: the SDK was told not to contact the paymaster, so there is nothing to
      // hedge about.
      if (outcome.requested === "self") {
        return "Your account paid its own ETH, which is what the send asked for: sponsorship was never contacted.";
      }
      return outcome.requested === "sponsored"
        // Why nothing sponsored it is not something the zero address can say: an
        // uncovered action and a refused proxy look identical from here. Name both, and
        // leave the dry run beside it to say which.
        ? "Nothing sponsored it: your account paid its own ETH — the rule refused, or sponsorship never entered the path. The dry-run beside it says which."
        : `Your account paid its own ETH, though the send asked to pay in ${outcome.requested}.`;
    case "unrecognised":
      return (
        "A paymaster paid, but neither sponsorship paymaster nor the ERC-20 one this bench knows."
      );
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
  const badge = badgeFor(outcome.payer);
  return <span className={badge.className}>{badge.label}</span>;
}
