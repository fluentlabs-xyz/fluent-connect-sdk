import { createFluentClient, fluentTestnet } from "@fluent/wallet-sdk";
import type { FluentWidgetConfig } from "@fluent/react";
import { http } from "viem";
import appConfig from "../config.json";

export const FLUENT_WIDGET_APP_CONFIG = appConfig.fluent as FluentWidgetConfig;
export const STBLEND_VAULT_ADDRESS = appConfig.vault.address as `0x${string}`;
export const STBLEND_IMPLEMENTATION_ADDRESS = appConfig.vault.implementationAddress as `0x${string}`;
export const STBLEND_ASSET_ADDRESS = appConfig.vault.assetAddress as `0x${string}` | null;

export const vaultFluentClient = createFluentClient({
  chain: fluentTestnet,
  transport: http(import.meta.env.VITE_FLUENT_RPC_URL),
});
export const vaultPublicClient = vaultFluentClient.public;
