import { fluentTestnetTokenDefaults } from "@fluent.xyz/connect-sdk";
import { parseUnits, type Address } from "viem";
import type { FluentWidgetConfig } from "@fluent.xyz/connect";

export const BLEND_TOKEN = {
  address: fluentTestnetTokenDefaults.BLEND.address as Address,
  symbol: "BLEND",
  decimals: 18,
};

export const ONE_BLEND = parseUnits("1", BLEND_TOKEN.decimals);
export const EXPLORER_BASE_URL = "https://testnet.fluentscan.xyz";

export const FLUENT_WIDGET_CONFIG = {
  network: "testnet",
  appName: "Fluent Paymaster Transfer",
  authMode: "direct",
  source: "paymaster_transfer_example",
  campaign: "paymaster-transfer",
} satisfies FluentWidgetConfig;
