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
 * A symbol that can pay for gas. Deliberately `string`: which tokens are
 * payable is data on the token definitions now, not a fixed set of literals.
 */
export type FluentGasTokenSymbol = string;

/**
 * Resolve a gas token symbol to its ERC-20 paymaster address on `network`.
 * Returns `undefined` for the native currency, which pays gas directly, and for
 * any symbol that is not a gas token on this network.
 *
 * Matching is case-insensitive to agree with
 * `resolveFluentZeroDevErc20PaymasterToken`, which uppercases its keys — the two
 * feed the same approval call and must not disagree on `"usdnr"`.
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
export type FluentGasPaymentValueTier = "green" | "yellow" | "red" | "neutral" | "unknown";
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

  // Priority comes off the balances themselves — they carry the token
  // definition, `gasPriority` included — so there is no separate order to keep
  // in step, and a non-default token can never be picked.
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
 * Narrow a token list down to the gas tokens in it, in paymaster priority
 * order. Only gas selection may use this — running the whole display list
 * through it is what previously made the token list inextensible.
 *
 * `mergeFluentDisplayTokens` already strips `gasPriority` off untrusted
 * sources, so the `isFluentDefaultToken` filter here is the safety net for a
 * caller handed a raw list — an integrator prop, say — that never went through
 * the merge. It stays because this list decides what the paymaster is asked to
 * charge.
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
