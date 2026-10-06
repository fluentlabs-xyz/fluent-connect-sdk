import type { FluentTokenDefinition, StorageLike } from "@fluent.xyz/connect-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY,
  FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY,
} from "./storageKeys";
import { parseStoredUserTokens, type FluentUserTokenAddResult } from "./userTokens";
import { importLocalUserTokensOnce } from "./userTokensImport";

const ONE: FluentTokenDefinition = {
  chainId: 20994,
  address: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
  symbol: "ONE",
  name: "One",
  decimals: 6,
};
const TWO: FluentTokenDefinition = {
  ...ONE,
  address: "0x000000000000000000000000000000000000dEaD",
  symbol: "TWO",
  name: "Two",
};

const THREE: FluentTokenDefinition = {
  ...ONE,
  address: "0x0000000000000000000000000000000000000003",
  symbol: "THREE",
  name: "Three",
};

const PERSON_A = "https://api|app_1|privy:did:privy:a";
const PERSON_B = "https://api|app_1|wallet:0x000000000000000000000000000000000000beef";

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  const storage: StorageLike & { map: Map<string, string> } = {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return storage;
}

function withLocal(tokens: FluentTokenDefinition[], extra?: Record<string, string>) {
  return memoryStorage({
    [FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY]: JSON.stringify({ version: 1, tokens }),
    ...extra,
  });
}

function scriptedBackend(results: FluentUserTokenAddResult[]) {
  const calls: FluentTokenDefinition[] = [];
  let index = 0;
  return {
    calls,
    add: vi.fn(async (token: FluentTokenDefinition) => {
      calls.push(token);
      return results[index++] ?? { status: "added" as const };
    }),
  };
}

function localTokens(storage: StorageLike) {
  return parseStoredUserTokens(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY));
}

describe("importLocalUserTokensOnce", () => {
  it("carries every local entry over and then removes the key and the marker", async () => {
    const storage = withLocal([ONE, TWO]);
    const backend = scriptedBackend([{ status: "added" }, { status: "added" }]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toEqual({ status: "imported", added: 2, dropped: 0 });

    expect(backend.calls).toEqual([ONE, TWO]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
  });

  it("imports nothing on a second sign-in, because there is no key left", async () => {
    const storage = memoryStorage();
    const backend = scriptedBackend([]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toEqual({ status: "skipped", reason: "no-local-tokens" });
    expect(backend.add).not.toHaveBeenCalled();
  });

  it("leaves a list that was already on the service alone", async () => {
    const storage = withLocal([ONE]);
    const backend = scriptedBackend([]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [TWO] }),
    ).resolves.toEqual({ status: "skipped", reason: "remote-not-empty" });

    expect(backend.add).not.toHaveBeenCalled();
    expect(localTokens(storage)).toEqual([ONE]);
  });

  it("stops on a failed add and keeps exactly the remainder for the next attempt", async () => {
    const storage = withLocal([ONE, TWO]);
    const backend = scriptedBackend([
      { status: "added" },
      { status: "failed", message: "Failed to fetch" },
    ]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toEqual({
      status: "incomplete",
      added: 1,
      dropped: 0,
      remaining: 1,
      reason: "failed",
    });

    expect(localTokens(storage)).toEqual([TWO]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBe(PERSON_A);
  });

  it("resumes the remainder on the next read, even though the service now holds a list", async () => {
    const storage = withLocal([ONE, TWO]);
    const failing = scriptedBackend([
      { status: "added" },
      { status: "failed", message: "Failed to fetch" },
    ]);
    await importLocalUserTokensOnce({ storage, backend: failing, owner: PERSON_A, remoteTokens: [] });

    const resuming = scriptedBackend([{ status: "added" }]);
    await expect(
      // The marker, not the empty remote list, is what lets this run.
      importLocalUserTokensOnce({ storage, backend: resuming, owner: PERSON_A, remoteTokens: [ONE] }),
    ).resolves.toEqual({ status: "imported", added: 1, dropped: 0 });

    expect(resuming.calls).toEqual([TWO]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
  });

  it("stops on at-capacity, leaving the local key in place", async () => {
    const storage = withLocal([ONE, TWO]);
    const backend = scriptedBackend([{ status: "at-capacity", limit: 50 }]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toMatchObject({ status: "incomplete", reason: "at-capacity", remaining: 2 });
    expect(localTokens(storage)).toEqual([ONE, TWO]);
  });

  it("drops an invalid entry rather than retrying it forever", async () => {
    const storage = withLocal([ONE, TWO]);
    const backend = scriptedBackend([{ status: "invalid" }, { status: "added" }]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toEqual({ status: "imported", added: 1, dropped: 1 });
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
  });

  it("counts already-present as done", async () => {
    const storage = withLocal([ONE]);
    const backend = scriptedBackend([{ status: "already-present" }]);

    await expect(
      importLocalUserTokensOnce({ storage, backend, owner: PERSON_A, remoteTokens: [] }),
    ).resolves.toEqual({ status: "imported", added: 0, dropped: 0 });
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY)).toBeNull();
  });

  it("writes no local list and removes no key once its generation is gone", async () => {
    const storage = withLocal([ONE, TWO]);
    let alive = true;
    const backend = {
      add: vi.fn(async () => {
        alive = false;
        return { status: "added" as const };
      }),
    };

    const result = await importLocalUserTokensOnce({
      storage,
      backend,
      owner: PERSON_A,
      remoteTokens: [],
      shouldContinue: () => alive,
    });

    expect(result).toEqual({ status: "skipped", reason: "abandoned" });
    expect(backend.add).toHaveBeenCalledTimes(1);
    // The local list is the current generation's to write, not this run's.
    expect(localTokens(storage)).toEqual([ONE, TWO]);
  });

  it("leaves the current generation's local list alone when a stale add lands", async () => {
    const storage = withLocal([ONE, TWO]);
    let alive = true;
    let resolveAdd!: (result: FluentUserTokenAddResult) => void;
    const backend = {
      add: vi.fn(
        () =>
          new Promise<FluentUserTokenAddResult>((resolve) => {
            resolveAdd = resolve;
          }),
      ),
    };

    const running = importLocalUserTokensOnce({
      storage,
      backend,
      owner: PERSON_A,
      remoteTokens: [],
      shouldContinue: () => alive,
    });

    // The subject goes while the first PUT is in flight, and the local store —
    // now the only one — takes a different list.
    alive = false;
    storage.setItem(
      FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY,
      JSON.stringify({ version: 1, tokens: [THREE] }),
    );
    resolveAdd({ status: "added" });

    await expect(running).resolves.toEqual({ status: "skipped", reason: "abandoned" });
    expect(localTokens(storage)).toEqual([THREE]);
  });

  it("does not let one person's unfinished import reach another person's list", async () => {
    const storage = withLocal([ONE, TWO]);
    const failing = scriptedBackend([
      { status: "added" },
      { status: "failed", message: "Failed to fetch" },
    ]);
    await importLocalUserTokensOnce({
      storage,
      backend: failing,
      owner: PERSON_A,
      remoteTokens: [],
    });
    expect(localTokens(storage)).toEqual([TWO]);

    // B signs in on the same browser and already has a list of their own.
    const other = scriptedBackend([]);
    await expect(
      importLocalUserTokensOnce({
        storage,
        backend: other,
        owner: PERSON_B,
        remoteTokens: [THREE],
      }),
    ).resolves.toEqual({ status: "skipped", reason: "remote-not-empty" });

    expect(other.add).not.toHaveBeenCalled();
    expect(localTokens(storage)).toEqual([TWO]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBe(PERSON_A);
  });

  it("does not even start for a generation that is already gone", async () => {
    const storage = withLocal([ONE]);
    const backend = scriptedBackend([]);

    await expect(
      importLocalUserTokensOnce({
        storage,
        backend,
        owner: PERSON_A,
        remoteTokens: [],
        shouldContinue: () => false,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "abandoned" });

    expect(backend.add).not.toHaveBeenCalled();
    expect(localTokens(storage)).toEqual([ONE]);
    expect(storage.getItem(FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY)).toBeNull();
  });
});
