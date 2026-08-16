import { useEffect, type MutableRefObject } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";

/**
 * Emits `connect_external_wallet_connected` once, and only when the user
 * actually picked an external wallet in our modal (`intent`). wagmi restoring a
 * remembered wallet, a partner handing us a pre-connected one, or a dropped
 * WalletConnect session re-establishing are not funnel steps, so they must not
 * fire the event.
 */
export function useExternalWalletAnalytics(params: {
  analytics: MutableRefObject<{ intent: boolean; connected: boolean }>;
  connected: boolean;
  chainId?: number;
  track: FluentAnalyticsTrack;
}) {
  const { analytics, connected, chainId, track } = params;
  useEffect(() => {
    const state = analytics.current;
    if (connected && !state.connected) {
      state.connected = true;
      if (state.intent) {
        state.intent = false;
        track("connect_external_wallet_connected", { chain_id: chainId });
      }
    }
    if (!connected) state.connected = false;
  }, [analytics, chainId, connected, track]);
}
