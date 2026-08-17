import { createFluentClient } from "@fluent.xyz/connect-sdk";
import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import appConfig from "../config.json";

export const FLUENT_WIDGET_APP_CONFIG = appConfig.fluent as FluentWidgetConfig;
export const STBLEND_VAULT_ADDRESS = appConfig.vault.address as `0x${string}`;
export const STBLEND_IMPLEMENTATION_ADDRESS = appConfig.vault.implementationAddress as `0x${string}`;
export const STBLEND_ASSET_ADDRESS = appConfig.vault.assetAddress as `0x${string}` | null;

export const vaultFluentClient = createFluentClient({
  network: "testnet",
});
/** Chain the vault reads/writes target. Also used for external-wallet execution. */
export const vaultChain = vaultFluentClient.chain;
export const vaultPublicClient = vaultFluentClient.public;
