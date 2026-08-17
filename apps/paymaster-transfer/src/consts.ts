import {
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
  resolveFluentWidgetNetworkFromEnv,
  type FluentWidgetConfig,
} from "@fluent.xyz/connect";
import { parseUnits, type Address } from "viem";

const FLUENT_NETWORK = resolveFluentWidgetNetworkFromEnv() ?? "testnet";
const fluentTokenDefaults = getFluentTokenDefaults(FLUENT_NETWORK);

export const BLEND_TOKEN = {
  address: fluentTokenDefaults.BLEND.address as Address,
  symbol: "BLEND",
  decimals: 18,
};

export const ONE_BLEND = parseUnits("1", BLEND_TOKEN.decimals);
export const EXPLORER_BASE_URL = getFluentExplorerBaseUrl(FLUENT_NETWORK) ?? "https://testnet.fluentscan.xyz";

export const FLUENT_WIDGET_CONFIG = {
  clientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiAJgZ9D8Dwur",
  network: FLUENT_NETWORK,
  appName: "Fluent Paymaster Transfer",
  authMode: "direct",
  source: "paymaster_transfer_example",
  campaign: "paymaster-transfer",
} satisfies FluentWidgetConfig;
