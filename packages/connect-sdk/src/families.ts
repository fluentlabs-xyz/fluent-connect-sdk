export type FluentFamilyTier = "A" | "B" | "C" | "D";

export type FluentFamilyType =
  | "identity"
  | "tester"
  | "builder"
  | "influential"
  | "predictor";

export type FluentFamily = {
  tier: FluentFamilyTier;
  metadata?: Record<string, string>;
  lastUpdate?: string;
};

export type FluentFamilies = {
  xHandle?: string;
  families: Record<FluentFamilyType, FluentFamily>;
};

export type FluentFamiliesClientConfig = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export type FluentFamiliesClient = {
  getFamilies: (privyId: string) => Promise<FluentFamilies>;
};

type FamiliesResponse = {
  x_handle?: string;
  families: Record<FluentFamilyType, FluentFamily>;
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const parsed = body
    ? (() => {
        try {
          return JSON.parse(body) as { error?: string; message?: string };
        } catch {
          return null;
        }
      })()
    : null;
  return (parsed?.error ?? parsed?.message ?? body.trim()) || `Request failed with ${response.status}`;
}

export function createFluentFamiliesClient(
  config: FluentFamiliesClientConfig,
): FluentFamiliesClient {
  const fetcher = config.fetch ?? globalThis.fetch;
  const baseUrl = withoutTrailingSlash(config.baseUrl);

  return {
    async getFamilies(privyId: string) {
      const normalizedPrivyId = privyId.trim();
      if (!normalizedPrivyId) {
        throw new Error("Privy ID is required");
      }

      const endpoint = new URL(`${baseUrl}/profile/families/`);
      endpoint.searchParams.set("privy_id", normalizedPrivyId);
      const response = await fetcher(endpoint.toString());
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      const result = (await response.json()) as FamiliesResponse;
      return {
        xHandle: result.x_handle,
        families: result.families,
      };
    },
  };
}
