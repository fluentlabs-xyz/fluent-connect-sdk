import type { FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { formatUnits } from "viem";
import { formatFluentLocaleAmount } from "./formatFluentLocaleAmount";

/** How far the significant-digit search below is allowed to go. */
const GAS_BALANCE_MAX_FRACTION_DIGITS = 6;

/**
 * Returns `raw` (given in `decimals`) cut to `digits` decimals. Cut, never rounded: a
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

  // `maximumFractionDigits` is a floor: the precision widens until the first significant digit
  // shows, since 0.001 USDnr in cents would read as a flat "0" beside a non-zero USD value.
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

  // Dust below what the cap can express: a plain "0" keeps the row readable, and the token
  // list shows the exact amount on hover.
  return formatFluentLocaleAmount(0, maximumFractionDigits);
}
