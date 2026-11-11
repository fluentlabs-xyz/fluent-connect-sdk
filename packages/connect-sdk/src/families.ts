/** The tier the service assigns a person within one family. */
export type FluentFamilyTier = "A" | "B" | "C" | "D";

/** The families the service scores a person in. */
export type FluentFamilyType =
  | "identity"
  | "tester"
  | "builder"
  | "influential"
  | "predictor";

/** One family's score for a person: the tier, the service's metadata and its last change. */
export type FluentFamily = {
  tier: FluentFamilyTier;
  metadata?: Record<string, string>;
  lastUpdate?: string;
};

/** The service's families answer for one person: the X handle it knows, and every family. */
export type FluentFamilies = {
  xHandle?: string;
  families: Record<FluentFamilyType, FluentFamily>;
};

/** The service's base URL and, for a test, the `fetch` to call it with. */
export type FluentFamiliesClientConfig = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

/** A client of one person's families, read by their Privy DID; see `createFluentFamiliesClient`. */
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

/**
 * Creates a client of the service's families endpoint,
 * `GET <baseUrl>/profile/families/?privy_id=<id>`. `getFamilies` throws an `Error` with the
 * service's message, or `Request failed with <status>` when it sends none, for a response that
 * is not `ok`, and an `Error` "Privy ID is required" for a blank id without calling the service.
 *
 * @example
 * ```ts
 * import { createFluentFamiliesClient } from "@fluent.xyz/connect/internal";
 *
 * const client = createFluentFamiliesClient({ baseUrl: "https://api.example.com" });
 * const { families } = await client.getFamilies("did:privy:example");
 * ```
 */
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
