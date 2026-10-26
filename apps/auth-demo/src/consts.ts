import type { FluentWidgetConfig, FluentWidgetNetwork } from "@fluent.xyz/connect";

import { APP_ID, PRIVY_CLIENT_ID } from "./appConfig";

export { APP_ID, PRIVY_CLIENT_ID, FLUENT_AUTH_ISSUER } from "./appConfig";

// The Network `config/*.env` names (scripts/with-config.mjs loads it); anything else is testnet.
export const FLUENT_NETWORK: FluentWidgetNetwork =
  import.meta.env.VITE_FLUENT_WIDGET_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const FLUENT_WIDGET_CONFIG = {
  appId: APP_ID,
  privyClientId: PRIVY_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Auth Demo",
  source: "auth_demo",
} satisfies FluentWidgetConfig;
