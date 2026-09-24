import { describe, expect, it, vi } from "vitest";

import { FluentAuthError } from "./authToken";
import { createFluentSettingsClient, FluentSettingsError } from "./settingsClient";

const API = "https://api.example/api/v1";
const ADDRESS = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(
  fetchImpl: ReturnType<typeof vi.fn>,
  getAuthToken: () => Promise<string> = async () => "fluent.token",
) {
  return createFluentSettingsClient({
    publicApiUrl: API,
    getAuthToken,
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
  });
}

function requestOf(call: unknown[] | undefined) {
  return { url: call?.[0] as string, init: call?.[1] as RequestInit };
}

describe("createFluentSettingsClient.read", () => {
  it("maps the wire shape and carries the Fluent token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        quick_sign: false,
        gas_token_symbol: "USDnr",
        tokens: [
          {
            chain_id: 20994,
            address: ADDRESS,
            symbol: "SOME",
            name: "Some Token",
            decimals: 6,
          },
        ],
      }),
    );

    const settings = await clientWith(fetchImpl).read();

    expect(settings).toEqual({
      quickSign: false,
      gasTokenSymbol: "USDnr",
      tokens: [
        { chainId: 20994, address: ADDRESS, symbol: "SOME", name: "Some Token", decimals: 6 },
      ],
    });
    const { url, init } = requestOf(fetchImpl.mock.calls[0]);
    expect(url).toBe(`${API}/me/settings`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fluent.token");
    // A GET has no body, so it must not claim to carry JSON.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("gives a person with nothing stored the defaults", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { quick_sign: true, gas_token_symbol: null, tokens: [] }),
    );

    await expect(clientWith(fetchImpl).read()).resolves.toEqual({
      quickSign: true,
      gasTokenSymbol: null,
      tokens: [],
    });
  });

  it("drops a token row that would not pass as a stored one", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        quick_sign: true,
        gas_token_symbol: null,
        tokens: [
          { chain_id: 20994, address: "0xnope", symbol: "X", name: "X", decimals: 18 },
          { chain_id: 20994, address: ADDRESS, symbol: "OK", name: "Ok", decimals: 18 },
        ],
      }),
    );

    const settings = await clientWith(fetchImpl).read();
    expect(settings.tokens.map((token) => token.symbol)).toEqual(["OK"]);
  });

  it("throws the service's own code on 401", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { code: "invalid_token", message: "a valid Fluent token is required" }),
    );

    const error = await clientWith(fetchImpl)
      .read()
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FluentSettingsError);
    expect(error).toMatchObject({ code: "invalid_token", status: 401 });
  });

  it("passes a getAuthToken failure through as the auth error it is", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const client = clientWith(fetchImpl, async () => {
      throw new FluentAuthError("hosted_not_supported", "no token in hosted mode");
    });

    const error = await client.read().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FluentAuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a network failure into request_failed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const error = await clientWith(fetchImpl)
      .read()
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FluentSettingsError);
    expect(error).toMatchObject({ code: "request_failed", status: undefined });
  });
});

describe("createFluentSettingsClient.patch", () => {
  it("sends one snake-cased field", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { quick_sign: false, gas_token_symbol: null, tokens: [] }),
    );

    const settings = await clientWith(fetchImpl).patch({ quickSign: false });

    const { url, init } = requestOf(fetchImpl.mock.calls[0]);
    expect(url).toBe(`${API}/me/settings`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ quick_sign: false });
    expect(settings.quickSign).toBe(false);
  });

  it("sends a null gas token, which is a value and not an omission", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { quick_sign: true, gas_token_symbol: null, tokens: [] }),
    );

    await clientWith(fetchImpl).patch({ gasTokenSymbol: null });
    expect(JSON.parse(requestOf(fetchImpl.mock.calls[0]).init.body as string)).toEqual({
      gas_token_symbol: null,
    });
  });

  it("refuses an empty patch without asking the service", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));

    await expect(clientWith(fetchImpl).patch({})).rejects.toBeInstanceOf(FluentSettingsError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createFluentSettingsClient token routes", () => {
  it("PUTs the metadata under the token's own chain and address", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        chain_id: 20994,
        address: ADDRESS,
        symbol: "SOME",
        name: "Some Token",
        decimals: 6,
      }),
    );

    await clientWith(fetchImpl).putToken({
      chainId: 20994,
      address: ADDRESS,
      symbol: "SOME",
      name: "Some Token",
      decimals: 6,
    });

    const { url, init } = requestOf(fetchImpl.mock.calls[0]);
    expect(url).toBe(`${API}/me/tokens/20994/${ADDRESS}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      symbol: "SOME",
      name: "Some Token",
      decimals: 6,
    });
  });

  it("reports 409 at_capacity with its code", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { code: "at_capacity", message: "too many tokens on this chain" }),
    );

    const error = await clientWith(fetchImpl)
      .putToken({ chainId: 20994, address: ADDRESS, symbol: "S", name: "S", decimals: 6 })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ code: "at_capacity", status: 409 });
  });

  it("resolves a 204 DELETE with no body to parse", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(
      clientWith(fetchImpl).deleteToken({ chainId: 20994, address: ADDRESS }),
    ).resolves.toBeUndefined();

    const { url, init } = requestOf(fetchImpl.mock.calls[0]);
    expect(url).toBe(`${API}/me/tokens/20994/${ADDRESS}`);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });
});
