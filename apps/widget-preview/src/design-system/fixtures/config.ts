import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import { resolveFluentWidgetNetworkFromEnv } from "@fluent.xyz/connect";

/**
 * Auth demo dev App, as the other preview pages use: this page never signs in
 * or sponsors, the config only has to resolve.
 */
export const previewConfig: FluentWidgetConfig = {
  appId: "app_8908941315934a06b738c6804ce26132",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1",
  network: resolveFluentWidgetNetworkFromEnv() ?? "testnet",
  appName: "Fluent Widget Preview",
};

export const previewNetwork = previewConfig.network ?? "testnet";

export function noop() {}
