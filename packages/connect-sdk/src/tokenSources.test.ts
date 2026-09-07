import { describe, expect, it } from "vitest";

import { fluentTestnetTokenDefaults, fluentTokenIdentity } from "./balances.js";
import { findFluentSymbolCollisions, mergeFluentDisplayTokens } from "./tokenSources.js";

const USER_TOKEN = {
  chainId: 20994,
  address: "0x000000000000000000000000000000000000dEaD" as const,
  symbol: "MINE",
  name: "My token",
  decimals: 18,
};

const INTEGRATOR_TOKEN = {
  chainId: 20994,
  address: "0x00000000000000000000000000000000000BEEF1" as const,
  symbol: "THEIRS",
  name: "A builder's token",
  decimals: 6,
};

describe("mergeFluentDisplayTokens", () => {
  it("tags each token with where it came from, defaults first", () => {
    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.USDnr],
      integrator: [INTEGRATOR_TOKEN],
      user: [USER_TOKEN],
    });

    expect(merged.map((token) => [token.symbol, token.source])).toEqual([
      ["USDnr", "default"],
      ["THEIRS", "integrator"],
      ["MINE", "user"],
    ]);
  });

  it("lets the more trusted source win a duplicate address", () => {
    // The user added USDnr by hand before we shipped it as one of ours. Reading it
    // on-chain gave a bare name and no logo; ours should take over.
    const handAdded = {
      chainId: 20994,
      address: fluentTestnetTokenDefaults.USDnr.address,
      symbol: "USDnr",
      name: "usdnr",
      decimals: 18,
    };

    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.USDnr],
      user: [handAdded],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      source: "default",
      name: fluentTestnetTokenDefaults.USDnr.name,
    });
  });

  it("treats differently-cased spellings of one address as the same token", () => {
    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.BLEND],
      user: [
        {
          ...USER_TOKEN,
          address: fluentTestnetTokenDefaults.BLEND.address.toUpperCase() as `0x${string}`,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("default");
  });

  it("keeps a token that only shares a symbol with one we ship", () => {
    const impostor = { ...USER_TOKEN, symbol: "BLEND" };
    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.BLEND],
      user: [impostor],
    });

    // Both are listed — hiding the impostor would be worse than labelling it —
    // but they stay distinct entries so the UI can flag the collision.
    expect(merged).toHaveLength(2);
    expect(merged.map((token) => token.source)).toEqual(["default", "user"]);
  });
});

describe("capability stripping at the merge boundary", () => {
  it("keeps gasPriority and native only on tokens we ship", () => {
    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.BLEND],
      integrator: [{ ...INTEGRATOR_TOKEN, gasPriority: 0 }],
      user: [{ ...USER_TOKEN, gasPriority: 0, native: true }],
    });
    const bySymbol = new Map(merged.map((token) => [token.symbol, token]));

    expect(bySymbol.get("BLEND")?.gasPriority).toBe(
      fluentTestnetTokenDefaults.BLEND.gasPriority,
    );
    // Stripped, not filtered downstream: an untrusted token should be unable to
    // claim gas payability or impersonate the chain's own currency at all.
    expect(bySymbol.get("THEIRS")).not.toHaveProperty("gasPriority");
    expect(bySymbol.get("THEIRS")).not.toHaveProperty("native");
    expect(bySymbol.get("MINE")).not.toHaveProperty("gasPriority");
    expect(bySymbol.get("MINE")).not.toHaveProperty("native");
  });

  it("still identifies an untrusted token by its address when it claims to be native", () => {
    // `native` feeds into the identity, so stripping it afterwards would
    // collide the impostor with the chain's own currency and drop it silently
    // instead of listing it.
    const merged = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.ETH],
      user: [{ ...USER_TOKEN, native: true }],
    });

    expect(merged.map((token) => token.symbol)).toEqual(["ETH", "MINE"]);
    expect(merged[1]?.identity).toBe(`20994:${USER_TOKEN.address.toLowerCase()}`);
  });

  it("stamps the identity so consumers need not recompute it", () => {
    const [token] = mergeFluentDisplayTokens({
      defaults: [fluentTestnetTokenDefaults.BLEND],
    });

    expect(token?.identity).toBe(fluentTokenIdentity(fluentTestnetTokenDefaults.BLEND));
  });
});

describe("findFluentSymbolCollisions", () => {
  it("reports symbols claimed by more than one token", () => {
    const collisions = findFluentSymbolCollisions([
      fluentTestnetTokenDefaults.BLEND,
      { ...USER_TOKEN, symbol: "blend" },
      fluentTestnetTokenDefaults.USDnr,
    ]);

    expect(collisions.has("blend")).toBe(true);
    expect(collisions.has("usdnr")).toBe(false);
  });
});
