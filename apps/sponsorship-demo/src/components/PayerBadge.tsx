import type { FluentExecuteTiming } from "@fluent.xyz/connect";
import { zeroAddress, type Address } from "viem";

import {
  sponsorshipPaymasterFor,
  sponsorshipPaymasterOf,
  type GasOptionId,
  type SponsorshipPaymasterKind,
} from "../consts";

/**
 * Who paid, as the settled operation records it, not as the selector intended.
 *
 * Each payer has its own paymaster address on chain, or the zero address. The Network's two
 * sponsorship paymasters are two payers, because which one paid is what a Network with both
 * needs to tell apart. `unrecognised` is a non-zero paymaster that is neither of them nor the
 * ERC-20 one the SDK resolved: a misconfiguration worth seeing. `unreadable` is a failed read,
 * not a payer.
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
  /** The paymaster the EntryPoint recorded; undefined when it could not be read. */
  paymaster?: Address;
  /**
   * The way of paying the send asked for, recorded when it was sent rather than read off the
   * selector at render, because the selector can move while a send settles.
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
 * Returns who paid for a settled operation, judged only by its paymaster address.
 *
 * Not the widget's `sponsored` flag, which assumes Sponsorship worked when the paymaster cannot
 * be read, and not the selected way of paying, which is the intent rather than the fact.
 * `paymaster` is read by `bench/settledPaymaster.ts`: the zero address for a self-paid
 * operation, and undefined only when no event could be read.
 */
export function classifyPayer(
  paymaster: Address | undefined,
  /**
   * The ERC-20 paymaster as the SDK resolved it; undefined when the lookup failed, and then a
   * token-paid operation reads `unrecognised`.
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

/** Returns the sponsorship paymaster a payer names; undefined when no App's budget paid. */
function sponsorshipOf(payer: Payer) {
  return payer === "app-budget-own" || payer === "app-budget-zerodev"
    ? sponsorshipPaymasterOf(payer.slice("app-budget-".length) as SponsorshipPaymasterKind)
    : undefined;
}

/**
 * Returns the badge label and class for a payer. Only an App's budget seen to pay, through
 * either sponsorship paymaster, gets the accent colour; a token payment is the ordinary outcome
 * of asking for one.
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
 * Returns one sentence saying whose money moved; when the payer differs from what the send asked
 * for, the sentence says that instead.
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
      // Asked for, not a fallback: a `self` send tells the SDK not to contact the paymaster.
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
 * The badge of a send's outcome: who paid, or FAILED. A refusal in the sponsorship proxy is a
 * flat 403 after which the widget pays the account's own gas, so without the badge a sponsored
 * send and a refused one look the same.
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
