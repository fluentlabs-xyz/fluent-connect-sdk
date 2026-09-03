import {
  fluentMainnet,
  fluentTestnet,
  getFluentTokenDefaultsForNetwork,
} from "@fluent.xyz/connect-sdk";
import type { Chain } from "viem";

export type FluentWidgetNetwork = "testnet" | "mainnet";

export const FLUENT_WIDGET_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "wallet",
  "faucet",
  "families:read",
];

const FLUENT_WIDGET_MAINNET_SCOPES = ["openid", "profile", "wallet", "families:read"];

export function isFaucetNetwork(network: FluentWidgetNetwork) {
  return network === "testnet";
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
    default:
      return fluentTestnet;
  }
}

export function getFluentTokenDefaults(network: FluentWidgetNetwork) {
  return getFluentTokenDefaultsForNetwork(network);
}

export function getFluentExplorerBaseUrl(network: FluentWidgetNetwork) {
  return getFluentChainForNetwork(network).blockExplorers?.default.url;
}
