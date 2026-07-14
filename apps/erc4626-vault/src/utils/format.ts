import { fluentTestnet } from "@fluent/wallet-sdk";
import { formatUnits } from "viem";

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function explorerAddress(address: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${fluentTestnet.blockExplorers?.default.url}/tx/${hash}`;
}

export function formatAmount(value: bigint, decimals: number, precision = 4): string {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, precision).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatTimestamp(timestamp: bigint): string {
  if (timestamp === 0n) return "Inactive";
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}
