import type { FluentTokenBalance, FluentTokenDefinition } from "@fluent/connect-sdk";
import { formatUnits, parseUnits } from "viem";

export const FLUENT_GAS_PAYMENT_PRIORITY = ["USDnr", "BLEND", "ETH"] as const;

export type FluentGasPaymentSymbol = typeof FLUENT_GAS_PAYMENT_PRIORITY[number];
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

export function formatFluentGasTokenBalance(
  balance: Pick<FluentTokenBalance, "raw" | "decimals" | "formatted">,
  maximumFractionDigits = 3,
) {
  if (balance.raw === null || balance.formatted === null) return null;
  if (maximumFractionDigits < 0 || !Number.isInteger(maximumFractionDigits)) {
    throw new Error("maximumFractionDigits must be a non-negative integer");
  }
  if (balance.decimals <= maximumFractionDigits) return balance.formatted;

  const discardedScale = 10n ** BigInt(balance.decimals - maximumFractionDigits);
  const rounded = (balance.raw + discardedScale / 2n) / discardedScale;
  return formatUnits(rounded, maximumFractionDigits);
}

function formatEthValue(ethValueWei: bigint) {
  if (ethValueWei === 0n) return "0 ETH";
  const formatted = formatUnits(ethValueWei, 18);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmedFraction ? `${whole}.${trimmedFraction}` : whole} ETH`;
}
