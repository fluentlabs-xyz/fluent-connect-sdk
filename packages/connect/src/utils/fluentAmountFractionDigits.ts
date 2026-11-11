/** The most fraction digits a token amount prints with: past six it stops fitting a 384px row. */
export const FLUENT_AMOUNT_FRACTION_DIGITS = 6;

/**
 * The symbols of tokens worth one dollar each. Their amounts print in cents, like the USD figure
 * beside them, because a digit past the cent is worth less than a cent.
 */
const USD_PEGGED_SYMBOLS: ReadonlySet<string> = new Set(["USDnr", "USDC"]);

/** Returns the most fraction digits an amount of `symbol` prints with. */
export function fluentAmountFractionDigits(symbol: string): number {
  return USD_PEGGED_SYMBOLS.has(symbol) ? 2 : FLUENT_AMOUNT_FRACTION_DIGITS;
}
