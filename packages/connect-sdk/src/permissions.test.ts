import { describe, expect, it, vi } from "vitest";

import {
  createFluentPermissionClient,
  type FluentPermissionGrant,
} from "./permissions.js";

const grant: FluentPermissionGrant = {
  id: "grant_1",
  appId: "game_xyz",
  clientId: "demo_app",
  userId: "did:privy:user",
  walletAddress: "0x0000000000000000000000000000000000000001",
  origin: "http://localhost:8050",
  status: "active",
  expiry: 2_000_000_000,
  permissions: {
    calls: [
      {
        chainId: 20994,
        to: "0x0000000000000000000000000000000000000002",
        function: "executeMove(uint256)",
      },
    ],
    spend: [],
  },
  createdAt: 1_900_000_000,
};

describe("createFluentPermissionClient", () => {
  it("sends the Fluent session when creating a grant", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fluent-session",
      });
      return new Response(JSON.stringify(grant), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createFluentPermissionClient({
      baseUrl: "https://connect.example/",
      clientId: "demo_app",
      getSessionToken: () => "fluent-session",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      client.grant({
        appId: "game_xyz",
        expiry: Math.floor(Date.now() / 1000) + 3600,
        permissions: grant.permissions,
      }),
    ).resolves.toEqual(grant);
  });

  it("rejects an empty policy before calling the service", async () => {
    const fetcher = vi.fn();
    const client = createFluentPermissionClient({
      baseUrl: "https://connect.example",
      clientId: "demo_app",
      getSessionToken: () => "fluent-session",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      client.grant({
        appId: "game_xyz",
        expiry: Math.floor(Date.now() / 1000) + 3600,
        permissions: { calls: [], spend: [] },
      }),
    ).rejects.toThrow("at least one call or spend permission is required");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
