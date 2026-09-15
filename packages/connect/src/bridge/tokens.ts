import type { Address } from "viem";

import type { FluentWidgetNetwork } from "../core/network";

export type BridgeTokenSymbol = "ETH" | "BLEND" | "USDnr" | "USDC";

/**
 * How a token crosses. Addresses and routing mirror the Portal
 * (`frontend-monorepo/app/mainnet-landing/src/bridge`):
 *
 * - `native`     — ETH through `nativeGateway.sendNativeTokens`.
 * - `canonical`  — an ERC-20 the L1 gateway pegs onto Fluent:
 *                  `approve` → `erc20Gateway.sendTokens`. BLEND is one; its L2
 *                  address is what `computeOtherSidePeggedTokenAddress` returns.
 * - `fast-path`  — an ERC-20 that exists natively on both chains at the same
 *                  address, so the gateway cannot mint it on the other side:
 *                  `approve` → `fastPathPortal.sendToken`. USDnr is one.
 * - `swap`       — a stablecoin Fluent does not settle. It is converted to
 *                  `swapTo` on Ethereum first, at par, through the M^0 swap
 *                  facility, and *that* token is then bridged by its own route.
 *                  USDC → USDnr is the one case; it is what arrives on Fluent.
 */
export type BridgeTokenRoute = "native" | "canonical" | "fast-path" | "swap";

export type BridgeToken = {
  symbol: BridgeTokenSymbol;
  name: string;
  decimals: number;
  route: BridgeTokenRoute;
  /** Token on the source chain; absent for the native asset. */
  l1Address?: Address;
  /** Token on Fluent; absent for the native asset. For `swap`, the token that arrives. */
  l2Address?: Address;
  /** `swap` only: what the token is converted into before it is bridged. */
  swapTo?: BridgeTokenSymbol;
  /** Why it cannot be bridged on this network — shown, and the option disabled. */
  unavailableReason?: string;
};

const ETH: BridgeToken = { symbol: "ETH", name: "Ether", decimals: 18, route: "native" };

const MAINNET_ONLY = "Ethereum mainnet only";

const USDNR_MAINNET: Address = "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9";

const TOKENS_BY_NETWORK: Record<FluentWidgetNetwork, readonly BridgeToken[]> = {
  mainnet: [
    ETH,
    {
      symbol: "BLEND",
      name: "Fluent",
      decimals: 18,
      route: "canonical",
      l1Address: "0xd8a271974e8edae9d7b58e3370dc1669427503f4",
      l2Address: "0x1385B8f55A84f2BdA13EeD4099d29Eae03d553b2",
    },
    {
      symbol: "USDnr",
      name: "USDnr",
      decimals: 6,
      route: "fast-path",
      l1Address: USDNR_MAINNET,
      l2Address: USDNR_MAINNET,
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      route: "swap",
      l1Address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      l2Address: USDNR_MAINNET,
      swapTo: "USDnr",
    },
  ],
  // The Portal lists no Sepolia origin for any of these: the testnet BLEND and
  // USDnr the widget shows are L2-only mocks with nothing to bridge them from.
  testnet: [
    ETH,
    { symbol: "BLEND", name: "Fluent", decimals: 18, route: "canonical", unavailableReason: MAINNET_ONLY },
    { symbol: "USDnr", name: "USDnr", decimals: 18, route: "fast-path", unavailableReason: MAINNET_ONLY },
    { symbol: "USDC", name: "USD Coin", decimals: 6, route: "swap", swapTo: "USDnr", unavailableReason: MAINNET_ONLY },
  ],
};

export function getBridgeTokens(network: FluentWidgetNetwork): readonly BridgeToken[] {
  return TOKENS_BY_NETWORK[network];
}

export function getBridgeToken(network: FluentWidgetNetwork, symbol: BridgeTokenSymbol): BridgeToken {
  const token = TOKENS_BY_NETWORK[network].find((t) => t.symbol === symbol);
  if (!token) throw new Error(`Unknown bridge token ${symbol}`);
  return token;
}

/** The token that actually lands on Fluent — the swap target for a `swap` route, the token itself otherwise. */
export function getDeliveredToken(network: FluentWidgetNetwork, token: BridgeToken): BridgeToken {
  return token.route === "swap" && token.swapTo ? getBridgeToken(network, token.swapTo) : token;
}

export function isBridgeTokenAvailable(token: BridgeToken): boolean {
  if (token.unavailableReason) return false;
  if (token.route === "native") return true;
  if (token.route === "swap") return Boolean(token.l1Address && token.l2Address && token.swapTo);
  return Boolean(token.l1Address && token.l2Address);
}
