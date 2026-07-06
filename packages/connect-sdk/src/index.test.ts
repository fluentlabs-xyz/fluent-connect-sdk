import { describe, expect, it } from "vitest";

import { initialize, type StorageLike } from "./index.js";

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("Fluent Connect initialize", () => {
  it("derives app identity from origin without requiring clientId", () => {
    const sdk = initialize({
      network: "testnet",
      origin: "https://game.example",
      redirectUri: "https://game.example/play",
      storage: memoryStorage(),
    });

    const status = sdk.status();
    expect(status.app).toMatchObject({
      mode: "origin",
      origin: "https://game.example",
    });
    expect(status.app.clientId).toBeUndefined();

    const authorizeUrl = sdk.buildAuthorizeUrl("state-1");
    expect(authorizeUrl.searchParams.get("origin")).toBe("https://game.example");
    expect(authorizeUrl.searchParams.get("client_id")).toBeNull();
    expect(authorizeUrl.searchParams.get("state")).toBe("state-1");
  });

  it("keeps clientId as an advanced registered-app override", () => {
    const sdk = initialize({
      network: "testnet",
      clientId: "demo_app",
      origin: "https://game.example",
      redirectUri: "https://game.example/play",
      storage: memoryStorage(),
    });

    expect(sdk.status().app.mode).toBe("registered");
    expect(sdk.buildAuthorizeUrl("state-2").searchParams.get("client_id")).toBe("demo_app");
  });
});
