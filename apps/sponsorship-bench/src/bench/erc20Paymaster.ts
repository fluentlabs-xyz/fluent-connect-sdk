import { createFluentZeroDevErc20PaymasterApprovalCall } from "@fluent.xyz/connect";
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  type Address,
} from "viem";

import {
  CHAIN,
  GAS_TOKENS,
  GAS_TOKEN_APPROVE_FLOOR_TOKENS,
  GAS_TOKEN_APPROVE_TOKENS,
} from "../consts";
import type { GasTokenSymbol } from "./tokenBalance";

/**
 * A standing allowance the account has already granted, and what the next send would do
 * about it. `spender` is the paymaster that will actually be charged, resolved from the
 * SDK — never transcribed.
 */
export type PaymasterAllowance = {
  symbol: GasTokenSymbol;
  token: Address;
  decimals: number;
  spender: Address;
  /** What the account has standing right now, in the token's smallest unit. */
  allowance: bigint;
  /** What a send would grant when the standing allowance is short. */
  approveAmount: bigint;
  /** True when the next send must carry the approval ahead of the action. */
  needsApproval: boolean;
};

/** What a send actually granted, stamped at send time rather than re-read afterwards. */
export type GrantedApproval = {
  symbol: GasTokenSymbol;
  amount: bigint;
  decimals: number;
  /** Undefined only when the address could not be resolved; the grant still happened. */
  spender?: Address;
};

/**
 * What a send would grant for this token. Deliberately computable with no network read, so
 * a Send pressed while the allowance is still in flight still carries an approval — an
 * unknown allowance must fall to "approve", never to "skip". A redundant approve costs a
 * little gas; a missing one reverts the whole operation and is charged anyway (F4c).
 */
export function plannedApproval(symbol: GasTokenSymbol) {
  const decimals = GAS_TOKENS[symbol].decimals;
  return { amount: GAS_TOKEN_APPROVE_TOKENS * 10n ** BigInt(decimals), decimals };
}

/**
 * The paymaster the SDK will hand the approval to.
 *
 * Resolved, not written down. Token-paid gas goes to a different ZeroDev project from the
 * sponsorship path (F4b), so every ERC-20 paymaster address recorded in this repository
 * belongs to the wrong project — including the one in the service's own chart. The SDK
 * asks that project which account it will charge (`zd_pm_accounts`) and encodes the
 * approve against the answer; reading the spender back out of that call is how this page
 * learns the address without ever naming one.
 *
 * The answer depends on the chain and the EntryPoint, not on the token, so it is fetched
 * once and shared. The promise itself is cached, so two callers racing on a cold page make
 * one request.
 */
let spenderPromise: Promise<Address> | null = null;

export function resolveErc20PaymasterAddress(): Promise<Address> {
  spenderPromise ??= (async () => {
    const call = await createFluentZeroDevErc20PaymasterApprovalCall({
      chain: CHAIN,
      // Any gas token resolves the same paymaster; BLEND is the one this account holds.
      gasToken: GAS_TOKENS.BLEND.address as Address,
      approveAmount: 0n,
    });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (decoded.functionName !== "approve") {
      throw new Error(`expected an approve call, got ${decoded.functionName}`);
    }
    return decoded.args[0];
  })().catch((error: unknown) => {
    // Do not cache a failure: a cold RPC or a dropped connection must be retryable, and
    // the page asks again on the next selector change.
    spenderPromise = null;
    throw error;
  });
  return spenderPromise;
}

/**
 * Read what the account has already granted, and decide whether the next send must carry
 * an approval.
 *
 * `null` means the question could not be answered — a failed resolve or a failed read. It
 * is never "the allowance is fine": the caller includes the approval when it does not
 * know, because a redundant approve costs a little gas and a missing one reverts the whole
 * operation (F4c).
 */
export async function readPaymasterAllowance(
  symbol: GasTokenSymbol,
  account: Address,
): Promise<PaymasterAllowance | null> {
  try {
    const definition = GAS_TOKENS[symbol];
    const token = definition.address as Address;
    const decimals = definition.decimals;
    const unit = 10n ** BigInt(decimals);
    const spender = await resolveErc20PaymasterAddress();
    const client = createPublicClient({ chain: CHAIN, transport: http() });
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, spender],
    });
    return {
      symbol,
      token,
      decimals,
      spender,
      allowance,
      approveAmount: GAS_TOKEN_APPROVE_TOKENS * unit,
      needsApproval: allowance < GAS_TOKEN_APPROVE_FLOOR_TOKENS * unit,
    };
  } catch {
    return null;
  }
}

/**
 * Whole tokens with the trailing zeros gone — `100`, not `100.000000000000000000`.
 *
 * `maxFraction` truncates, never rounds, and is for the *standing* allowance only: after a
 * send the paymaster has already taken its gas, so the figure is 99.999755387722999123 and
 * eighteen digits of it are noise. Truncating understates, which is the safe direction for
 * "how much do you have left". The grant is a round number and is never truncated.
 */
export function formatTokenAmount(amount: bigint, decimals: number, maxFraction?: number) {
  const plain = formatUnits(amount, decimals);
  if (!plain.includes(".")) return plain;
  const [whole, fraction = ""] = plain.split(".");
  const kept = (maxFraction === undefined ? fraction : fraction.slice(0, maxFraction)).replace(
    /0+$/,
    "",
  );
  return kept ? `${whole}.${kept}` : whole;
}

/** Enough of an address to compare, with the whole string kept in the element's `title`. */
export function shortenAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
