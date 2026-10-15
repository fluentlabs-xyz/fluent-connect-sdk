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
      storage: memoryStorage(),
    });

    const status = sdk.status();
    expect(status.status).toBe("disconnected");
    expect(status.app).toMatchObject({
      mode: "origin",
      origin: "https://game.example",
    });
    expect(status.app.clientId).toBeUndefined();
    expect(status.app.installationId).toEqual(expect.any(String));
  });

  it("keeps clientId as an advanced registered-app override", () => {
    const sdk = initialize({
      network: "testnet",
      clientId: "demo_app",
      origin: "https://game.example",
      storage: memoryStorage(),
    });

    expect(sdk.status().app.mode).toBe("registered");
    expect(sdk.status().app.clientId).toBe("demo_app");
  });

  it("keeps the installation id across instances on the same storage", () => {
    const storage = memoryStorage();
    const first = initialize({ network: "testnet", origin: "https://game.example", storage });
    const second = initialize({ network: "testnet", origin: "https://game.example", storage });

    expect(second.status().app.installationId).toBe(first.status().app.installationId);
  });

  it("restores, replaces and clears the stored session", () => {
    const storage = memoryStorage();
    const sdk = initialize({ network: "testnet", origin: "https://game.example", storage });

    sdk.setSession({
      user: { id: "did:privy:abc" },
      wallet: { smartAccountAddress: "0x1111111111111111111111111111111111111111" },
      scopes: ["openid"],
      issuedAt: 1,
    });
    expect(sdk.status().status).toBe("connected");

    // A new instance on the same storage reads that session back.
    const restored = initialize({ network: "testnet", origin: "https://game.example", storage });
    expect(restored.status().session?.user.id).toBe("did:privy:abc");

    // And one on another origin refuses it: a session belongs to the App that opened it.
    const elsewhere = initialize({ network: "testnet", origin: "https://other.example", storage });
    expect(elsewhere.status().session).toBeUndefined();

    expect(sdk.disconnect().status).toBe("disconnected");
    expect(
      initialize({ network: "testnet", origin: "https://game.example", storage }).status().session,
    ).toBeUndefined();
  });
});
