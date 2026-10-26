import { getAddress, parseEther, type Address } from "viem";

import type { FluentWidgetNetwork } from "../core/network";

/**
 * The contracts a Fluent swap goes through: FluxFlow, a Uniswap V3 fork, which
 * is why the router, the quoter and the path encoding are Uniswap's.
 *
 * Addresses come from https://fluxflow.gitbook.io/docs/technical/mainnet-contracts,
 * and are the ones the Portal's swap page uses.
 */
export type FluentSwapContracts = {
  /** `exactInputSingle`, `exactInput`, `multicall` and `unwrapWETH9`. */
  router: Address;
  /** QuoterV2. Its quote functions revert internally, so they are only ever `eth_call`ed. */
  quoter: Address;
  /** How the chain's own coin is held inside a pool, and what a native output is unwrapped from. */
  weth9: Address;
  /**
   * Multicall3, so every candidate route is quoted in one request. Passed to
   * `client.multicall` explicitly: Fluent's viem chain carries no `multicall3`
   * contract, so viem has no address of its own to reach for.
   */
  multicall: Address;
};

const FLUENT_MAINNET_SWAP_CONTRACTS: FluentSwapContracts = {
  router: getAddress("0x23a82a0239F0b88De669Ac9c46222a9e62853701"),
  quoter: getAddress("0x4cfc01cE8bcEEC0371e4C03223F9d1E46622b4Ec"),
  weth9: getAddress("0x927C469E58Daab257Ea60B2D8c37bEDD2a203A54"),
  multicall: getAddress("0xcA11bde05977b3631167028862bE2a173976CA11"),
};

/**
 * `undefined` on a network with no swap deployment. FluxFlow is on Fluent
 * mainnet only, so a Fluent swap is a mainnet feature and the testnet form says
 * so rather than quoting against addresses that hold no liquidity.
 */
export function getFluentSwapContracts(
  network: FluentWidgetNetwork,
): FluentSwapContracts | undefined {
  return network === "mainnet" ? FLUENT_MAINNET_SWAP_CONTRACTS : undefined;
}

/** The pool fees FluxFlow deploys, in hundredths of a basis point: 0.05%, 0.3%, 1%. */
export const FLUENT_SWAP_FEE_TIERS = [500, 3_000, 10_000] as const;

export type FluentSwapFeeTier = (typeof FLUENT_SWAP_FEE_TIERS)[number];

/**
 * How far below the quote the swap may still settle, in basis points. Fixed
 * rather than a setting: the widget's swap is the second leg of a Two-step
 * deposit, not a trading screen, and 0.5% is what the Portal's swap allows by
 * default.
 */
export const FLUENT_SWAP_SLIPPAGE_BPS = 50n;

/** How long the router accepts the swap for, in minutes — Uniswap's own default. */
export const FLUENT_SWAP_DEADLINE_MINUTES = 30;

/** A quote stops being true as the pool moves, so it is read again this often. */
export const FLUENT_SWAP_QUOTE_REFRESH_MS = 15_000;

/** Typing is not a quote request; the amount settles for this long first. */
export const FLUENT_SWAP_QUOTE_DEBOUNCE_MS = 350;

/**
 * ETH left unswapped when the swap's input is the chain's own coin, so the
 * Fluent ID can still pay for the swap itself. Only needed where neither
 * sponsorship nor an ERC-20 Gas token covers the operation, but the form cannot
 * know which of those will answer before the operation is sent, so the reserve
 * is always kept.
 */
export const FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI = parseEther("0.0002");
