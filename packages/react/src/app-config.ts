import { useEffect, useMemo, useState } from "react";

export type FluentAppEnabledFeatures = {
  identity?: boolean;
  wallet?: boolean;
  faucet?: boolean;
  bridge?: boolean;
  balances?: boolean;
  analytics?: boolean;
  onramp?: boolean;
  families?: boolean;
  gasless?: boolean;
};

export type FluentAppConfig = {
  clientId: string;
  name?: string;
  allowedOrigins?: string[];
  allowedRedirectUrls?: string[];
  enabledScopes?: string[];
  enabledFeatures?: FluentAppEnabledFeatures;
  displayConfig?: Record<string, unknown>;
  faucetConfig?: Record<string, unknown>;
  tokenConfig?: Record<string, unknown>;
  bridgeConfig?: Record<string, unknown>;
  campaignMetadata?: Record<string, unknown>;
};

export type FetchFluentAppConfigParams = {
  clientId: string;
  endpoint: string;
  signal?: AbortSignal;
};

export type UseFluentAppConfigResult = {
  config: FluentAppConfig | null;
  loading: boolean;
  error: Error | null;
};

function appConfigUrl(endpoint: string, clientId: string): string {
  if (endpoint.includes(":clientId")) {
    return endpoint.replace(":clientId", encodeURIComponent(clientId));
  }

  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  if (base.endsWith(`/widget/apps/${clientId}`)) return base;
  if (base.endsWith("/widget/apps")) return `${base}/${encodeURIComponent(clientId)}`;
  return `${base}/widget/apps/${encodeURIComponent(clientId)}`;
}

export async function fetchFluentAppConfig({
  clientId,
  endpoint,
  signal,
}: FetchFluentAppConfigParams): Promise<FluentAppConfig> {
  const response = await fetch(appConfigUrl(endpoint, clientId), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Could not load Fluent app config: ${response.status}`);
  }

  return response.json() as Promise<FluentAppConfig>;
}

export function useFluentAppConfig(
  clientId: string,
  endpoint?: string,
): UseFluentAppConfigResult {
  const [config, setConfig] = useState<FluentAppConfig | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(endpoint));

  const stableEndpoint = useMemo(() => endpoint?.trim() || "", [endpoint]);

  useEffect(() => {
    if (!stableEndpoint) {
      setConfig(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchFluentAppConfig({
      clientId,
      endpoint: stableEndpoint,
      signal: controller.signal,
    })
      .then((nextConfig) => {
        setConfig(nextConfig);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setConfig(null);
        setError(err instanceof Error ? err : new Error("Could not load Fluent app config"));
        setLoading(false);
      });

    return () => controller.abort();
  }, [clientId, stableEndpoint]);

  return { config, loading, error };
}

