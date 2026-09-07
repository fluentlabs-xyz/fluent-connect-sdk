import { formatUnits, type Address } from "viem";
import type { FluentGasTokenSymbol } from "@fluent.xyz/connect";

import type { GasOptionId } from "../consts";
import type { Erc20PaymasterState } from "./erc20Paymaster";

/** The subset of a token balance this decision reads. */
export type GasTokenBalance = {
  status: "ready" | "not-configured" | "error";
  raw: bigint | null;
};

export type GasOptionAvailability =
  | { enabled: true; reason?: undefined }
  | { enabled: false; reason: string };

/**
 * Whether one way of paying for gas can be pressed, and — when it cannot — the sentence
 * that says why.
 *
 * Every refusal is a sentence rather than a disabled button, because this demo exists to
 * make the gas path legible: a button that is off for an unstated reason teaches the
 * visitor that the product is broken, which is the one reading the page must never allow.
 *
 * The checks are ordered from the most structural to the most recoverable, so the reason a
 * visitor reads is the one they would have to fix first.
 */
export function gasOptionAvailability(params: {
  symbol: FluentGasTokenSymbol;
  /** The widget's own readiness — nothing can be sent before it. */
  executionReady: boolean;
  /** `FluentAccountCapabilities.erc20Gas`: false for an external wallet. */
  erc20Gas: boolean;
  paymaster: Erc20PaymasterState;
  /**
   * The gas token's own contract address on the active network, as the SDK's token table
   * records it. Not the paymaster's — that one is resolved at runtime and arrives in
   * `paymaster`.
   *
   * Load-bearing rather than informational: where the widget cannot resolve an address for
   * the symbol it drops both the approval and the paymaster and sends with native gas, so a
   * send offered here would settle as PAID OWN GAS and only say so afterwards.
   */
  gasTokenAddress: Address | undefined;
  balance: GasTokenBalance | undefined;
}): GasOptionAvailability {
  if (!params.executionReady) {
    return { enabled: false, reason: "Sign in and wait for the smart account to be prepared." };
  }

  // Native gas asks nothing of the ERC-20 paymaster, so none of the checks below apply.
  if (params.symbol === "ETH") return { enabled: true };

  if (!params.erc20Gas) {
    return {
      enabled: false,
      reason: "Token-paid gas needs a Fluent smart account — an external wallet pays its own ETH.",
    };
  }

  if (!params.gasTokenAddress) {
    return {
      enabled: false,
      reason:
        `${params.symbol} has no token address on this network, so the widget would drop ` +
        `the paymaster and charge your own ETH.`,
    };
  }

  if (params.paymaster.status === "resolving") {
    return { enabled: false, reason: "Asking the ERC-20 paymaster which account it charges…" };
  }

  if (params.paymaster.status === "unreachable") {
    return {
      enabled: false,
      reason: `The ERC-20 paymaster did not answer — ${params.paymaster.error}`,
    };
  }

  if (!params.balance) {
    return { enabled: false, reason: `Reading your ${params.symbol} balance…` };
  }

  if (params.balance.status !== "ready" || params.balance.raw === null) {
    return {
      enabled: false,
      reason: `Your ${params.symbol} balance could not be read, so this send is not offered.`,
    };
  }

  // The precondition worth stating before the send rather than after: an empty balance
  // reaches the bundler as an opaque paymaster rejection.
  if (params.balance.raw === 0n) {
    return {
      enabled: false,
      reason: `You hold no ${params.symbol}. Use the faucet in the account menu, then try again.`,
    };
  }

  return { enabled: true };
}

/**
 * The `approve` the widget prepends to a token-paid send, written out before it is signed.
 *
 * It is the most visible difference between paying in ETH and paying in a token, and the
 * widget's own review modal never shows it — the approval is added inside the send, after
 * the modal has already listed the visitor's own call. Naming it here is what keeps the two
 * screens from disagreeing by omission.
 */
export function describeApproval(params: {
  symbol: FluentGasTokenSymbol;
  tokenAddress: Address | undefined;
  /** The paymaster address resolved from the SDK; never a constant. */
  spender: Address | undefined;
  approveAmount: bigint;
  decimals: number;
}): { call: string; reason: string } | null {
  // A sponsored send prepends nothing, and it is the absence of a token address that says
  // so — the symbol would be a second way of asking the same question.
  if (!params.tokenAddress) return null;
  // Until the spender is known there is no call to describe, and a placeholder here would
  // be read as the address that gets the allowance.
  if (!params.spender) return null;

  const cap = formatUnits(params.approveAmount, params.decimals);
  return {
    call: `approve(${params.spender}, ${cap} ${params.symbol}) · ${params.tokenAddress}`,
    reason:
      `Added by the widget ahead of your call: the ERC-20 paymaster takes its fee in ` +
      `${params.symbol}, and it can only take what it is allowed to.`,
  };
}

/**
 * Which account's balance the gas comes out of, for the selection in front of the reader.
 *
 * The panel used to leave this to inference, and inference gets it wrong: a smart account
 * is two addresses, and the intuitive answer — "the wallet I signed in with" — is the one
 * address that never pays. The embedded wallet only signs; the ERC-4337 `sender` is the
 * ZeroDev kernel, so any gas the account pays itself leaves the kernel's balance.
 *
 * Sponsored is deliberately hedged. The SDK asks the sponsorship paymaster and, on a
 * refusal, resends with the account paying its own ETH (`zerodevSession.ts`, the retry
 * around `sendUserOperation`). Both outcomes are normal, they are indistinguishable before
 * the send, and only the settled receipt separates them — which is what the payer badge on
 * each row reports.
 */
export function describeGasPayer(params: {
  option: GasOptionId;
  accountType: "smart" | "eoa" | undefined;
}): string {
  if (params.accountType === "eoa") {
    return "Your external wallet pays its own gas in ETH: no smart account, so no paymaster.";
  }
  if (params.accountType === undefined) {
    return "Sign in to see which account pays.";
  }
  if (params.option === "sponsored") {
    return (
      "The partner's budget pays, through the sponsorship paymaster. If it refuses, the " +
      "smart account falls back to its own ETH — the badge on the row says which happened."
    );
  }
  if (params.option === "self") {
    return (
      "The smart account pays its own ETH, from the kernel's balance. The sponsorship " +
      "paymaster is not contacted at all, so the budget is untouched either way."
    );
  }
  return (
    `The smart account pays in ${params.option}, through the ERC-20 paymaster. Not the ` +
    "embedded wallet: it only signs."
  );
}

/**
 * Whether Dry-run applies to the way of paying that is currently selected, and the sentence
 * that says why when it does not.
 *
 * Dry-run asks one question — would the partner's budget cover this — so it is only about
 * the sponsored path. Under `self` the paymaster is never contacted; under a token the
 * ERC-20 paymaster pays and the sponsorship rules are not consulted either. Leaving the
 * button live in those states would answer a question the send is not going to ask, and a
 * reader comparing the verdict against the badge would find them disagreeing for a reason
 * the page never stated.
 */
export function dryRunAvailability(option: GasOptionId): GasOptionAvailability {
  if (option === "sponsored") return { enabled: true };
  return {
    enabled: false,
    reason:
      option === "self"
        ? "Dry-run asks whether the partner's budget would cover this. A self-paid send never asks it — switch to sponsored."
        : `Dry-run asks about the partner's budget. A ${option}-paid send goes through the ERC-20 paymaster instead — switch to sponsored.`,
  };
}
