import type { FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { formatUnits } from "viem";
import { formatFluentLocaleAmount } from "./formatFluentLocaleAmount";

/** How far the significant-digit search below is allowed to go. */
const GAS_BALANCE_MAX_FRACTION_DIGITS = 6;

/**
 * `raw` (given in `decimals`) cut to `digits` decimals. Cut, never rounded: a
 * balance is what can be spent, and 0.447937 USDnr shown as "0.45" promises a
 * cent that is not there.
 */
function truncateToFractionDigits(raw: bigint, decimals: number, digits: number) {
  return raw / 10n ** BigInt(decimals - digits);
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

  // `maximumFractionDigits` is a floor, not a promise: a caller picks it for
  // the amounts a token is usually held in, and a smaller one (0.001 USDnr
  // shown in cents) would render as a flat "0" next to a non-zero USD value.
  // So keep widening the precision until the first significant digit shows,
  // and only then stop.
  const maxDigits = Math.max(
    maximumFractionDigits,
    Math.min(balance.decimals, GAS_BALANCE_MAX_FRACTION_DIGITS),
  );
  for (let digits = maximumFractionDigits; digits <= maxDigits; digits += 1) {
    const cut = truncateToFractionDigits(balance.raw, balance.decimals, digits);
    if (cut > 0n || balance.raw === 0n) {
      return formatFluentLocaleAmount(formatUnits(cut, digits), digits);
    }
  }

  // Dust below what the cap can express. It is never worth enough to show a USD
  // value either, so a plain "0" keeps the row readable; callers surface the
  // exact amount on hover instead.
  return formatFluentLocaleAmount(0, maximumFractionDigits);
}
