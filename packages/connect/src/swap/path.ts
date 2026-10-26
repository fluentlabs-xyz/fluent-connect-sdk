import { encodePacked, type Address, type Hex } from "viem";

import type { FluentSwapFeeTier } from "./contracts";

/** One pool a swap passes through, named by the addresses the pool itself holds. */
export type FluentSwapHop = {
  tokenIn: Address;
  tokenOut: Address;
  fee: FluentSwapFeeTier;
};

/**
 * A Uniswap V3 path: token, fee, token, fee, token — packed, not ABI-encoded,
 * which is why `encodePacked` and not `encodeAbiParameters`. Written in the
 * direction the swap runs, as the router's exact-input functions walk it.
 *
 * Throws on an empty route: a path with no pool in it names nothing, and a
 * multi-hop quote is the only caller.
 */
export function encodeFluentSwapPath(route: readonly FluentSwapHop[]): Hex {
  const [first] = route;
  if (!first) throw new Error("A swap path needs at least one pool");

  const types: string[] = ["address"];
  const values: (Address | number)[] = [first.tokenIn];

  for (const hop of route) {
    types.push("uint24", "address");
    values.push(hop.fee, hop.tokenOut);
  }

  return encodePacked(types, values);
}
