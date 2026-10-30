import { describe, expect, it, vi } from "vitest";

import { initialize, type StorageLike } from "./index.js";

/** The key of the session copy this SDK no longer keeps (FLU-1638). */
const SESSION_KEY = "fluent:connect:session:v1";

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

  it("keeps the session in memory only: a fresh instance on its storage is disconnected", () => {
    const storage = memoryStorage();
    const sdk = initialize({ network: "testnet", origin: "https://game.example", storage });

    sdk.setSession({
      user: { id: "did:privy:abc" },
      wallet: { smartAccountAddress: "0x1111111111111111111111111111111111111111" },
      scopes: ["openid"],
      issuedAt: 1,
    });
    expect(sdk.status().status).toBe("connected");
    expect(sdk.status().session?.user.id).toBe("did:privy:abc");

    // A second setSession replaces the first, in memory.
    sdk.setSession({
      user: { id: "did:privy:def" },
      wallet: { smartAccountAddress: "0x2222222222222222222222222222222222222222" },
      scopes: ["openid"],
      issuedAt: 2,
    });
    expect(sdk.status().session?.user.id).toBe("did:privy:def");

    // Nothing of the session reached storage, so a new instance on it starts disconnected.
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    const fresh = initialize({ network: "testnet", origin: "https://game.example", storage });
    expect(fresh.status().status).toBe("disconnected");
    expect(fresh.status().session).toBeUndefined();

    expect(sdk.disconnect().status).toBe("disconnected");
    expect(sdk.status().session).toBeUndefined();

    // Nor does a session an earlier version stored for this very origin come back.
    const seeded = memoryStorage({
      [SESSION_KEY]: JSON.stringify({
        app: { mode: "origin", origin: "https://game.example", installationId: "old" },
        user: { id: "did:privy:abc" },
        wallet: {},
        scopes: ["openid"],
        issuedAt: 1,
      }),
    });
    const reloaded = initialize({
      network: "testnet",
      origin: "https://game.example",
      storage: seeded,
    });
    expect(reloaded.status().status).toBe("disconnected");
    expect(reloaded.status().session).toBeUndefined();
  });

  it("removes a fluent:connect:session:v1 value an earlier page load left", () => {
    const storage = memoryStorage({
      [SESSION_KEY]: JSON.stringify({
        app: { mode: "origin", origin: "https://game.example", installationId: "old" },
        user: { id: "did:privy:abc" },
        wallet: { smartAccountAddress: "0x1111111111111111111111111111111111111111" },
        scopes: ["openid"],
        issuedAt: 1,
        idToken: "old.identity.token",
      }),
    });
    const removeItem = vi.spyOn(storage, "removeItem");

    const sdk = initialize({ network: "testnet", origin: "https://game.example", storage });

    expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(sdk.status().status).toBe("disconnected");
    expect(sdk.status().session).toBeUndefined();
  });

  it("initializes disconnected when the storage refuses to remove the old session key", () => {
    const removeItem = vi.fn((_key: string) => {
      throw new Error("blocked site data");
    });
    const storage: StorageLike = {
      ...memoryStorage({ [SESSION_KEY]: "{}" }),
      removeItem,
    };

    const sdk = initialize({ network: "testnet", origin: "https://game.example", storage });

    // The removal was attempted, and its refusal cost nothing but the removal itself.
    expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
    expect(sdk.status().status).toBe("disconnected");
    expect(sdk.status().app.origin).toBe("https://game.example");
  });
});
