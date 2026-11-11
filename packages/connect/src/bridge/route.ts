import { l1DefinitionToViemChain } from "@fluent.xyz/connect-sdk";
import { getFluentChain, getL1ForFluentChain } from "@fluent.xyz/registry";
import type { Address, Chain } from "viem";

import { getFluentWidgetNetworkEndpoints } from "../core/config";
import { getFluentChainForNetwork, type FluentWidgetNetwork } from "../core/network";
import { getBridgeIndexerUrl } from "./txHistory";

/**
 * One direction of the canonical Fluent bridge: Ethereum (Sepolia for testnet) into Fluent, the
 * direction a Deposit takes, with its fees paid in the source chain's ETH.
 *
 * Deliberately a single direction. Withdrawals and every non-Ethereum source
 * chain go to the Portal: a withdrawal waits on the challenge window, and the
 * other chains ride Hyperlane warp routes. Which assets cross, and how, is
 * `./tokens.ts`.
 */
export type FluentBridgeRoute = {
  source: Chain;
  destination: Chain;
  /** The bridge indexer's base URL: where a Deposit's history and relay outcome are read. */
  indexerUrl: string;
  /** `sendNativeTokens(recipient)` — what an ETH deposit calls. */
  nativeGateway: Address;
  /** `sendTokens(token, to, amount)` — what a canonical ERC-20 deposit calls. */
  erc20Gateway?: Address;
  /** `sendToken(...)` for tokens that live natively on both chains (USDnr). */
  fastPathPortal?: Address;
  /** M^0 facility that turns USDC into USDnr on Ethereum before it is bridged. */
  swapFacility?: Address;
  /** Prices the cross-chain message; the deposit sends it as extra `value`. */
  bridge: Address;
  /**
   * Base URL of the service that quotes and follows an Order deposit. Absent where the network
   * has none, and USDC then crosses through the swap facility and the bridge.
   */
  orderApiUrl?: string;
};

/**
 * Returns the bridge route of `network`, or `null` where the registry lacks its L1 pairing or
 * gateway.
 *
 * @param orderDepositUrl The widget's resolved `orderDepositUrl`. A caller that only needs the
 * chains leaves it out and gets the network default.
 */
export function getFluentBridgeRoute(
  network: FluentWidgetNetwork,
  orderDepositUrl: string = getFluentWidgetNetworkEndpoints(network).orderDepositUrl,
): FluentBridgeRoute | null {
  const destination = getFluentChainForNetwork(network);
  const definition = getFluentChain(network === "mainnet" ? "mainnet" : "testnet");
  const l1 = getL1ForFluentChain(definition);
  const nativeGateway = l1?.contracts?.nativeGateway?.address;
  const bridge = l1?.contracts?.fluentBridge?.address;
  const erc20Gateway = l1?.contracts?.erc20Gateway?.address as Address | undefined;
  const fastPathPortal = l1?.contracts?.fastPathPortal?.address as Address | undefined;
  const swapFacility = l1?.contracts?.swapFacility?.address as Address | undefined;

  // A network whose L1 pairing or gateway the registry does not carry has no
  // route to offer — the page says so rather than rendering a form that cannot
  // submit.
  if (!l1 || !nativeGateway || !bridge) return null;

  return {
    source: l1DefinitionToViemChain(l1),
    destination,
    indexerUrl: getBridgeIndexerUrl(network),
    nativeGateway: nativeGateway as Address,
    erc20Gateway,
    fastPathPortal,
    swapFacility,
    bridge: bridge as Address,
    orderApiUrl: orderDepositUrl || undefined,
  };
}
