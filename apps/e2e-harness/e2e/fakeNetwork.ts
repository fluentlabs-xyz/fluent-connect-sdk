/**
 * Every host the widget talks to on Fluent testnet, answered from inside the test:
 * the Fluent RPC, `fluent-connect-service`, the price APIs, FluentScan and the Sepolia
 * RPC the Swap screen reads its fee from. Nothing leaves the machine. A request to any
 * other host is aborted and recorded, so a test can fail on a call nobody has faked yet.
 *
 * The answers follow what the widget's code expects:
 * the service shapes in `src/core/authToken.ts` and `src/core/settingsClient.ts`, and the
 * EntryPoint 0.7 revert `@zerodev/sdk` 5.5.10 decodes the smart account address from.
 */
import type { Page, Request, Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  numberToHex,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

export const FLUENT_TESTNET_CHAIN_ID = 20994;
export const SERVICE_URL = "https://api.fluent-connect.dev.gblend.xyz/api/v1";
const FLUENT_RPC_URL = "https://rpc.testnet.fluent.xyz/";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
/** Both transports wagmi falls back between for Sepolia, in AppKit's order. */
const SEPOLIA_RPC = (url: URL) =>
  (url.hostname === "rpc.walletconnect.org" &&
    url.searchParams.get("chainId") === "eip155:11155111") ||
  url.hostname === "ethereum-sepolia-rpc.publicnode.com";

/** The Fluent ID every signed-in scenario gets, whatever the Signer. */
export const SMART_ACCOUNT: Address = "0x092AE7564C6611a114C20C6df766B5B35A52334A";

export const TESTNET_TOKENS = {
  USDnr: getAddress("0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1"),
  BLEND: getAddress("0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E"),
} as const;

const entryPointAbi = parseAbi([
  "function getSenderAddress(bytes initCode)",
  "error SenderAddressResult(address sender)",
]);

/** Hosts AppKit reaches on its own on every load; aborted without being reported. */
const IGNORED_HOSTS = [
  /(^|\.)walletconnect\.(org|com)$/,
  /(^|\.)web3modal\.(org|com)$/,
  /(^|\.)reown\.com$/,
  /(^|\.)coinbase\.com$/,
  /^fonts\.(googleapis|gstatic)\.com$/,
];

export type FakeUserSettings = {
  quick_sign: boolean;
  gas_token_symbol: string | null;
  tokens: Array<{
    chain_id: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  }>;
};

/** An ERC-20 the RPC answers `symbol`, `name` and `decimals` for, as the Add token form reads. */
export type FakeContractToken = { symbol: string; name: string; decimals: number };

export type ServiceCall = { method: string; path: string; body: unknown };

export class FakeNetwork {
  /** Native and ERC-20 balances of the smart account, in base units. */
  balances: { ETH: bigint; USDnr: bigint; BLEND: bigint } = {
    ETH: parseEther("1.5"),
    USDnr: parseUnits("250", 6),
    BLEND: parseEther("1000"),
  };
  settings: FakeUserSettings = { quick_sign: true, gas_token_symbol: null, tokens: [] };
  /** Contracts beyond the default tokens, keyed by lowercase address. */
  contracts = new Map<string, FakeContractToken>();
  /** Every request to `fluent-connect-service`, in the order the page sent them. */
  readonly serviceCalls: ServiceCall[] = [];
  /** Requests to hosts nothing here fakes; see `IGNORED_HOSTS` for the ones left out. */
  readonly unhandled: string[] = [];

  constructor(private readonly page: Page) {}

  async install() {
    // Registered first, so it runs last: Playwright tries the newest route first.
    await this.page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
      const url = new URL(route.request().url());
      if (!IGNORED_HOSTS.some((host) => host.test(url.hostname))) {
        this.unhandled.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      }
      return route.abort("blockedbyclient");
    });
    await this.page.route(FLUENT_RPC_URL, (route) => this.fluentRpc(route));
    await this.page.route(`${SERVICE_URL}/**`, (route) => this.service(route));
    await this.page.route("https://api.coinbase.com/v2/prices/**", (route) => {
      const symbol = new URL(route.request().url()).pathname.split("/")[3]?.split("-")[0];
      const amount = symbol === "ETH" ? "3000" : "0.05";
      return route.fulfill({ json: { data: { amount } } });
    });
    await this.page.route("https://api.coingecko.com/**", (route) =>
      route.fulfill({ status: 404, json: {} }),
    );
    await this.page.route("https://testnet.fluentscan.xyz/api/v2/**", (route) =>
      route.fulfill({ json: { items: [], next_page_params: null } }),
    );
    await this.page.route(SEPOLIA_RPC, (route) => this.sepoliaRpc(route));
  }

  /** Service calls with this method and path, e.g. `("PATCH", "/me/settings")`. */
  callsTo(method: string, path: string) {
    return this.serviceCalls.filter((call) => call.method === method && call.path === path);
  }

  private async fluentRpc(route: Route) {
    const { id, method, params } = route.request().postDataJSON() as {
      id: number;
      method: string;
      params: unknown[];
    };
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: "2.0", id, result } });
    const revert = (data: Hex) =>
      route.fulfill({
        json: { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted", data } },
      });

    switch (method) {
      case "eth_chainId":
        return reply(numberToHex(FLUENT_TESTNET_CHAIN_ID));
      case "eth_blockNumber":
        return reply(numberToHex(1_000_000));
      case "eth_gasPrice":
        return reply(numberToHex(1_000_000_000n));
      case "eth_estimateGas":
        return reply(numberToHex(21_000n));
      case "eth_getCode": {
        const [address] = params as [string];
        return reply(this.contractAt(address) ? "0x6080" : "0x");
      }
      case "eth_getBalance":
        return reply(numberToHex(this.balances.ETH));
      case "eth_call": {
        const [{ to, data }] = params as [{ to: string; data: Hex }];
        if (to.toLowerCase() === ENTRY_POINT.toLowerCase()) {
          return revert(
            encodeErrorResult({
              abi: entryPointAbi,
              errorName: "SenderAddressResult",
              args: [SMART_ACCOUNT],
            }),
          );
        }
        const token = this.contractAt(to);
        if (!token) return reply("0x");
        const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
        const values: Record<string, unknown> = {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          balanceOf: token.balance,
        };
        if (!(functionName in values)) return revert("0x");
        const result = values[functionName];
        return reply(encodeFunctionResult({ abi: erc20Abi, functionName, result } as never));
      }
      default:
        return route.fulfill({
          json: { jsonrpc: "2.0", id, error: { code: -32601, message: `${method} not faked` } },
        });
    }
  }

  private contractAt(address: string): (FakeContractToken & { balance: bigint }) | undefined {
    const key = address.toLowerCase();
    if (key === TESTNET_TOKENS.USDnr.toLowerCase()) {
      return { symbol: "USDnr", name: "USDnr", decimals: 6, balance: this.balances.USDnr };
    }
    if (key === TESTNET_TOKENS.BLEND.toLowerCase()) {
      return { symbol: "BLEND", name: "Blend", decimals: 18, balance: this.balances.BLEND };
    }
    const token = this.contracts.get(key);
    return token && { ...token, balance: 0n };
  }

  /** The Swap screen reads its relayer fee from Sepolia before any wallet is connected. */
  private async sepoliaRpc(route: Route) {
    const body = JSON.parse(route.request().postData() ?? "{}") as { id: number; method: string };
    const result =
      body.method === "eth_chainId"
        ? numberToHex(11155111)
        : numberToHex(parseEther("0.0001"), { size: 32 });
    return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
  }

  private async service(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const body = readBody(request);
    this.serviceCalls.push({ method: request.method(), path, body });

    if (request.method() === "POST" && path === "/auth/exchange/privy") {
      return route.fulfill({ json: { token: authToken() } });
    }
    if (path === "/auth/revoke") return route.fulfill({ json: {} });
    if (path === "/me/settings") {
      if (request.method() === "PATCH") this.settings = { ...this.settings, ...(body as object) };
      return route.fulfill({ json: this.settings });
    }
    const tokenPath = path.match(/^\/me\/tokens\/(\d+)\/(0x[0-9a-fA-F]{40})$/);
    if (tokenPath) {
      const [, chainId, address] = tokenPath;
      this.settings.tokens = this.settings.tokens.filter(
        (token) => token.address.toLowerCase() !== address.toLowerCase(),
      );
      if (request.method() === "PUT") {
        const token = body as { symbol: string; name: string; decimals: number };
        this.settings.tokens.push({ chain_id: Number(chainId), address, ...token });
      }
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 404,
      json: { code: "not_found", message: `${path} not faked` },
    });
  }
}

function readBody(request: Request): unknown {
  const raw = request.postData();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Unsigned on purpose: the widget reads `exp` and never verifies the signature. */
function authToken() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 300;
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({ sub: "e2e", exp })}.signature`;
}
