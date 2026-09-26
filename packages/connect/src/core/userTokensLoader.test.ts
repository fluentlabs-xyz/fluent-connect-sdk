import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { describe, expect, it, vi } from "vitest";

import type { FluentUserTokenAddResult, UserTokenStore } from "./userTokens";
import { createUserTokenListLoader } from "./userTokensLoader";

const TOKEN: FluentTokenDefinition = {
  chainId: 20994,
  address: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
  symbol: "SOME",
  name: "Some Token",
  decimals: 6,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(store: UserTokenStore) {
  const tokens: FluentTokenDefinition[][] = [];
  const busy: boolean[] = [];
  const loader = createUserTokenListLoader({
    store,
    chainId: 20994,
    onTokens: (next) => tokens.push(next),
    onBusy: (next) => busy.push(next),
  });
  return { loader, tokens, busy };
}

describe("createUserTokenListLoader", () => {
  it("publishes the list and clears busy", async () => {
    const { loader, tokens, busy } = harness({
      list: vi.fn(async () => [TOKEN]),
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    });

    await loader.load();

    expect(tokens).toEqual([[TOKEN]]);
    expect(busy).toEqual([true, false]);
  });

  it("keeps the last settled list when the initial load rejects", async () => {
    const list = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const { loader, tokens, busy } = harness({
      list,
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    });

    await expect(loader.load()).resolves.toBeUndefined();

    expect(tokens).toEqual([]);
    // Reset in `finally`, not only on the happy path.
    expect(busy).toEqual([true, false]);
  });

  it("keeps the list visible when the refresh after a write rejects", async () => {
    let first = true;
    const store: UserTokenStore = {
      list: vi.fn(async () => {
        if (first) {
          first = false;
          return [TOKEN];
        }
        throw new Error("Failed to fetch");
      }),
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    };
    const { loader, tokens } = harness(store);

    await loader.load();
    await expect(loader.add({ ...TOKEN, symbol: "NEW" })).resolves.toEqual({ status: "added" });

    // One publication only: the failed refresh leaves the earlier list alone.
    expect(tokens).toEqual([[TOKEN]]);
  });

  it("ignores a stale load that lands after a newer one", async () => {
    const slow = deferred<FluentTokenDefinition[]>();
    const fast = deferred<FluentTokenDefinition[]>();
    const answers = [slow.promise, fast.promise];
    const { loader, tokens } = harness({
      list: vi.fn(() => answers.shift() ?? Promise.resolve([])),
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    });

    const firstLoad = loader.load();
    const secondLoad = loader.load();
    fast.resolve([TOKEN]);
    slow.resolve([{ ...TOKEN, symbol: "STALE" }]);
    await Promise.all([firstLoad, secondLoad]);

    expect(tokens).toEqual([[TOKEN]]);
  });

  it("answers failed instead of rejecting when a store throws out of add", async () => {
    const { loader, busy } = harness({
      list: vi.fn(async () => []),
      add: vi.fn(async () => {
        throw new Error("boom");
      }),
      remove: vi.fn(async () => {}),
    });

    await expect(loader.add(TOKEN)).resolves.toEqual({ status: "failed", message: "boom" });
    expect(busy.at(-1)).toBe(false);
  });

  it("swallows a throwing remove and still refreshes", async () => {
    const list = vi.fn(async () => []);
    const { loader } = harness({
      list,
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(loader.remove({ chainId: 20994, address: TOKEN.address })).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("refreshes after an already-present add, not only after an added one", async () => {
    let current: FluentTokenDefinition[] = [];
    const list = vi.fn(async () => current);
    const { loader, tokens } = harness({
      list,
      add: vi.fn(async () => {
        // The store's list already holds it — added in another tab, or carried
        // over by the import — so nothing was written, yet this loader's
        // snapshot is out of date.
        current = [TOKEN];
        return { status: "already-present" } as FluentUserTokenAddResult;
      }),
      remove: vi.fn(async () => {}),
    });

    await loader.load();
    await expect(loader.add(TOKEN)).resolves.toEqual({ status: "already-present" });

    expect(list).toHaveBeenCalledTimes(2);
    expect(tokens).toEqual([[], [TOKEN]]);
  });

  it("serves a hook again after StrictMode replays its effect", async () => {
    const store: UserTokenStore = {
      list: vi.fn(async () => [TOKEN]),
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    };
    const { loader, tokens } = harness(store);

    // What React does to one memoized loader in development: setup, cleanup,
    // setup. The hook is mounted throughout.
    loader.resume();
    const first = loader.load();
    loader.dispose();
    loader.resume();
    const second = loader.load();
    await Promise.all([first, second]);

    expect(tokens).toEqual([[TOKEN]]);
    await expect(loader.add(TOKEN)).resolves.toEqual({ status: "added" });
    expect(store.add).toHaveBeenCalledTimes(1);
    await expect(loader.remove({ chainId: 20994, address: TOKEN.address })).resolves.toBeUndefined();
    expect(store.remove).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing once disposed", async () => {
    const pending = deferred<FluentTokenDefinition[]>();
    const { loader, tokens } = harness({
      list: vi.fn(() => pending.promise),
      add: vi.fn(async () => ({ status: "added" }) as FluentUserTokenAddResult),
      remove: vi.fn(async () => {}),
    });

    const load = loader.load();
    loader.dispose();
    pending.resolve([TOKEN]);
    await load;

    expect(tokens).toEqual([]);
  });
});
