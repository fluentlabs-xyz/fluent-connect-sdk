import {
  fluentMainnet,
  fluentTestnet,
  getFluentTokenDefaultsForNetwork,
} from "@fluent.xyz/connect-sdk";
import type { Chain } from "viem";

/** Which of Fluent's two deployments the widget runs on. */
export type FluentWidgetNetwork = "testnet" | "mainnet";

export const FLUENT_WIDGET_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "wallet",
  "faucet",
  "families:read",
];

const FLUENT_WIDGET_MAINNET_SCOPES = ["openid", "profile", "wallet", "families:read"];

/** What `normalizeFluentWidgetNetwork` accepts for each Network, lowercased. */
const FLUENT_NETWORK_ALIASES: Record<string, FluentWidgetNetwork> = {
  testnet: "testnet",
  mainnet: "mainnet",
  development: "testnet",
  dev: "testnet",
  production: "mainnet",
  prod: "mainnet",
};

/**
 * Returns the Network an App's own setting names, for an App that reads it from its environment and
 * passes it as `FluentWidgetConfig.network`: `"testnet"`, `"mainnet"`, `"dev"`, `"development"`,
 * `"prod"` and `"production"`, trimmed and in any case; `undefined` for anything else, an empty
 * value included. The widget itself reads no environment variable.
 *
 * @example
 * ```ts
 * import { normalizeFluentWidgetNetwork } from "@fluent.xyz/connect/internal";
 *
 * const network = normalizeFluentWidgetNetwork("Production") ?? "testnet";
 * ```
 */
export function normalizeFluentWidgetNetwork(
  value: string | undefined | null,
): FluentWidgetNetwork | undefined {
  if (!value) return undefined;
  return FLUENT_NETWORK_ALIASES[value.trim().toLowerCase()];
}

/**
 * Reports whether the Network has a faucet: testnet does, mainnet does not.
 *
 * @example
 * ```ts
 * import { isFaucetNetwork } from "@fluent.xyz/connect/internal";
 *
 * const showFaucetLink = isFaucetNetwork("testnet"); // true
 * ```
 */
export function isFaucetNetwork(network: FluentWidgetNetwork) {
  return network === "testnet";
}

export function getFluentWidgetDefaultScopes(network: FluentWidgetNetwork) {
  return isFaucetNetwork(network) ? FLUENT_WIDGET_DEFAULT_SCOPES : FLUENT_WIDGET_MAINNET_SCOPES;
}

/**
 * Returns the viem chain of a Network, for an App's own chain config.
 *
 * @example
 * ```ts
 * import { getFluentChainForNetwork } from "@fluent.xyz/connect";
 *
 * export const chain = getFluentChainForNetwork("mainnet"); // chain.id === 25363
 * ```
 */
export function getFluentChainForNetwork(network: FluentWidgetNetwork): Chain {
  switch (network) {
    case "mainnet":
      return fluentMainnet;
    default:
      return fluentTestnet;
  }
}

/**
 * Returns the Network a Fluent chain id belongs to. The pair is closed, `fluentMainnet` and
 * `fluentTestnet`, so an id that is neither resolves to `"testnet"`, as `getFluentChainForNetwork`
 * does in the other direction.
 */
export function getFluentWidgetNetworkForChainId(chainId: number): FluentWidgetNetwork {
  return chainId === fluentMainnet.id ? "mainnet" : "testnet";
}

export function getFluentTokenDefaults(network: FluentWidgetNetwork) {
  return getFluentTokenDefaultsForNetwork(network);
}

/**
 * Returns the Network's block explorer URL, or `undefined` when its chain names none.
 *
 * @example
 * ```ts
 * import { getFluentExplorerBaseUrl } from "@fluent.xyz/connect/internal";
 *
 * const explorer = getFluentExplorerBaseUrl("mainnet"); // "https://fluentscan.xyz"
 * ```
 */
export function getFluentExplorerBaseUrl(network: FluentWidgetNetwork) {
  return getFluentChainForNetwork(network).blockExplorers?.default.url;
}
