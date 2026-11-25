/**
 * @vitest-environment jsdom
 *
 * Fakes: the External wallet's EIP-1193 provider, with MetaMask's typed-data chain check;
 * the Auth token service behind fetch. The hook and viem@2.52.0 run for real.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { createWalletClient, custom, numberToHex } from "viem";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FluentAuthError } from "../../core/authToken";
import { resetAuthTokenSessions, useAuthToken } from "./useAuthToken";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const API = "https://api.example/connect/v1";
const SIGNATURE = `0x${"11".repeat(65)}`;

function setup(
  options: {
    chainId?: number;
    activeChain?: number;
    unknownChain?: boolean;
    switchError?: { code: number; message: string };
    ignoreSwitch?: boolean;
    changeAccount?: boolean;
    origin?: string;
  } = {},
) {
  const chainId = options.chainId ?? 25363;
  let activeChain = options.activeChain ?? 1;
  let knownChain = !options.unknownChain;
  let address = ADDRESS;
  const calls: string[] = [];
  const typedData = {
    domain: { name: "Fluent Connect Login", version: "1", chainId },
    primaryType: "FluentLogin",
    types: { FluentLogin: [{ name: "origin", type: "string" }] },
    message: { origin: options.origin ?? window.location.origin },
  };
  const request = vi.fn(
    async ({
      method,
      params,
    }: {
      method: string;
      params?: readonly unknown[];
    }): Promise<unknown> => {
      calls.push(method);
      if (method === "eth_chainId") return numberToHex(activeChain);
      if (method === "eth_accounts") return [address];
      if (method === "wallet_switchEthereumChain") {
        if (options.switchError) throw options.switchError;
        if (!knownChain) throw { code: 4902, message: "Unrecognized chain." };
        if (!options.ignoreSwitch) activeChain = chainId;
        if (options.changeAccount) address = OTHER_ADDRESS;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        knownChain = true;
        return null;
      }
      if (method === "eth_signTypedData_v4") {
        const data = JSON.parse(String(params?.[1]));
        if (Number(data.domain.chainId) !== activeChain) {
          throw {
            code: -32603,
            message: `Provided chainId "${data.domain.chainId}" must match the active chainId "${activeChain}"`,
          };
        }
        return SIGNATURE;
      }
      throw new Error(`Unexpected wallet request: ${method}`);
    },
  );
  const walletClient = createWalletClient({
    transport: custom({ request }, { retryCount: 0 }),
  });
  const token = `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.sig`;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const route = String(input).slice(API.length);
    calls.push(route);
    const body =
      route === "/auth/challenge"
        ? { nonce: "challenge", typedData }
        : {
            token,
            refreshToken: "refresh",
            refreshExpiresAt: Math.floor(Date.now() / 1000) + 3600,
          };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() =>
    useAuthToken({
      publicApiUrl: API,
      appId: "app_11111111111111111111111111111111",
      renewalOffsetSeconds: 30,
      accountType: "eoa",
      getAccessToken: async () => null,
      identityToken: null,
      walletAddress: ADDRESS,
      walletClient,
      storage: null,
    }),
  );
  return {
    result,
    calls,
    request,
    fetch,
    token,
    typedData,
    walletClient,
    moveTo: (nextChain: number) => {
      activeChain = nextChain;
    },
  };
}

beforeEach(() => resetAuthTokenSessions());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([20994, 25363])("switches to challenge chain %s before signing in", async (chainId) => {
  const { result, calls, request, token, typedData } = setup({ chainId });

  await expect(result.current.getAuthToken()).resolves.toBe(token);

  expect(calls).toEqual([
    "/auth/challenge",
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_accounts",
    "eth_chainId",
    "eth_signTypedData_v4",
    "/auth/exchange/wallet",
  ]);
  const switched = request.mock.calls.find(
    ([call]) => call.method === "wallet_switchEthereumChain",
  );
  expect(switched?.[0]).toEqual({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: numberToHex(chainId) }],
  });
  const signature = request.mock.calls.find(([call]) => call.method === "eth_signTypedData_v4");
  expect(JSON.parse(String(signature?.[0].params?.[1]))).toMatchObject(typedData);
});

it("adds an unknown Fluent chain and switches before signing", async () => {
  const { result, calls, token } = setup({ unknownChain: true });

  await expect(result.current.getAuthToken()).resolves.toBe(token);

  expect(calls.filter((method) => method.startsWith("wallet_"))).toEqual([
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
});

it("signs without switching when the wallet is on the challenge chain", async () => {
  const { result, calls, token } = setup({ activeChain: 25363 });

  await expect(result.current.getAuthToken()).resolves.toBe(token);

  expect(calls).not.toContain("wallet_switchEthereumChain");
  expect(calls).toContain("eth_signTypedData_v4");
});

it.each([
  { code: 4001, message: "User rejected the request." },
  { code: -32601, message: "Network switching is not supported." },
])("does not sign or exchange when switching fails with $code", async (switchError) => {
  const { result, calls } = setup({ switchError });

  await expect(result.current.getAuthToken()).rejects.toBeInstanceOf(FluentAuthError);

  expect(calls).not.toContain("eth_signTypedData_v4");
  expect(calls).not.toContain("/auth/exchange/wallet");
  expect(calls.filter((method) => method === "/auth/challenge")).toHaveLength(1);
});

it("refuses to sign when a successful switch leaves the wallet on another chain", async () => {
  const { result, calls } = setup({ ignoreSwitch: true });

  await expect(result.current.getAuthToken()).rejects.toBeInstanceOf(FluentAuthError);

  expect(calls).not.toContain("eth_signTypedData_v4");
  expect(calls).not.toContain("/auth/exchange/wallet");
});

it("refuses to sign for an account replaced during the network switch", async () => {
  const { result, calls } = setup({ changeAccount: true });

  await expect(result.current.getAuthToken()).rejects.toMatchObject({ code: "not_connected" });

  expect(calls).not.toContain("eth_signTypedData_v4");
  expect(calls).not.toContain("/auth/exchange/wallet");
});

it("validates the challenge origin before asking the wallet to switch", async () => {
  const { result, calls } = setup({ origin: "https://another.example" });

  await expect(result.current.getAuthToken()).rejects.toMatchObject({ code: "origin_mismatch" });

  expect(calls).toEqual(["/auth/challenge"]);
});

it("does not inspect or switch the wallet for cached tokens and accepted renewals", async () => {
  const { result, calls, token, moveTo } = setup({ activeChain: 25363 });
  await expect(result.current.getAuthToken()).resolves.toBe(token);
  moveTo(1);
  calls.length = 0;

  await expect(result.current.getAuthToken()).resolves.toBe(token);
  expect(calls).toEqual([]);

  await expect(result.current.requestSponsorshipToken({ fresh: true })).resolves.toBe(token);
  expect(calls).toEqual(["/auth/refresh"]);
});

it("refuses a challenge for a chain outside Fluent before contacting the wallet", async () => {
  const { result, calls } = setup({ chainId: 137 });

  await expect(result.current.getAuthToken()).rejects.toMatchObject({ code: "request_failed" });

  expect(calls).toEqual(["/auth/challenge"]);
});

it("exchanges a Fluent ID's Direct-login credentials without contacting an external provider", async () => {
  const { calls, walletClient, token } = setup();
  const { result } = renderHook(() =>
    useAuthToken({
      publicApiUrl: API,
      appId: "app_11111111111111111111111111111111",
      renewalOffsetSeconds: 30,
      accountType: "smart",
      privyUserId: "did:privy:example",
      getAccessToken: async () => "access",
      identityToken: "identity",
      walletAddress: ADDRESS,
      walletClient,
      storage: null,
    }),
  );

  await expect(result.current.getAuthToken()).resolves.toBe(token);

  expect(calls).toEqual(["/auth/exchange/privy"]);
});
