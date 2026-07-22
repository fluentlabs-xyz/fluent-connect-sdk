import { describe, expect, it, vi } from "vitest";

import { createFluentFamiliesClient } from "./families.js";

describe("createFluentFamiliesClient", () => {
  it("loads families from the reputation service by Privy ID", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://public.example/api/v1/profile/families/?privy_id=did%3Aprivy%3Auser-1",
      );
      return new Response(
        JSON.stringify({
          families: {
            identity: { tier: "A", metadata: { score: "96" } },
            tester: { tier: "B", metadata: {} },
            builder: { tier: "A", metadata: { projects: "4" } },
            influential: { tier: "C", metadata: {} },
            predictor: { tier: "D", metadata: {} },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const client = createFluentFamiliesClient({
      baseUrl: "https://public.example/api/v1/",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      client.getFamilies("did:privy:user-1"),
    ).resolves.toMatchObject({
      families: {
        identity: { tier: "A", metadata: { score: "96" } },
        builder: { tier: "A", metadata: { projects: "4" } },
      },
    });
  });

  it("requires a lookup identifier before making the request", async () => {
    const fetcher = vi.fn();
    const client = createFluentFamiliesClient({
      baseUrl: "https://public.example/api/v1",
      fetch: fetcher as typeof fetch,
    });

    await expect(client.getFamilies(" ")).rejects.toThrow(
      "Privy ID is required",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces plain-text service errors", async () => {
    const client = createFluentFamiliesClient({
      baseUrl: "https://public.example/api/v1",
      fetch: vi.fn(async () => new Response("user not found", { status: 404 })) as typeof fetch,
    });

    await expect(client.getFamilies("did:privy:missing")).rejects.toThrow("user not found");
  });
});
