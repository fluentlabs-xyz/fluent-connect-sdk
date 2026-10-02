import { describe, expect, it, vi } from "vitest";
import type { StorageLike } from "@fluent.xyz/connect-sdk";

import {
  forgetRefreshCredential,
  isRefreshCredentialUsable,
  loadRefreshCredential,
  refreshCredentialStorageKey,
  resolveRefreshCredentialStorage,
  saveRefreshCredential,
} from "./refreshCredentialStore";
import { FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX } from "./storageKeys";

const KEY = refreshCredentialStorageKey("https://api.example/api/v1|app_a|wallet:0xabc");
const FAMILY_EXPIRY = 1_790_000_000;
const CREDENTIAL = { refreshToken: "opaque-refresh", refreshExpiresAt: FAMILY_EXPIRY };

function memoryStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

describe("refreshCredentialStorageKey", () => {
  it("carries the service, the App and the subject the cache key names", () => {
    expect(KEY).toBe(
      `${FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX}|https://api.example/api/v1|app_a|wallet:0xabc`,
    );
  });

  it("separates two subjects, two Apps and two services", () => {
    const keys = new Set([
      refreshCredentialStorageKey("https://api.example/api/v1|app_a|wallet:0xabc"),
      refreshCredentialStorageKey("https://api.example/api/v1|app_a|wallet:0xdef"),
      refreshCredentialStorageKey("https://api.example/api/v1|app_b|wallet:0xabc"),
      refreshCredentialStorageKey("https://other.example/api/v1|app_a|wallet:0xabc"),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("loadRefreshCredential", () => {
  it("reads back what was written", () => {
    const storage = memoryStorage();
    expect(saveRefreshCredential(storage, KEY, CREDENTIAL)).toBe(true);
    expect(loadRefreshCredential(storage, KEY)).toEqual(CREDENTIAL);
  });

  it("reads an expired credential as a credential — expiry is the renewal path's call", () => {
    const storage = memoryStorage();
    const dead = { refreshToken: "old", refreshExpiresAt: 1_000 };
    saveRefreshCredential(storage, KEY, dead);
    expect(loadRefreshCredential(storage, KEY)).toEqual(dead);
  });

  it("reads no storage at all as no credential", () => {
    expect(loadRefreshCredential(null, KEY)).toBeNull();
  });

  it("reads a missing key as no credential", () => {
    expect(loadRefreshCredential(memoryStorage(), KEY)).toBeNull();
  });

  it.each([
    ["JSON that does not parse", "{not json"],
    ["a JSON value that is not an object", '"opaque-refresh"'],
    ["null", "null"],
    ["a record with no version", JSON.stringify(CREDENTIAL)],
    ["a record of another version", JSON.stringify({ v: 2, ...CREDENTIAL })],
    ["a token of the wrong type", JSON.stringify({ v: 1, refreshToken: 7, refreshExpiresAt: 1 })],
    ["an empty token", JSON.stringify({ v: 1, refreshToken: "", refreshExpiresAt: 1 })],
    [
      "an expiry of the wrong type",
      JSON.stringify({ v: 1, refreshToken: "r", refreshExpiresAt: "soon" }),
    ],
    ["a missing expiry", JSON.stringify({ v: 1, refreshToken: "r" })],
  ])("reads %s as no credential", (_name, raw) => {
    // Presenting a half-understood credential costs the person their session — the service
    // answers `refresh_token_reused` and ends the family. Returning null costs one exchange.
    expect(loadRefreshCredential(memoryStorage({ [KEY]: raw }), KEY)).toBeNull();
  });

  it("reads a throwing getItem as no credential", () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(loadRefreshCredential(storage, KEY)).toBeNull();
  });
});

describe("saveRefreshCredential", () => {
  it("answers false, and does not throw, when the write is refused", () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
    };
    // A session that does not survive a reload is not a failed sign-in: the caller keeps the
    // token it just obtained.
    expect(saveRefreshCredential(storage, KEY, CREDENTIAL)).toBe(false);
  });

  it("answers false with no storage", () => {
    expect(saveRefreshCredential(null, KEY, CREDENTIAL)).toBe(false);
  });
});

describe("forgetRefreshCredential", () => {
  it("removes the key", () => {
    const storage = memoryStorage();
    saveRefreshCredential(storage, KEY, CREDENTIAL);
    expect(forgetRefreshCredential(storage, KEY)).toBe(true);
    expect(storage.entries.has(KEY)).toBe(false);
  });

  it("answers false, and does not throw, when the removal is refused", () => {
    const storage: StorageLike = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
    };
    // The bytes may well still be on disk. That is why a caller that erases a credential also
    // stops using it in this page and asks the service to revoke its family.
    expect(forgetRefreshCredential(storage, KEY)).toBe(false);
  });
});

describe("resolveRefreshCredentialStorage", () => {
  it("takes an explicit null as persistence turned off", () => {
    expect(resolveRefreshCredentialStorage(null)).toBeNull();
  });

  it("takes an explicit storage over the browser's", () => {
    const storage = memoryStorage();
    expect(resolveRefreshCredentialStorage(storage)).toBe(storage);
  });

  it("falls back to null where there is no localStorage to reach", () => {
    // The default in a non-browser build, and in a browser that has blocked storage — reading
    // the property throws outright there.
    expect(resolveRefreshCredentialStorage()).toBeNull();
  });
});

describe("isRefreshCredentialUsable", () => {
  it("compares Unix seconds against a clock in milliseconds", () => {
    expect(isRefreshCredentialUsable({ refreshToken: "r", refreshExpiresAt: 1_000 }, 999_999)).toBe(
      true,
    );
    expect(
      isRefreshCredentialUsable({ refreshToken: "r", refreshExpiresAt: 1_000 }, 1_000_000),
    ).toBe(false);
  });
});
