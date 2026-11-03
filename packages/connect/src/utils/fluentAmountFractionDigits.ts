/** Past six fraction digits a token amount stops fitting a 384px row. */
export const FLUENT_AMOUNT_FRACTION_DIGITS = 6;

/**
 * Tokens worth one dollar each. Their amounts print in cents, like the USD figure beside
 * them, because digits past the cent are worth less than one.
 */
const USD_PEGGED_SYMBOLS: ReadonlySet<string> = new Set(["USDnr", "USDC"]);

/** How many fraction digits an amount of `symbol` prints with, at most. */
export function fluentAmountFractionDigits(symbol: string): number {
  return USD_PEGGED_SYMBOLS.has(symbol) ? 2 : FLUENT_AMOUNT_FRACTION_DIGITS;
}
