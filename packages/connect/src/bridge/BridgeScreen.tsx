import { ExternalLink } from "lucide-react";
import { useContext, useMemo } from "react";
import { WagmiContext } from "wagmi";
import type { Address } from "viem";

import { type FluentAnalyticsTrack } from "../core/analytics";
import { resolveFluentWidgetConfig, type FluentWidgetConfig } from "../core/config";
import { buildFluentBridgeUrl } from "../utils";
import { BridgeForm } from "./BridgeForm";
import { BridgeWalletPicker } from "./BridgeWalletPicker";
import { getFluentBridgeRoute } from "./route";

/**
 * The whole Bridge page: its own wallet picker, the deposit form, and the way out
 * to the Portal. Transfer history is not here — the wallet menu's Activity panel
 * lists it (`WalletMenuActivity`).
 *
 * Nothing here reaches into the wallet menu, and the wallet menu holds no bridge
 * state — the drawer picks between the two by tab, so the bridge can grow (or be
 * ripped out) without touching balances, tokens or reputation. The wallet
 * connection itself is the widget's, because a page cannot own an injected
 * wallet the rest of the page also sees; see `BridgeWalletPicker`.
 */
export function BridgeScreen({
  config,
  recipient,
  onSignIn,
  track,
}: {
  config: FluentWidgetConfig;
  /** Fluent account the deposit is credited to. */
  recipient?: Address;
  /** Starts a Fluent sign-in when there is no account to credit yet. */
  onSignIn?: () => void;
  track: FluentAnalyticsTrack;
}) {
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const route = useMemo(
    () => getFluentBridgeRoute(resolvedConfig.network),
    [resolvedConfig.network],
  );
  // The form runs on the widget's wagmi config rather than one of its own, so it
  // is only mountable where that exists. `ReownProvider` renders its children
  // bare when no Reown project id is configured, and the harnesses mount this
  // card on its own — neither should crash the page, they just lose the form.
  const hasWagmi = useContext(WagmiContext) !== undefined;

  const openPortal = () => {
    const url = buildFluentBridgeUrl(resolvedConfig.bridgeUrl, recipient);
    track("outbound_link_clicked", {
      label: "bridge",
      destination_domain: new URL(url, location.href).hostname,
      surface: "bridge_page",
    });
    const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };

  return (
    <div className="flex w-full flex-col gap-4 flex-1 *:flex-1 *:flex *:flex-col">
      {route && hasWagmi ? (
        <BridgeWalletPicker route={route}>
          <BridgeForm
            route={route}
            network={resolvedConfig.network}
            recipient={recipient}
            onSignIn={onSignIn}
            onOpenPortal={openPortal}
          />
        </BridgeWalletPicker>
      ) : (
        <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
          <span className="text-sm font-medium">Bridging is not available here</span>
          <span className="text-xs opacity-50">
            This network has no Ethereum pairing configured. Use the Portal instead.
          </span>
        </div>
      )}

    </div>
  );
}
