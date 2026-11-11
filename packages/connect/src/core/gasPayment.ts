import {
  getFluentDefaultWidgetGasTokens,
  isFluentDefaultToken,
  isFluentNativeToken,
  sortFluentGasTokens,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { formatUnits, parseUnits, type Address } from "viem";

import type { FluentWidgetNetwork } from "./network";

/**
 * The symbol of a Gas token. A plain `string`, because which tokens are Gas tokens is data on
 * the token definitions, not a fixed set of literals.
 */
export type FluentGasTokenSymbol = string;

/**
 * What the widget charges gas to until the person chooses otherwise, and what
 * a stored choice falls back to when it names no Gas token on this network.
 */
export const FLUENT_WIDGET_DEFAULT_GAS_TOKEN: FluentGasTokenSymbol = "ETH";

/**
 * Returns the symbol of the Gas token on `network` that matches `symbol` ignoring case, in the
 * token's own spelling, or `undefined` when `network` has none. What a miss means is the
 * caller's to say.
 */
export function resolveDefaultGasToken(
  network: FluentWidgetNetwork,
  symbol = FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
): FluentGasTokenSymbol | undefined {
  const wanted = symbol.toUpperCase();
  const token = getFluentDefaultWidgetGasTokens(network).find(
    (candidate) => candidate.symbol.toUpperCase() === wanted,
  );
  return token?.symbol;
}

/**
 * Returns the contract address of the Gas token whose symbol is `symbol` on `network`, the
 * address the ERC-20 paymaster charges; `undefined` for the native currency, which pays gas
 * directly, and for a symbol that is no Gas token on this network.
 *
 * Matching ignores case to agree with `resolveFluentZeroDevErc20PaymasterToken`, which
 * uppercases its keys: the two must not disagree on `"usdnr"`.
 */
export function getFluentGasTokenAddress(
  symbol: FluentGasTokenSymbol,
  network: FluentWidgetNetwork,
): Address | undefined {
  const wanted = symbol.toUpperCase();
  const token = getFluentDefaultWidgetGasTokens(network).find(
    (candidate) => candidate.symbol.toUpperCase() === wanted,
  );
  if (!token || isFluentNativeToken(token)) return undefined;
  return token.address;
}

/**
 * The approval the widget adds on its own to an operation paid in a Gas token, in whole tokens:
 * `amount` is approved to the ERC-20 paymaster when the account's allowance is below
 * `refreshBelow`, a tenth of it, so a Fluent ID can pay gas in a Gas token it never approved.
 *
 * Keyed by the upper-cased symbol of a Default token, the one other per-symbol table beside the
 * icon map (ADR 0001). It stays honest the way that map does: `gasPayment.test.ts` asserts that
 * every Gas token Fluent ships has an entry, so a token given a `gasPriority` cannot reach the
 * paymaster with no approval to pay it.
 */
const FLUENT_GAS_TOKEN_APPROVALS: Record<string, { amount: string; refreshBelow: string }> = {
  USDNR: { amount: "1", refreshBelow: "0.1" },
  BLEND: { amount: "10", refreshBelow: "1" },
};

/** What the widget approves of a Gas token by itself, in the token's smallest unit. */
export type FluentGasTokenApproval = {
  /** The amount approved to the ERC-20 paymaster. */
  amount: bigint;
  /** The allowance below which the approval is added. */
  refreshBelow: bigint;
};

/**
 * Returns the automatic approval of the Gas token at `gasToken` on `network`, scaled by the
 * token's own decimals; `undefined` for an address that is no Gas token there, or for a Gas
 * token with no entry in the approval table.
 */
export function getFluentGasTokenApproval(
  gasToken: Address,
  network: FluentWidgetNetwork,
): FluentGasTokenApproval | undefined {
  const wanted = gasToken.toLowerCase();
  const token = getFluentDefaultWidgetGasTokens(network).find(
    (candidate) => !isFluentNativeToken(candidate) && candidate.address?.toLowerCase() === wanted,
  );
  const approval = token && FLUENT_GAS_TOKEN_APPROVALS[token.symbol.toUpperCase()];
  if (!token || !approval) return undefined;
  return {
    amount: parseUnits(approval.amount, token.decimals),
    refreshBelow: parseUnits(approval.refreshBelow, token.decimals),
  };
}
export type FluentGasPaymentValueTier = "green" | "yellow" | "red" | "neutral" | "unknown";
/**
 * What one unit of each Gas token is worth in ETH, as a decimal string, keyed by its
 * `FluentGasTokenSymbol`.
 *
 * @experimental May change or be removed in a minor release while the defaults are measured;
 * the defaults are the recommended setting.
 */
export type FluentGasPaymentEthRates = Partial<Record<FluentGasTokenSymbol, string>>;

export const FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES = {
  ETH: "1",
} as const satisfies FluentGasPaymentEthRates;

export type FluentGasPaymentSelection =
  | {
      status: "ready";
      symbol: FluentGasTokenSymbol;
      balance: FluentTokenBalance;
    }
  | {
      status: "bridge-required";
      symbol: null;
      balance: null;
    }
  | {
      status: "loading";
      symbol: null;
      balance: null;
    };

export function selectFluentGasPaymentToken(params: {
  balances: readonly FluentTokenBalance[];
  loading?: boolean;
}): FluentGasPaymentSelection {
  if (params.loading) {
    return {
      status: "loading",
      symbol: null,
      balance: null,
    };
  }

  // Priority comes off the balances, which carry `gasPriority`, so no separate order is kept in
  // step; a token that is not a Default token is never picked.
  for (const balance of getFluentGasPaymentTokens(params.balances)) {
    if (balance.status === "ready" && balance.raw !== null && balance.raw > 0n) {
      return {
        status: "ready",
        symbol: balance.symbol,
        balance,
      };
    }
  }

  return {
    status: "bridge-required",
    symbol: null,
    balance: null,
  };
}

/**
 * Returns the Gas tokens in `tokens`, lowest `gasPriority` first. It drops every token that is
 * not a Gas token, so it is not for filtering the list of Display tokens.
 *
 * `mergeFluentDisplayTokens` already strips `gasPriority` off Integrator and User tokens; the
 * `isFluentDefaultToken` filter here covers a list that never went through that merge, because
 * this list decides what the paymaster is asked to charge.
 */
export function getFluentGasPaymentTokens<T extends FluentTokenDefinition>(
  tokens: readonly T[],
): readonly T[] {
  return sortFluentGasTokens(tokens.filter(isFluentDefaultToken));
}

export function getFluentGasPaymentEthValue(params: {
  balance: FluentTokenBalance | undefined;
  ethValueByToken?: FluentGasPaymentEthRates;
}) {
  const balance = params.balance;
  if (!balance || balance.status !== "ready" || balance.raw === null) {
    return {
      ethValueWei: null,
      formatted: null,
      tier: "unknown" as const,
    };
  }

  const rates: FluentGasPaymentEthRates = {
    ...FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES,
    ...params.ethValueByToken,
  };
  const rate = rates[balance.symbol];
  if (!rate) {
    return {
      ethValueWei: null,
      formatted: null,
      tier: "unknown" as const,
    };
  }

  const ethValueWei = balance.raw * parseUnits(rate, 18) / 10n ** BigInt(balance.decimals);
  return {
    ethValueWei,
    formatted: formatEthValue(ethValueWei),
    tier: getFluentGasPaymentValueTier(ethValueWei),
  };
}

/**
 * Returns ETH-value rates for `getFluentGasPaymentEthValue`, derived from the USD prices the
 * widget holds, so a balance can be valued in ETH when the App sets no
 * `gasPayment.ethValueByToken`. The prices are keyed by Token identity and the rates by symbol.
 * A rate in `configured` wins over the derived one for its symbol; with no USD price for the
 * native token, only `configured` is returned.
 */
export function deriveFluentGasEthRates(params: {
  tokens: readonly (FluentTokenDefinition & { identity: string })[];
  usdPrices: Readonly<Record<string, number>>;
  configured?: FluentGasPaymentEthRates;
}): FluentGasPaymentEthRates {
  const native = params.tokens.find(isFluentNativeToken);
  const ethPrice = native ? params.usdPrices[native.identity] : undefined;
  if (!ethPrice || !Number.isFinite(ethPrice)) return { ...params.configured };

  const derived: Record<string, string> = {};
  for (const token of params.tokens) {
    const price = params.usdPrices[token.identity];
    if (price === undefined || !Number.isFinite(price)) continue;
    const rate = price / ethPrice;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    // Fixed notation: `parseUnits` reads this back as a decimal string and would mis-parse
    // "1e-7".
    derived[token.symbol] = rate.toFixed(18);
  }
  return { ...derived, ...params.configured };
}

export function getFluentGasPaymentValueTier(ethValueWei: bigint): FluentGasPaymentValueTier {
  if (ethValueWei > parseUnits("0.001", 18)) return "green";
  if (ethValueWei > parseUnits("0.0001", 18)) return "yellow";
  if (ethValueWei > 0n && ethValueWei < parseUnits("0.000001", 18)) return "red";
  if (ethValueWei > 0n) return "neutral";
  return "neutral";
}

function formatEthValue(ethValueWei: bigint) {
  if (ethValueWei === 0n) return "0 ETH";
  const formatted = formatUnits(ethValueWei, 18);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmedFraction ? `${whole}.${trimmedFraction}` : whole} ETH`;
}
