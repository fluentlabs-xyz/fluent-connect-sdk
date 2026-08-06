/**
 * Privy promotes the last-used login method to the top of its modal via
 * localStorage. Fluent Connect always wants X first (email in overflow), so
 * clear these keys before mounting/opening Privy login.
 */
export function clearPrivyRecentLoginMethod(appId: string): void {
  if (typeof window === "undefined" || !appId) return;

  try {
    window.localStorage.removeItem(`privy:${appId}:recent-login-method`);
    window.localStorage.removeItem(`privy:${appId}:recent-login-wallet-client`);
    window.localStorage.removeItem(`privy:${appId}:recent-login-chain-type`);
  } catch {
    // Storage may be unavailable; login still works with Privy's default order.
  }
}
