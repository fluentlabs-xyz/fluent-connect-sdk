import { l1DefinitionToViemChain } from "@fluent.xyz/connect-sdk";
import { getFluentChain, getL1ForFluentChain } from "@fluent.xyz/registry";
import type { Address, Chain } from "viem";

import { getFluentChainForNetwork, type FluentWidgetNetwork } from "../core/network";
import { getBridgeIndexerUrl } from "./txHistory";

/**
 * One direction of the canonical Fluent bridge: Ethereum (or Sepolia) into
 * Fluent, paying in the chain's native ETH.
 *
 * Deliberately a single direction. Withdrawals and every non-Ethereum source
 * chain go to the Portal: a withdrawal waits on the challenge window, and the
 * other chains ride Hyperlane warp routes. Which assets cross, and how, is
 * `./tokens.ts`.
 */
export type FluentBridgeRoute = {
  source: Chain;
  destination: Chain;
  /** Bridge indexer base URL — the authority on whether a transfer landed. */
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
};

export function getFluentBridgeRoute(
  network: FluentWidgetNetwork,
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
  };
}
