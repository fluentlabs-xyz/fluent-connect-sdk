import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { describe, expect, it, vi } from "vitest";

import { FluentSettingsError, type FluentSettingsClient } from "./settingsClient";
import { FLUENT_USER_TOKEN_LIMIT } from "./userTokens";
import { createFluentBackendUserTokenStore } from "./userTokensBackend";

const ADDRESS = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const OTHER = "0x000000000000000000000000000000000000dEaD" as const;

const TOKEN: FluentTokenDefinition = {
  chainId: 20994,
  address: ADDRESS,
  symbol: "SOME",
  name: "Some Token",
  decimals: 6,
};

function fakeClient(overrides?: Partial<FluentSettingsClient>): FluentSettingsClient {
  return {
    read: vi.fn(async () => ({ quickSign: true, gasTokenSymbol: null, tokens: [] })),
    patch: vi.fn(async () => ({ quickSign: true, gasTokenSymbol: null, tokens: [] })),
    putToken: vi.fn(async () => {}),
    deleteToken: vi.fn(async () => {}),
    ...overrides,
  };
}

function storeWith(
  client: FluentSettingsClient,
  options?: { seed?: FluentTokenDefinition[]; onRemoveError?: (message: string) => void },
) {
  return createFluentBackendUserTokenStore({
    client,
    load: async () => options?.seed ?? [],
    onRemoveError: options?.onRemoveError,
  });
}

describe("createFluentBackendUserTokenStore.list", () => {
  it("loads once and filters by chain", async () => {
    const load = vi.fn(async () => [TOKEN, { ...TOKEN, chainId: 25363, address: OTHER }]);
    const store = createFluentBackendUserTokenStore({ client: fakeClient(), load });

    await expect(store.list(20994)).resolves.toEqual([TOKEN]);
    await expect(store.list(25363)).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing once primed from a settings answer", async () => {
    const load = vi.fn(async () => []);
    const store = createFluentBackendUserTokenStore({ client: fakeClient(), load });
    store.prime([TOKEN]);

    await expect(store.list(20994)).resolves.toEqual([TOKEN]);
    expect(load).not.toHaveBeenCalled();
  });

  it("shares one load between parallel callers", async () => {
    const load = vi.fn(async () => [TOKEN]);
    const store = createFluentBackendUserTokenStore({ client: fakeClient(), load });

    await Promise.all([store.list(20994), store.list(20994)]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("createFluentBackendUserTokenStore.add", () => {
  it("PUTs a token it does not hold and keeps it in the list", async () => {
    const client = fakeClient();
    const store = storeWith(client);

    await expect(store.add(TOKEN)).resolves.toEqual({ status: "added" });
    expect(client.putToken).toHaveBeenCalledWith(TOKEN);
    await expect(store.list(20994)).resolves.toEqual([TOKEN]);
  });

  it("answers already-present from the loaded list, without a request", async () => {
    const client = fakeClient();
    const store = storeWith(client, { seed: [TOKEN] });

    await expect(
      store.add({ ...TOKEN, address: ADDRESS.toLowerCase() as `0x${string}` }),
    ).resolves.toEqual({ status: "already-present" });
    expect(client.putToken).not.toHaveBeenCalled();
  });

  it("maps 409 at_capacity to at-capacity with the widget's limit", async () => {
    const client = fakeClient({
      putToken: vi.fn(async () => {
        throw new FluentSettingsError("at_capacity", "too many", 409);
      }),
    });

    await expect(storeWith(client).add(TOKEN)).resolves.toEqual({
      status: "at-capacity",
      limit: FLUENT_USER_TOKEN_LIMIT,
    });
  });

  it("maps 400 invalid_request to invalid", async () => {
    const client = fakeClient({
      putToken: vi.fn(async () => {
        throw new FluentSettingsError("invalid_request", "bad address", 400);
      }),
    });

    await expect(storeWith(client).add(TOKEN)).resolves.toEqual({ status: "invalid" });
  });

  it.each([
    ["401", new FluentSettingsError("invalid_token", "a valid Fluent token is required", 401)],
    ["500", new FluentSettingsError("internal", "boom", 500)],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("answers failed with a message on %s, and throws nothing", async (_label, thrown) => {
    const client = fakeClient({
      putToken: vi.fn(async () => {
        throw thrown;
      }),
    });

    const result = await storeWith(client).add(TOKEN);
    expect(result.status).toBe("failed");
    expect(result).toHaveProperty("message", (thrown as Error).message);
  });

  it("answers failed when the list itself could not be loaded", async () => {
    const store = createFluentBackendUserTokenStore({
      client: fakeClient(),
      load: async () => {
        throw new FluentSettingsError("internal", "boom", 500);
      },
    });

    expect((await store.add(TOKEN)).status).toBe("failed");
  });

  it("refuses a token that would not pass as a stored one, before any request", async () => {
    const client = fakeClient();
    const store = storeWith(client);

    await expect(
      store.add({ ...TOKEN, address: undefined } as unknown as FluentTokenDefinition),
    ).resolves.toEqual({ status: "invalid" });
    expect(client.putToken).not.toHaveBeenCalled();
  });
});

describe("createFluentBackendUserTokenStore.remove", () => {
  it("DELETEs under the token's own chain and address", async () => {
    const client = fakeClient();
    const store = storeWith(client, { seed: [TOKEN] });
    await store.list(20994);

    await store.remove({ chainId: 20994, address: ADDRESS });

    expect(client.deleteToken).toHaveBeenCalledWith({ chainId: 20994, address: ADDRESS });
    await expect(store.list(20994)).resolves.toEqual([]);
  });

  it.each([
    ["401", new FluentSettingsError("invalid_token", "no token", 401)],
    ["500", new FluentSettingsError("internal", "boom", 500)],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("keeps the optimistic removal and reports %s through the callback", async (_l, thrown) => {
    const onRemoveError = vi.fn();
    const client = fakeClient({
      deleteToken: vi.fn(async () => {
        throw thrown;
      }),
    });
    const store = storeWith(client, { seed: [TOKEN], onRemoveError });
    await store.list(20994);

    await expect(store.remove({ chainId: 20994, address: ADDRESS })).resolves.toBeUndefined();

    expect(onRemoveError).toHaveBeenCalledWith((thrown as Error).message);
    // No retry queue: the row stays gone for this widget session.
    await expect(store.list(20994)).resolves.toEqual([]);
  });
});
