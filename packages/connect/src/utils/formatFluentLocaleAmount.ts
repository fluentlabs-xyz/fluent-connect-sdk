/** Separators for every amount the widget renders: `,` thousands, `.` decimals. */
export const FLUENT_AMOUNT_LOCALE = "en-US";

export const FLUENT_DECIMAL_SEPARATOR =
  new Intl.NumberFormat(FLUENT_AMOUNT_LOCALE)
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";

export function formatFluentLocaleAmount(value: string | number, maximumFractionDigits = 2) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return typeof value === "string" ? value : String(value);
  return amount.toLocaleString(FLUENT_AMOUNT_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}
