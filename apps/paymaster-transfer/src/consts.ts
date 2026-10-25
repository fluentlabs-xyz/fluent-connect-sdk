import type { FluentWidgetConfig, FluentWidgetNetwork } from "@fluent.xyz/connect";
import {
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
} from "@fluent.xyz/connect/internal/network";
import { parseUnits, type Address } from "viem";

// The Network `config/*.env` names (scripts/with-config.mjs loads it); anything else is testnet.
const FLUENT_NETWORK: FluentWidgetNetwork =
  import.meta.env.VITE_FLUENT_WIDGET_NETWORK === "mainnet" ? "mainnet" : "testnet";
const fluentTokenDefaults = getFluentTokenDefaults(FLUENT_NETWORK);

export const BLEND_TOKEN = {
  address: fluentTokenDefaults.BLEND.address as Address,
  symbol: "BLEND",
  decimals: 18,
};

export const ONE_BLEND = parseUnits("1", BLEND_TOKEN.decimals);
export const EXPLORER_BASE_URL = getFluentExplorerBaseUrl(FLUENT_NETWORK) ?? "https://testnet.fluentscan.xyz";

export const FLUENT_WIDGET_CONFIG = {
  // "Paymaster transfer" dev App (origin http://localhost:8051).
  appId: "app_ad6a11c73295efc3728c0f578d18f815",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiAJgZ9D8Dwur",
  network: FLUENT_NETWORK,
  appName: "Fluent Paymaster Transfer",
  source: "paymaster_transfer_example",
  campaign: "paymaster-transfer",
} satisfies FluentWidgetConfig;
