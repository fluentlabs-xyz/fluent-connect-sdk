export type FluentPermissionStatus =
  | "pending"
  | "active"
  | "expired"
  | "revoked";

export type FluentCallPermission = {
  chainId: number;
  to: `0x${string}`;
  function?: string;
  selector?: `0x${string}`;
};

export type FluentSpendPeriod = "transaction" | "hour" | "day" | "session";

export type FluentSpendPermission = {
  chainId: number;
  token: `0x${string}` | "native";
  symbol?: string;
  limit: string;
  period: FluentSpendPeriod;
  recipients?: `0x${string}`[];
};

export type FluentPermissionPolicy = {
  calls: FluentCallPermission[];
  spend: FluentSpendPermission[];
};

export type FluentPermissionGrantRequest = {
  appId: string;
  expiry: number;
  permissions: FluentPermissionPolicy;
};

export type FluentPermissionGrant = {
  id: string;
  appId: string;
  clientId: string;
  userId: string;
  walletAddress?: `0x${string}`;
  origin: string;
  status: FluentPermissionStatus;
  expiry: number;
  permissions: FluentPermissionPolicy;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

export type FluentPermissionPreview = {
  request: FluentPermissionGrantRequest;
  effectivePolicy: FluentPermissionPolicy;
  warnings: string[];
};

export type FluentPermissionClientConfig = {
  baseUrl: string;
  clientId: string;
  getSessionToken: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
};

export type FluentPermissionClient = {
  preview: (
    request: FluentPermissionGrantRequest,
  ) => Promise<FluentPermissionPreview>;
  grant: (
    request: FluentPermissionGrantRequest,
  ) => Promise<FluentPermissionGrant>;
  list: () => Promise<FluentPermissionGrant[]>;
  revoke: (grantId: string) => Promise<FluentPermissionGrant>;
};

type PermissionListResponse = {
  grants: FluentPermissionGrant[];
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertRequest(request: FluentPermissionGrantRequest): void {
  const now = Math.floor(Date.now() / 1000);
  if (!request.appId.trim()) {
    throw new Error("appId is required");
  }
  if (!Number.isSafeInteger(request.expiry) || request.expiry <= now) {
    throw new Error("expiry must be a future Unix timestamp");
  }
  if (
    request.permissions.calls.length === 0 &&
    request.permissions.spend.length === 0
  ) {
    throw new Error("at least one call or spend permission is required");
  }
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as
    | { error?: string; message?: string }
    | null;
  return body?.error ?? body?.message ?? `Request failed with ${response.status}`;
}

export function createFluentPermissionClient(
  config: FluentPermissionClientConfig,
): FluentPermissionClient {
  const fetcher = config.fetch ?? globalThis.fetch;
  const baseUrl = withoutTrailingSlash(config.baseUrl);

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const sessionToken = await config.getSessionToken();
    if (!sessionToken) {
      throw new Error("Fluent session token is required");
    }

    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return response.json() as Promise<T>;
  }

  return {
    async preview(grantRequest) {
      assertRequest(grantRequest);
      return request<FluentPermissionPreview>(
        "/v1/permission-grants/preview",
        {
          method: "POST",
          body: JSON.stringify({
            ...grantRequest,
            clientId: config.clientId,
          }),
        },
      );
    },
    async grant(grantRequest) {
      assertRequest(grantRequest);
      return request<FluentPermissionGrant>("/v1/permission-grants", {
        method: "POST",
        body: JSON.stringify({
          ...grantRequest,
          clientId: config.clientId,
        }),
      });
    },
    async list() {
      const response = await request<PermissionListResponse>(
        `/v1/permission-grants?clientId=${encodeURIComponent(config.clientId)}`,
      );
      return response.grants;
    },
    revoke(grantId) {
      if (!grantId) {
        return Promise.reject(new Error("grantId is required"));
      }
      return request<FluentPermissionGrant>(
        `/v1/permission-grants/${encodeURIComponent(grantId)}/revoke`,
        { method: "POST", body: "{}" },
      );
    },
  };
}
