import { describe, expect, it, vi } from "vitest";

import { createFluentFamiliesClient } from "./families.js";

describe("createFluentFamiliesClient", () => {
  it("loads families from the public service by wallet address", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://public.example/api/v1/families/?id=0x0000000000000000000000000000000000000001",
      );
      return new Response(
        JSON.stringify({
          x_handle: "fluent_builder",
          families: {
            identity: { tier: "A", lastUpdate: "2026-06-25T10:00:00Z" },
            tester: { tier: "B", lastUpdate: "2026-06-25T10:00:00Z" },
            builder: { tier: "A", lastUpdate: "2026-06-25T10:00:00Z" },
            influential: { tier: "C", lastUpdate: "2026-06-25T10:00:00Z" },
            predictor: { tier: "D", lastUpdate: "2026-06-25T10:00:00Z" },
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
      client.getFamilies("0x0000000000000000000000000000000000000001"),
    ).resolves.toMatchObject({
      xHandle: "fluent_builder",
      families: {
        identity: { tier: "A" },
        builder: { tier: "A" },
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
      "Wallet address, Privy ID, or X handle is required",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
