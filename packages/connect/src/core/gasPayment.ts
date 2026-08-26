import type { FluentTokenBalance, FluentTokenDefinition } from "@fluent.xyz/connect-sdk";
import { formatUnits, parseUnits, type Address } from "viem";

import { getFluentErc20PaymasterTokenAddresses, type FluentWidgetNetwork } from "./network";

export const FLUENT_GAS_PAYMENT_PRIORITY = ["USDnr", "BLEND", "ETH"] as const;

export type FluentGasPaymentSymbol = typeof FLUENT_GAS_PAYMENT_PRIORITY[number];

/**
 * Resolve a gas token symbol to its ERC-20 paymaster address on `network`.
 * Returns `undefined` for native `ETH` (no paymaster) and for a symbol without a
 * configured address on the network.
 */
export function getFluentGasTokenAddress(
  symbol: FluentGasPaymentSymbol,
  network: FluentWidgetNetwork,
): Address | undefined {
  if (symbol === "ETH") return undefined;
  const addresses = getFluentErc20PaymasterTokenAddresses(network);
  return symbol === "BLEND" ? addresses.BLEND : addresses.USDnr;
}
export type FluentGasPaymentValueTier = "green" | "yellow" | "red" | "neutral" | "unknown";
export type FluentGasPaymentEthRates = Partial<Record<FluentGasPaymentSymbol, string>>;

export const FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES = {
  ETH: "1",
} as const satisfies FluentGasPaymentEthRates;

export type FluentGasPaymentSelection =
  | {
      status: "ready";
      symbol: FluentGasPaymentSymbol;
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

  for (const symbol of FLUENT_GAS_PAYMENT_PRIORITY) {
    const balance = params.balances.find((item) => item.symbol === symbol);
    if (balance?.status === "ready" && balance.raw !== null && balance.raw > 0n) {
      return {
        status: "ready",
        symbol,
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

export function getFluentGasPaymentTokens(tokens: readonly FluentTokenDefinition[]) {
  return FLUENT_GAS_PAYMENT_PRIORITY
    .map((symbol) => tokens.find((token) => token.symbol === symbol))
    .filter((token): token is FluentTokenDefinition => Boolean(token));
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

  const rates = {
    ...FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES,
    ...params.ethValueByToken,
  };
  const rate = rates[balance.symbol as FluentGasPaymentSymbol];
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

/** How far the significant-digit search below is allowed to go. */
const GAS_BALANCE_MAX_FRACTION_DIGITS = 6;

/** Half-up rounding of `raw` (given in `decimals`) down to `digits` decimals. */
function roundToFractionDigits(raw: bigint, decimals: number, digits: number) {
  const discardedScale = 10n ** BigInt(decimals - digits);
  return (raw + discardedScale / 2n) / discardedScale;
}

export function formatFluentGasTokenBalance(
  balance: Pick<FluentTokenBalance, "raw" | "decimals" | "formatted">,
  maximumFractionDigits = 1,
) {
  if (balance.raw === null || balance.formatted === null) return null;
  if (maximumFractionDigits < 0 || !Number.isInteger(maximumFractionDigits)) {
    throw new Error("maximumFractionDigits must be a non-negative integer");
  }

  if (balance.decimals <= maximumFractionDigits) {
    return formatFluentLocaleAmount(balance.formatted, maximumFractionDigits);
  }

  // `maximumFractionDigits` is a floor, not a promise: the callers pick it for
  // tokens counted in tens or thousands, and at 0 decimals a real ETH balance
  // (0.001 ETH ≈ a few dollars) would render as a flat "0" next to a non-zero
  // USD value. So keep widening the precision until the first significant digit
  // shows, and only then stop.
  const maxDigits = Math.max(
    maximumFractionDigits,
    Math.min(balance.decimals, GAS_BALANCE_MAX_FRACTION_DIGITS),
  );
  for (let digits = maximumFractionDigits; digits <= maxDigits; digits += 1) {
    const rounded = roundToFractionDigits(balance.raw, balance.decimals, digits);
    if (rounded > 0n || balance.raw === 0n) {
      return formatFluentLocaleAmount(formatUnits(rounded, digits), digits);
    }
  }

  // Dust below what the cap can express. It is never worth enough to show a USD
  // value either, so a plain "0" keeps the row readable; callers surface the
  // exact amount on hover instead.
  return formatFluentLocaleAmount(0, maximumFractionDigits);
}

/** de-DE separators: `.` thousands, `,` decimals (same as portfolio total). */
export function formatFluentLocaleAmount(value: string | number, maximumFractionDigits = 2) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return typeof value === "string" ? value : String(value);
  return amount.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatEthValue(ethValueWei: bigint) {
  if (ethValueWei === 0n) return "0 ETH";
  const formatted = formatUnits(ethValueWei, 18);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmedFraction ? `${whole}.${trimmedFraction}` : whole} ETH`;
}
