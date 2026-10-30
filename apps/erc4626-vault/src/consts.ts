import { createFluentClient } from "@fluent.xyz/connect-sdk";
import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import appConfig from "../config.json";
import { APP_ID, PRIVY_CLIENT_ID } from "./appCredentials";

// config.json's appId is the "ERC4626 vault" dev App; a mainnet run overrides
// both ids from the environment — see `appCredentials.ts`.
export const FLUENT_WIDGET_APP_CONFIG = {
  ...appConfig.fluent,
  appId: APP_ID,
  privyClientId: PRIVY_CLIENT_ID,
} as FluentWidgetConfig;
export const STBLEND_VAULT_ADDRESS = appConfig.vault.address as `0x${string}`;
export const STBLEND_IMPLEMENTATION_ADDRESS = appConfig.vault.implementationAddress as `0x${string}`;
export const STBLEND_ASSET_ADDRESS = appConfig.vault.assetAddress as `0x${string}` | null;

export const vaultFluentClient = createFluentClient({
  network: "testnet",
});
/** Chain the vault reads/writes target. Also used for external-wallet execution. */
export const vaultChain = vaultFluentClient.chain;
export const vaultPublicClient = vaultFluentClient.public;
