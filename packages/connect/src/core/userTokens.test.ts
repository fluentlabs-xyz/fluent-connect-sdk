import type { StorageLike } from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import {
  createFluentUserTokenStore,
  FLUENT_USER_TOKEN_LIMIT,
} from "./userTokens";

function memoryStorage(initial?: Record<string, string>): StorageLike & { dump(): string | null } {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => map.get("fluent:widget:tokens:v1") ?? null,
  };
}

const TOKEN = {
  chainId: 20994,
  address: "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const,
  symbol: "SOME",
  name: "Some Token",
  decimals: 6,
};

describe("createFluentUserTokenStore", () => {
  it("round-trips a token for its own chain only", () => {
    const store = createFluentUserTokenStore({ storage: memoryStorage() });

    expect(store.add(TOKEN)).toEqual({ status: "added" });
    expect(store.list(20994)).toEqual([TOKEN]);
    expect(store.list(25363)).toEqual([]);
  });

  it("rejects a token it already holds, regardless of address casing", () => {
    const store = createFluentUserTokenStore({ storage: memoryStorage() });
    store.add(TOKEN);

    expect(
      store.add({ ...TOKEN, symbol: "OTHER", address: TOKEN.address.toLowerCase() as `0x${string}` }),
    ).toEqual({ status: "already-present" });
    expect(store.list(20994)).toHaveLength(1);
  });

  it("removes by identity", () => {
    const store = createFluentUserTokenStore({ storage: memoryStorage() });
    store.add(TOKEN);

    store.remove({ chainId: TOKEN.chainId, address: TOKEN.address.toLowerCase() as `0x${string}` });
    expect(store.list(20994)).toEqual([]);
  });

  it("caps each chain separately", () => {
    const store = createFluentUserTokenStore({ storage: memoryStorage() });
    for (let index = 0; index < FLUENT_USER_TOKEN_LIMIT; index += 1) {
      const address = `0x${index.toString(16).padStart(40, "0")}` as `0x${string}`;
      expect(store.add({ ...TOKEN, address }).status).toBe("added");
    }

    expect(store.add({ ...TOKEN, address: "0x000000000000000000000000000000000000dEaD" })).toEqual({
      status: "at-capacity",
      limit: FLUENT_USER_TOKEN_LIMIT,
    });
    // A full testnet must not lock out mainnet.
    expect(
      store.add({ ...TOKEN, chainId: 25363, address: "0x000000000000000000000000000000000000dEaD" }),
    ).toEqual({ status: "added" });
  });

  it("survives whatever is actually sitting under the key", () => {
    for (const raw of [
      "not json",
      "null",
      '{"version":1}',
      '{"version":1,"tokens":"nope"}',
      '{"version":1,"tokens":[{"chainId":20994}]}',
      '{"version":1,"tokens":[{"chainId":20994,"address":"0xnope","symbol":"X","name":"X","decimals":18}]}',
      '{"version":1,"tokens":[{"chainId":20994,"address":"0x092AE7564C6611a114C20C6df766B5B35A52334A","symbol":"X","name":"X","decimals":1e9}]}',
    ]) {
      const store = createFluentUserTokenStore({
        storage: memoryStorage({ "fluent:widget:tokens:v1": raw }),
      });
      expect(store.list(20994)).toEqual([]);
    }
  });

  it("strips a stored entry claiming to be the chain's native currency", () => {
    // Otherwise a tampered entry would read the account's ETH balance and
    // present it as an arbitrary token.
    const store = createFluentUserTokenStore({
      storage: memoryStorage({
        "fluent:widget:tokens:v1": JSON.stringify({
          version: 1,
          tokens: [{ ...TOKEN, native: true }],
        }),
      }),
    });

    expect(store.list(20994)[0]).not.toHaveProperty("native");
  });

  it("keeps working in memory when storage throws", () => {
    const store = createFluentUserTokenStore({
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {},
      },
    });

    expect(store.add(TOKEN)).toEqual({ status: "added" });
    expect(store.list(20994)).toEqual([TOKEN]);
  });
});
