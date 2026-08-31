import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";

import {
  exchangePrivyAuthToken,
  exchangeWalletAuthToken,
  FluentAuthError,
  readAuthTokenExpiry,
} from "./authToken";

const API = "https://api.example/api/v1";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ORIGIN = "http://localhost:5173";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function challenge(nonce: string, origin = ORIGIN) {
  return {
    nonce,
    typedData: {
      domain: { name: "Fluent Connect Login", version: "1", chainId: 20994 },
      primaryType: "FluentLogin",
      types: { FluentLogin: [{ name: "account", type: "address" }] },
      message: { account: ADDRESS, origin, nonce },
    },
  };
}

function fakeWallet() {
  return { signTypedData: vi.fn(async () => "0xsig") } as unknown as WalletClient & {
    signTypedData: ReturnType<typeof vi.fn>;
  };
}

function requestBody(call: unknown[] | undefined) {
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangePrivyAuthToken", () => {
  it("posts both Privy tokens and returns the Fluent token", async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, { token: "jwt" })),
    );
    vi.stubGlobal("fetch", fetch);

    const token = await exchangePrivyAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      accessToken: "access",
      identityToken: "identity",
    });

    expect(token).toBe("jwt");
    expect(fetch.mock.calls[0]?.[0]).toBe(`${API}/auth/exchange/privy`);
    expect(requestBody(fetch.mock.calls[0])).toEqual({
      clientId: "client-a",
      accessToken: "access",
      identityToken: "identity",
    });
  });

  it("maps a service error body to FluentAuthError.code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { code: "invalid_privy_token", message: "nope" })),
    );

    const err = await exchangePrivyAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      accessToken: "a",
      identityToken: "i",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(FluentAuthError);
    expect((err as FluentAuthError).code).toBe("invalid_privy_token");
    expect((err as FluentAuthError).status).toBe(401);
  });
});

describe("exchangeWalletAuthToken", () => {
  it("refuses a challenge minted for another origin before asking the wallet to sign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, challenge("0xn1", "https://evil.example"))),
    );
    const walletClient = fakeWallet();

    const err = await exchangeWalletAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      address: ADDRESS,
      walletClient,
      origin: ORIGIN,
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("origin_mismatch");
    expect(walletClient.signTypedData).not.toHaveBeenCalled();
  });

  it("signs the typed data verbatim and exchanges the nonce", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }));
    vi.stubGlobal("fetch", fetch);
    const walletClient = fakeWallet();

    const token = await exchangeWalletAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      address: ADDRESS,
      walletClient,
      origin: ORIGIN,
    });

    expect(token).toBe("jwt");
    expect(walletClient.signTypedData).toHaveBeenCalledWith({
      account: ADDRESS,
      ...challenge("0xn1").typedData,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(`${API}/auth/exchange/wallet`);
    expect(requestBody(fetch.mock.calls[1])).toEqual({
      clientId: "client-a",
      nonce: "0xn1",
      signature: "0xsig",
    });
  });

  it("retries once with a fresh challenge on signature_prefix_rejected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn1")))
      .mockResolvedValueOnce(
        jsonResponse(401, { code: "signature_prefix_rejected", message: "retry" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, challenge("0xn2")))
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt2" }));
    vi.stubGlobal("fetch", fetch);

    const token = await exchangeWalletAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      address: ADDRESS,
      walletClient: fakeWallet(),
      origin: ORIGIN,
    });

    expect(token).toBe("jwt2");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requestBody(fetch.mock.calls[3]).nonce).toBe("0xn2");
  });

  it("does not retry a configuration error", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(403, { code: "origin_not_allowed", message: "no" }),
    );
    vi.stubGlobal("fetch", fetch);

    const err = await exchangeWalletAuthToken({
      publicApiUrl: API,
      clientId: "client-a",
      address: ADDRESS,
      walletClient: fakeWallet(),
      origin: ORIGIN,
    }).catch((e: unknown) => e);

    expect((err as FluentAuthError).code).toBe("origin_not_allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("readAuthTokenExpiry", () => {
  it("reads exp from the payload in milliseconds", () => {
    const payload = btoa(JSON.stringify({ exp: 1_700_000_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(readAuthTokenExpiry(`h.${payload}.s`)).toBe(1_700_000_000_000);
  });

  it("returns undefined for a token that does not parse", () => {
    expect(readAuthTokenExpiry("garbage")).toBeUndefined();
  });
});
