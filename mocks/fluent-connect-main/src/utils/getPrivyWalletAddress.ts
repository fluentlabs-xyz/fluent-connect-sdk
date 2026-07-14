export function getPrivyWalletAddress(user: unknown): string | undefined {
  if (!user || typeof user !== "object") return undefined;
  const wallet = (user as { wallet?: { address?: string } }).wallet;
  return wallet?.address;
}