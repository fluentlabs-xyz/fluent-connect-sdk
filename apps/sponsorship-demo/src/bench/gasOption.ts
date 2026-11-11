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
 * Reports whether one way of paying for gas can be pressed, and the sentence saying why when it
 * cannot: a button off for an unstated reason reads as a broken product. The checks run from the
 * most structural to the most recoverable, so the reason shown is the one to fix first.
 */
export function gasOptionAvailability(params: {
  symbol: FluentGasTokenSymbol;
  /** The widget's own readiness — nothing can be sent before it. */
  executionReady: boolean;
  /** `FluentAccountCapabilities.erc20Gas`: false for an External wallet. */
  erc20Gas: boolean;
  paymaster: Erc20PaymasterState;
  /**
   * The Gas token's contract address on the active Network, from the SDK's token table. Without
   * one the widget drops the approval and the paymaster and sends with native gas, so the send
   * would settle as PAID OWN GAS.
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
 * Describes the `approve` the widget prepends to a token-paid send, before it is signed. The
 * widget adds it inside the send, after the Review has listed the visitor's own call, so this
 * page names it; null until there is a token address and a resolved spender.
 */
export function describeApproval(params: {
  symbol: FluentGasTokenSymbol;
  tokenAddress: Address | undefined;
  /** The paymaster address resolved from the SDK; never a constant. */
  spender: Address | undefined;
  approveAmount: bigint;
  decimals: number;
}): { call: string; reason: string } | null {
  // A native-gas send has no token address and prepends nothing.
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
 * Returns which account's balance the gas comes out of, for the selected way of paying.
 *
 * A Fluent ID has two addresses, and the Signer only signs: the ERC-4337 `sender` is the ZeroDev
 * kernel, so self-paid gas leaves the kernel's balance. Sponsored is hedged because on a refusal
 * the SDK resends with the account paying its own ETH (`zerodevSession.ts`), and only the
 * settled receipt, shown by each row's payer badge, tells the two apart.
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
      "The App's budget pays, through the sponsorship paymaster. If it refuses, the " +
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
 * Reports whether Dry-run applies to the selected way of paying, and the sentence saying why
 * when it does not. Dry-run asks whether the App's budget would cover the send, so it applies
 * only to the sponsored way: `self` asks no paymaster, and a token's ERC-20 paymaster pays
 * without consulting the sponsorship rules.
 */
export function dryRunAvailability(option: GasOptionId): GasOptionAvailability {
  if (option === "sponsored") return { enabled: true };
  return {
    enabled: false,
    reason:
      option === "self"
        ? "Dry-run asks whether the App's budget would cover this. A self-paid send never asks it — switch to sponsored."
        : `Dry-run asks about the App's budget. A ${option}-paid send goes through the ERC-20 paymaster instead — switch to sponsored.`,
  };
}
