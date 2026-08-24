import { readFluentTokenBalances } from "@fluent.xyz/connect";
import { createPublicClient, http, type Address } from "viem";

import { CHAIN, GAS_TOKENS } from "../consts";

export type GasTokenSymbol = keyof typeof GAS_TOKENS;

/**
 * Read one gas token's balance, and only after a send in that token has already failed.
 *
 * Deliberately not a live reading beside the selector. The account's balances are the
 * widget's subject, not this page's, and a number that polls next to the control is the
 * panel this page was made simpler by deleting. An empty balance is only interesting once
 * it has cost someone a send — at which point naming it is the difference between
 * "no USDnr balance" and an AA-code the reader has to go and look up.
 *
 * `null` means the read itself failed: not a claim that the balance is fine, and not a
 * claim that it is empty. The caller shows the original error in that case.
 */
export async function readGasTokenBalance(
  symbol: GasTokenSymbol,
  account: Address,
): Promise<bigint | null> {
  try {
    const client = createPublicClient({ chain: CHAIN, transport: http() });
    const [balance] = await readFluentTokenBalances({
      client,
      account,
      tokens: [GAS_TOKENS[symbol]],
    });
    return balance?.status === "ready" ? balance.raw : null;
  } catch {
    return null;
  }
}
