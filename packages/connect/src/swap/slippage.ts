const BASIS_POINTS = 10_000n;

/**
 * The least the swap may deliver and still be accepted — the quote less
 * `slippageBps`, rounded down, because the router compares the pool's output
 * against this number and a rounding up would reject a swap that is in budget.
 */
export function applyFluentSwapSlippage(amountOut: bigint, slippageBps: bigint): bigint {
  return (amountOut * (BASIS_POINTS - slippageBps)) / BASIS_POINTS;
}

/**
 * When the router stops accepting the swap, as a unix second. Read off the
 * browser's clock, so a device whose clock is far behind sends a deadline the
 * chain has already passed and the router reverts — the same exposure every
 * Uniswap front end has.
 */
export function getFluentSwapDeadline(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.max(1, minutes) * 60);
}
