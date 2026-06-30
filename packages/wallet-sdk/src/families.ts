export type FluentFamilyTier = "A" | "B" | "C" | "D";

export type FluentFamilyType =
  | "identity"
  | "tester"
  | "builder"
  | "influential"
  | "predictor";

export type FluentFamily = {
  tier: FluentFamilyTier;
  lastUpdate: string;
};

export type FluentFamilies = {
  xHandle: string;
  families: Record<FluentFamilyType, FluentFamily>;
};

export type FluentFamiliesClientConfig = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export type FluentFamiliesClient = {
  getFamilies: (identifier: string) => Promise<FluentFamilies>;
};

type FamiliesResponse = {
  x_handle: string;
  families: Record<FluentFamilyType, FluentFamily>;
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  return body?.error ?? body?.message ?? `Request failed with ${response.status}`;
}

export function createFluentFamiliesClient(
  config: FluentFamiliesClientConfig,
): FluentFamiliesClient {
  const fetcher = config.fetch ?? globalThis.fetch;
  const baseUrl = withoutTrailingSlash(config.baseUrl);

  return {
    async getFamilies(identifier: string) {
      const normalizedIdentifier = identifier.trim();
      if (!normalizedIdentifier) {
        throw new Error("Wallet address, Privy ID, or X handle is required");
      }

      const endpoint = new URL(`${baseUrl}/families/`);
      endpoint.searchParams.set("id", normalizedIdentifier);
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
