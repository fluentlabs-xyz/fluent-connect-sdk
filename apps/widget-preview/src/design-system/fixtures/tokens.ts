import {
  getFluentDefaultWidgetDisplayTokens,
  getFluentGasPaymentTokens,
  mergeFluentDisplayTokens,
} from "@fluent.xyz/connect";
import type { FluentTokenBalance, FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

/** A token a person added by contract address: listed last and labelled as theirs. */
export const userToken: FluentTokenDefinition = {
  chainId: 20994,
  address: "0x1ccF23916C572379630b067e9a0CbBddb56C5e72",
  name: "Preview Token",
  symbol: "PRV",
  decimals: 18,
};

/** The testnet defaults plus the user token above, in list order. */
export const displayTokens = mergeFluentDisplayTokens({
  defaults: getFluentDefaultWidgetDisplayTokens("testnet"),
  user: [userToken],
});

export const gasTokens = getFluentGasPaymentTokens(displayTokens);

const RAW_BY_SYMBOL: Record<string, { raw: bigint; formatted: string }> = {
  ETH: { raw: 1_234_500_000_000_000_000n, formatted: "1.2345" },
  USDnr: { raw: 2_500_000_000n, formatted: "2500" },
  BLEND: { raw: 48_000_000_000_000_000_000n, formatted: "48" },
  USDC: { raw: 12_000_000n, formatted: "12" },
  PRV: { raw: 7_000_000_000_000_000_000n, formatted: "7" },
};

/** Every display token with a balance. */
export const balances: FluentTokenBalance[] = displayTokens.map((token) => {
  const value = RAW_BY_SYMBOL[token.symbol];
  return value
    ? { ...token, raw: value.raw, formatted: value.formatted, status: "ready" }
    : { ...token, raw: 0n, formatted: "0", status: "ready" };
});

/** The same list while the reads failed. */
export const erroredBalances: FluentTokenBalance[] = displayTokens.map((token) => ({
  ...token,
  raw: null,
  formatted: null,
  status: "error",
  error: "RPC unreachable",
}));

export const usdPrices: Record<string, number> = Object.fromEntries(
  displayTokens.map((token) => [
    token.identity,
    token.symbol === "ETH" ? 2480 : token.symbol === "BLEND" ? 0.42 : 1,
  ]),
);

export const existingSymbols: ReadonlySet<string> = new Set(
  displayTokens.map((token) => token.symbol.toLowerCase()),
);
export const listedIdentities: ReadonlySet<string> = new Set(
  displayTokens.map((token) => token.identity),
);
