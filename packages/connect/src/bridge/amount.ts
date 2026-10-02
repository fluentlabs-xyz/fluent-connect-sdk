import { formatUnits, parseUnits } from "viem";

/** The most any bridged token carries; a token's own `decimals` caps lower. */
export const BRIDGE_AMOUNT_MAX_DECIMALS = 18;

/**
 * Keeps the field to something `parseUnits` can always read: digits, at most one
 * separator, no more decimals than the token has. A comma is accepted because half the world
 * types one, and normalised to a dot.
 *
 * Returns the previous value for input it cannot make sense of, so a stray
 * keystroke is dropped rather than blanking what the user already typed.
 */
export function sanitizeBridgeAmountInput(
  next: string,
  previous = "",
  decimals = BRIDGE_AMOUNT_MAX_DECIMALS,
): string {
  const normalized = next.replace(/,/g, ".").replace(/\s/g, "");
  if (normalized === "") return "";
  if (!/^\d*\.?\d*$/.test(normalized)) return previous;

  const [whole = "", fraction] = normalized.split(".");
  // "007" is a typo, "0.7" is not — only collapse leading zeros that lead digits.
  const trimmedWhole = whole.length > 1 ? whole.replace(/^0+(?=\d)/, "") : whole;

  if (fraction === undefined) return trimmedWhole;
  return `${trimmedWhole}.${fraction.slice(0, decimals)}`;
}

export type BridgeAmount = {
  /** Present only once the input is a complete, positive number. */
  wei?: bigint;
  /** Shown under the form; absent while the field is empty or mid-typing. */
  error?: string;
  /** True while the input is a valid prefix like "0." — no error, no value yet. */
  incomplete: boolean;
};

/**
 * Validates against what the wallet can actually part with, not just the raw
 * balance: the bridge fee and a gas reserve are already subtracted from
 * `spendable` by the caller.
 */
export function validateBridgeAmount({
  input,
  spendable,
  symbol,
  decimals = BRIDGE_AMOUNT_MAX_DECIMALS,
  native = true,
}: {
  input: string;
  /** What the wallet can part with, in the token's smallest unit; `undefined` until loaded. */
  spendable?: bigint;
  symbol: string;
  decimals?: number;
  /** The chain's own coin pays its fee and gas; an ERC-20 does not, so its copy must not claim so. */
  native?: boolean;
}): BridgeAmount {
  const trimmed = input.trim();
  if (!trimmed || trimmed === ".") return { incomplete: true };
  // "0." and "1." are on the way to a number, not a mistake.
  if (trimmed.endsWith(".")) return { incomplete: true };

  let wei: bigint;
  try {
    wei = parseUnits(trimmed as `${number}`, decimals);
  } catch {
    return { error: "Enter a valid amount", incomplete: false };
  }

  if (wei <= 0n) {
    // Typing "0" before "0.5" is normal; only a settled zero is worth flagging.
    return trimmed === "0" ? { incomplete: true } : { error: "Enter an amount greater than zero", incomplete: false };
  }

  if (spendable !== undefined) {
    if (spendable === 0n) {
      return {
        error: native
          ? `Not enough ${symbol} to cover the deposit and its gas`
          : `You have no ${symbol} to deposit`,
        incomplete: false,
      };
    }
    if (wei > spendable) {
      return { wei, error: `Maximum ${formatUnits(spendable, decimals)} ${symbol}`, incomplete: false };
    }
  }

  return { wei, incomplete: false };
}
