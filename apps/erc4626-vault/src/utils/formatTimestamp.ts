export function formatTimestamp(timestamp: bigint): string {
  if (timestamp === 0n) return "Inactive";
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}
