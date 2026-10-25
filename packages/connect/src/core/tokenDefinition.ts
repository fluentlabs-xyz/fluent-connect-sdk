import type { Address } from "viem";

/**
 * A token a host adds to the list the widget shows: an Integrator token. It describes the token
 * and grants nothing — whether a token can pay for gas is a property only Default tokens have
 * (ADR 0001), so the widget would strip any such field from a host's token anyway.
 */
export type FluentTokenDefinition = {
  /** The chain the token lives on; a token of another chain than the widget's is not shown. */
  chainId: number;
  /** The token's contract address; absent for the chain's native token. */
  address?: Address;
  name: string;
  symbol: string;
  decimals: number;
  /** An image for the token, a URL or a data URI. */
  logoURI?: string;
};
