import { Blocks, Bot, Vault } from "lucide-react";

const appUrl = (key: string, fallback: string) =>
  (import.meta.env[key] as string | undefined)?.trim() || fallback;

export const showcaseApps = [
  {
    id: "chess",
    name: "Fluent Chess Blitz",
    category: "Permissioned sessions",
    description: "Play on-chain chess with a scoped ZeroDev bot session and BLEND-paid moves.",
    href: appUrl(
      "VITE_SHOWCASE_CHESS_URL",
      "https://fluent-chess-preview.vercel.app/",
    ),
    action: "Open chess",
    icon: Bot,
    accent: "teal",
    meta: "Sessions + ERC-20 gas",
  },
  {
    id: "vault",
    name: "stBLEND Vault",
    category: "DeFi actions",
    description: "Deposit and withdraw through an ERC-4626 vault using the shared Fluent widget.",
    href: appUrl(
      "VITE_SHOWCASE_VAULT_URL",
      "https://fluent-vault-preview.vercel.app/",
    ),
    action: "Open vault",
    icon: Vault,
    accent: "yellow",
    meta: "Batch operations",
  },
  {
    id: "paymaster",
    name: "Paymaster Transfer",
    category: "ERC-20 gas",
    description: "Send BLEND from a Fluent smart account and pay the UserOperation gas in BLEND.",
    href: appUrl(
      "VITE_SHOWCASE_PAYMASTER_URL",
      "https://fluent-paymaster-preview.vercel.app/",
    ),
    action: "Open paymaster demo",
    icon: Blocks,
    accent: "pink",
    meta: "ZeroDev paymaster",
  },
] as const;
