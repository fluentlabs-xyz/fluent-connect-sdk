import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import type { Address } from "viem";

import { getFluentTokenDefaults, type FluentWidgetNetwork } from "../core/network";
import {
  FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI,
  type FluentSwapContracts,
} from "./contracts";

/** One side of a Fluent swap. */
export type FluentSwapToken = {
  symbol: string;
  name: string;
  decimals: number;
  /** Absent for the chain's own coin, which trades as WETH9 inside a pool. */
  address?: Address;
};

function toFluentSwapToken(definition: FluentTokenDefinition): FluentSwapToken {
  return {
    symbol: definition.symbol,
    name: definition.name,
    decimals: definition.decimals,
    address: definition.native ? undefined : (definition.address as Address | undefined),
  };
}

/**
 * What a Fluent swap may buy or sell: the Default tokens, and nothing else.
 *
 * FluxFlow lists more pairs than these, but a Display token outside the Default
 * set is one the widget trusts less (`CONTEXT.md`, Token source) and has no
 * glyph or USD price for, so the swap stays inside the set Fluent ships —
 * which is also the set the bridge delivers into.
 */
export function getFluentSwapTokens(network: FluentWidgetNetwork): readonly FluentSwapToken[] {
  const defaults = getFluentTokenDefaults(network) as Record<string, FluentTokenDefinition>;
  return Object.values(defaults).map(toFluentSwapToken);
}

export function findFluentSwapToken(
  network: FluentWidgetNetwork,
  symbol: string | undefined,
): FluentSwapToken | undefined {
  if (!symbol) return undefined;
  return getFluentSwapTokens(network).find((token) => token.symbol === symbol);
}

export function isNativeFluentSwapToken(token: FluentSwapToken): boolean {
  return token.address === undefined;
}

/** The address a pool path names the token by: the chain's own coin trades as WETH9. */
export function getFluentSwapPathAddress(
  token: FluentSwapToken,
  contracts: FluentSwapContracts,
): Address {
  return token.address ?? contracts.weth9;
}

/**
 * Tokens a route may hop through when a pair has no direct pool. WETH9 and
 * USDnr are where FluxFlow's liquidity sits, so they are the two the Portal's
 * swap tries as well.
 */
export const FLUENT_SWAP_ROUTE_HOP_SYMBOLS: readonly string[] = ["ETH", "USDnr"];

/**
 * How much of `delivered` a swap may sell: everything, less
 * {@link FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI} when what is being sold is the
 * chain's own coin and so the only thing that could pay for the swap itself.
 * `0n` where the reserve leaves nothing — a deposit too small to swap, which
 * the form says rather than sending.
 *
 * Nothing is held back from an ERC-20: an ERC-20 never pays for gas directly,
 * and the Gas token the paymaster charges is chosen in User settings.
 *
 * @param delivered What the bridge credited, in the token's smallest unit.
 */
export function getFluentSwapInputAmount(
  delivered: bigint | undefined,
  token: FluentSwapToken | undefined,
): bigint | undefined {
  if (delivered === undefined || !token) return undefined;
  if (!isNativeFluentSwapToken(token)) return delivered;
  return delivered > FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI
    ? delivered - FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI
    : 0n;
}
