import type { FluentWidgetNetwork } from "./network";

const FLUENT_NETWORK_ENV_KEYS = [
  "VITE_FLUENT_WIDGET_NETWORK",
  "FLUENT_NETWORK",
] as const;

const FLUENT_NETWORK_ALIASES: Record<string, FluentWidgetNetwork> = {
  testnet: "testnet",
  mainnet: "mainnet",
  development: "testnet",
  dev: "testnet",
  production: "mainnet",
  prod: "mainnet",
};

function readFluentNetworkEnvValue(): string | undefined {
  for (const key of FLUENT_NETWORK_ENV_KEYS) {
    const fromProcess = typeof process !== "undefined" ? process.env?.[key] : undefined;
    if (fromProcess?.trim()) return fromProcess.trim();

    const fromImportMeta = readImportMetaEnv(key);
    if (fromImportMeta?.trim()) return fromImportMeta.trim();
  }
  return undefined;
}

function readImportMetaEnv(key: string): string | undefined {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

export function normalizeFluentWidgetNetwork(
  value: string | undefined,
): FluentWidgetNetwork | undefined {
  if (!value) return undefined;
  return FLUENT_NETWORK_ALIASES[value.trim().toLowerCase()];
}

/** Reads `VITE_FLUENT_WIDGET_NETWORK` / `FLUENT_NETWORK` (`testnet`, `mainnet`, `dev`, `prod`, …). */
export function resolveFluentWidgetNetworkFromEnv(): FluentWidgetNetwork | undefined {
  return normalizeFluentWidgetNetwork(readFluentNetworkEnvValue());
}
