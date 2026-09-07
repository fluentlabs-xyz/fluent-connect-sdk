import type { FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { formatUnits } from "viem";
import { formatFluentLocaleAmount } from "./formatFluentLocaleAmount";

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
