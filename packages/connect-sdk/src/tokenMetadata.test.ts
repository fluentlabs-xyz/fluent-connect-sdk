import { describe, expect, it, vi } from "vitest";

import { readFluentTokenMetadata } from "./tokenMetadata.js";

const ADDRESS = "0x092AE7564C6611a114C20C6df766B5B35A52334A";

function clientReturning(values: Partial<Record<"name" | "symbol" | "decimals", unknown>>) {
  return {
    readContract: vi.fn(({ functionName }: { functionName: "name" | "symbol" | "decimals" }) => {
      if (!(functionName in values)) {
        return Promise.reject(new Error(`${functionName} reverted`));
      }
      return Promise.resolve(values[functionName]);
    }),
  } as never;
}

describe("readFluentTokenMetadata", () => {
  it("takes the token's own account of itself and checksums the address", async () => {
    const result = await readFluentTokenMetadata({
      client: clientReturning({ name: "Some Token", symbol: "SOME", decimals: 6 }),
      address: `  ${ADDRESS.toLowerCase()}  `,
      chainId: 20994,
    });

    expect(result).toEqual({
      status: "ok",
      token: {
        chainId: 20994,
        address: ADDRESS,
        symbol: "SOME",
        name: "Some Token",
        decimals: 6,
      },
    });
  });

  it("rejects anything that is not an address before touching the chain", async () => {
    const client = clientReturning({ symbol: "SOME", decimals: 18 });

    expect(
      await readFluentTokenMetadata({ client, address: "not-an-address", chainId: 20994 }),
    ).toEqual({ status: "invalid-address" });
    expect((client as { readContract: ReturnType<typeof vi.fn> }).readContract)
      .not.toHaveBeenCalled();
  });

  it("refuses a contract that will not report decimals", async () => {
    // Defaulting to 18 here would silently misprice every balance we render.
    const result = await readFluentTokenMetadata({
      client: clientReturning({ symbol: "SOME" }),
      address: ADDRESS,
      chainId: 20994,
    });

    expect(result.status).toBe("unreadable");
  });

  it("refuses nonsense decimals", async () => {
    const result = await readFluentTokenMetadata({
      client: clientReturning({ symbol: "SOME", decimals: 255 }),
      address: ADDRESS,
      chainId: 20994,
    });

    expect(result.status).toBe("unreadable");
  });

  it("falls back to the symbol when the token has no name", async () => {
    const result = await readFluentTokenMetadata({
      client: clientReturning({ symbol: "SOME", decimals: 18 }),
      address: ADDRESS,
      chainId: 20994,
    });

    expect(result).toMatchObject({ status: "ok", token: { name: "SOME", symbol: "SOME" } });
  });

  it("truncates an overlong symbol instead of letting it break the row", async () => {
    const result = await readFluentTokenMetadata({
      client: clientReturning({ symbol: "A".repeat(200), decimals: 18 }),
      address: ADDRESS,
      chainId: 20994,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.token.symbol).toHaveLength(16);
  });
});
