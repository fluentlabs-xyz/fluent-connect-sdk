import { describe, expect, it } from "vitest";

import {
  readStoredValue,
  removeStoredValue,
  resolveLocalStorage,
  writeStoredValue,
} from "./browserStorage";

const KEY = "fluent:widget:test";

/** A browser that refuses every operation: blocked site data, a hostile extension, a full quota. */
const refusing = {
  getItem: () => {
    throw new Error("storage refused");
  },
  setItem: () => {
    throw new Error("storage refused");
  },
  removeItem: () => {
    throw new Error("storage refused");
  },
};

describe("resolveLocalStorage", () => {
  it("takes the storage a caller named, including null to disable persistence", () => {
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(resolveLocalStorage(storage)).toBe(storage);
    expect(resolveLocalStorage(null)).toBeNull();
  });
});

describe("best-effort storage access", () => {
  it("reads and writes through a working storage", () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    };

    expect(writeStoredValue(storage, KEY, "value")).toBe(true);
    expect(readStoredValue(storage, KEY)).toBe("value");
    expect(removeStoredValue(storage, KEY)).toBe(true);
    expect(readStoredValue(storage, KEY)).toBeNull();
  });

  it("answers instead of throwing when there is no storage at all", () => {
    expect(readStoredValue(null, KEY)).toBeNull();
    expect(writeStoredValue(null, KEY, "value")).toBe(false);
    expect(removeStoredValue(null, KEY)).toBe(false);
  });

  // The reason this module exists: a caller in the middle of a sign-in or a disconnect must not
  // have its own operation replaced by the browser's refusal to keep a value.
  it("answers instead of throwing when the storage refuses every operation", () => {
    expect(readStoredValue(refusing, KEY)).toBeNull();
    expect(writeStoredValue(refusing, KEY, "value")).toBe(false);
    expect(removeStoredValue(refusing, KEY)).toBe(false);
  });
});
