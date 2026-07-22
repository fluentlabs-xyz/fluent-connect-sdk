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
