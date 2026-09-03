import { resolveFluentWidgetNetworkFromEnv, type FluentWidgetConfig } from "@fluent.xyz/connect";

import { PARTNER_ID, PRIVY_CLIENT_ID } from "./partnerConfig";

export { PARTNER_ID, PRIVY_CLIENT_ID, FLUENT_AUTH_ISSUER } from "./partnerConfig";

export const FLUENT_NETWORK = resolveFluentWidgetNetworkFromEnv() ?? "testnet";

export const FLUENT_WIDGET_CONFIG = {
  partnerId: PARTNER_ID,
  privyClientId: PRIVY_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Auth Demo",
  authMode: "direct",
  source: "auth_demo",
} satisfies FluentWidgetConfig;
