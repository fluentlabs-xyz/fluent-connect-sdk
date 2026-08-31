import { useCallback, useEffect, useRef } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import type { FluentWidgetNetwork } from "../../core/network";
import { copyAddressToClipboard } from "../../utils/copyAddress";
import { explorerAddress } from "../../utils/explorerAddress";

/**
 * Account-menu behavior: opening the drawer, the header actions (open on
 * explorer / copy address / settings / disconnect), and auto-closing the drawer
 * when the account disconnects (so a later reconnect doesn't reopen it unasked).
 */
export function useAccountMenu(params: {
  accountMenuAddress?: string;
  network: FluentWidgetNetwork;
  hasConnectedAccount: boolean;
  setAccountOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  /** Returns the teardown promise; the menu is fire-and-forget and ignores it. */
  requestDisconnect: () => void | Promise<void>;
  onOpenSettings?: () => void;
  track: FluentAnalyticsTrack;
}) {
  const {
    accountMenuAddress,
    network,
    hasConnectedAccount,
    setAccountOpen,
    requestDisconnect,
    onOpenSettings,
    track,
  } = params;

  const openAccountMenu = useCallback(() => setAccountOpen(true), [setAccountOpen]);

  const handleAccountMenuAction = useCallback(
    (value: string | null) => {
      if (!value || !accountMenuAddress) return;

      if (value === "explorer") {
        const url = explorerAddress(accountMenuAddress, network);
        track("outbound_link_clicked", {
          label: "explorer",
          destination_domain: new URL(url, location.href).hostname,
          surface: "account_menu",
        });
        const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
        if (popup) popup.opener = null;
        return;
      }
      if (value === "copy") {
        copyAddressToClipboard(accountMenuAddress);
        return;
      }
      if (value === "settings") {
        onOpenSettings?.();
        return;
      }
      if (value === "disconnect") {
        requestDisconnect();
      }
    },
    [accountMenuAddress, network, onOpenSettings, requestDisconnect, track],
  );

  // Losing connectedness takes the drawer off screen on its own, but nothing
  // cleared the open flag, so reconnecting later reopened the menu unasked. The
  // edge, not the value: a silent-signing toggle remounts this component and a
  // fresh mount seeds the ref with the current value, so the drawer survives it.
  const wasConnected = useRef(hasConnectedAccount);
  useEffect(() => {
    if (wasConnected.current === hasConnectedAccount) return;
    wasConnected.current = hasConnectedAccount;
    if (!hasConnectedAccount) setAccountOpen(false);
  }, [hasConnectedAccount, setAccountOpen]);

  return { openAccountMenu, handleAccountMenuAction };
}
