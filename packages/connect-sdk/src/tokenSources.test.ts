import { describe, expect, it } from "vitest";

import { fluentTestnetTokenDefaults } from "./balances.js";
import { findFluentSymbolCollisions, mergeFluentDisplayTokens } from "./tokenSources.js";

const USER_TOKEN = {
  chainId: 20994,
  address: "0x000000000000000000000000000000000000dEaD" as const,
  symbol: "MINE",
  name: "My token",
  decimals: 18,
};

describe("mergeFluentDisplayTokens", () => {
  it("tags each token with where it came from, curated first", () => {
    const merged = mergeFluentDisplayTokens({
      curated: [fluentTestnetTokenDefaults.USDnr],
      integrator: [fluentTestnetTokenDefaults.USDC],
      user: [USER_TOKEN],
    });

    expect(merged.map((token) => [token.symbol, token.source])).toEqual([
      ["USDnr", "curated"],
      ["USDC", "integrator"],
      ["MINE", "user"],
    ]);
  });

  it("lets the more trusted source win a duplicate address", () => {
    // The user added USDnr by hand before we shipped it as curated. Reading it
    // on-chain gave a bare name and no logo; ours should take over.
    const handAdded = {
      chainId: 20994,
      address: fluentTestnetTokenDefaults.USDnr.address,
      symbol: "USDnr",
      name: "usdnr",
      decimals: 18,
    };

    const merged = mergeFluentDisplayTokens({
      curated: [fluentTestnetTokenDefaults.USDnr],
      user: [handAdded],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      source: "curated",
      name: fluentTestnetTokenDefaults.USDnr.name,
    });
  });

  it("treats differently-cased spellings of one address as the same token", () => {
    const merged = mergeFluentDisplayTokens({
      curated: [fluentTestnetTokenDefaults.BLEND],
      user: [
        {
          ...USER_TOKEN,
          address: fluentTestnetTokenDefaults.BLEND.address.toUpperCase() as `0x${string}`,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("curated");
  });

  it("keeps a token that only shares a symbol with a curated one", () => {
    const impostor = { ...USER_TOKEN, symbol: "BLEND" };
    const merged = mergeFluentDisplayTokens({
      curated: [fluentTestnetTokenDefaults.BLEND],
      user: [impostor],
    });

    // Both are listed — hiding the impostor would be worse than labelling it —
    // but they stay distinct entries so the UI can flag the collision.
    expect(merged).toHaveLength(2);
    expect(merged.map((token) => token.source)).toEqual(["curated", "user"]);
  });
});

describe("findFluentSymbolCollisions", () => {
  it("reports symbols claimed by more than one token", () => {
    const collisions = findFluentSymbolCollisions([
      fluentTestnetTokenDefaults.BLEND,
      { ...USER_TOKEN, symbol: "blend" },
      fluentTestnetTokenDefaults.USDC,
    ]);

    expect(collisions.has("blend")).toBe(true);
    expect(collisions.has("usdc")).toBe(false);
  });
});
