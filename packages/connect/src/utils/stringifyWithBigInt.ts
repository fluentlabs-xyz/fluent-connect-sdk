/** `JSON.stringify` that writes bigints as decimal strings instead of throwing. */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, next) => (typeof next === "bigint" ? next.toString() : next),
    space,
  );
}
