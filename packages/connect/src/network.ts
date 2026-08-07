import {
  fluentDevnet,
  fluentMainnet,
  fluentTestnet,
  getFluentDefaultWidgetGasTokens,
  getFluentTokenDefaultsForNetwork,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import type { Chain } from "viem";

export type FluentWidgetNetwork = "devnet" | "testnet" | "mainnet";

export const FLUENT_WIDGET_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "wallet",
  "faucet",
  "families:read",
];

const FLUENT_WIDGET_MAINNET_SCOPES = ["openid", "profile", "wallet", "families:read"];

export function isFaucetNetwork(network: FluentWidgetNetwork) {
  return network === "devnet" || network === "testnet";
}

export function getFluentWidgetDefaultScopes(network: FluentWidgetNetwork) {
  return isFaucetNetwork(network)
    ? FLUENT_WIDGET_DEFAULT_SCOPES
    : FLUENT_WIDGET_MAINNET_SCOPES;
}

export function getFluentChainForNetwork(network: FluentWidgetNetwork): Chain {
  switch (network) {
    case "mainnet":
      return fluentMainnet;
    case "devnet":
      return fluentDevnet;
    default:
      return fluentTestnet;
  }
}

export function getFluentTokenDefaults(network: FluentWidgetNetwork) {
  return getFluentTokenDefaultsForNetwork(network);
}

export function getFluentDefaultGasTokens(
  network: FluentWidgetNetwork,
): readonly FluentTokenDefinition[] {
  return getFluentDefaultWidgetGasTokens(network);
}

export function getFluentErc20PaymasterTokenAddresses(network: FluentWidgetNetwork) {
  const defaults = getFluentTokenDefaults(network);
  return {
    BLEND: defaults.BLEND.address,
    USDnr: defaults.USDnr.address,
  };
}

export function getFluentExplorerBaseUrl(network: FluentWidgetNetwork) {
  return getFluentChainForNetwork(network).blockExplorers?.default.url;
}
