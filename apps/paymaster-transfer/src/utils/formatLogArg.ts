export function formatLogArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (_key, next) =>
      typeof next === "bigint" ? next.toString() : next,
    );
  } catch {
    return String(value);
  }
}
