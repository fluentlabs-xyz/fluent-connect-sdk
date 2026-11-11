import { useEffect, type MutableRefObject } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";

/**
 * Tracks `connect_external_wallet_connected` when an External wallet connects after the user
 * picked it in the widget's connect modal (`intent`), once per pick. A connection the user did
 * not pick there (wagmi restoring a remembered wallet, an App passing in a connected one, a
 * WalletConnect session reconnecting) is not a funnel step and tracks nothing.
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
