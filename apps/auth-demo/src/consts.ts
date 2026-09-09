import { resolveFluentWidgetNetworkFromEnv, type FluentWidgetConfig } from "@fluent.xyz/connect";

import { APP_ID, PRIVY_CLIENT_ID } from "./appConfig";

export { APP_ID, PRIVY_CLIENT_ID, FLUENT_AUTH_ISSUER } from "./appConfig";

export const FLUENT_NETWORK = resolveFluentWidgetNetworkFromEnv() ?? "testnet";

export const FLUENT_WIDGET_CONFIG = {
  appId: APP_ID,
  privyClientId: PRIVY_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Auth Demo",
  authMode: "direct",
  source: "auth_demo",
} satisfies FluentWidgetConfig;
