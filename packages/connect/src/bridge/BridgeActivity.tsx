import { useContext, useMemo } from "react";
import { WagmiContext } from "wagmi";

import type { FluentWidgetNetwork } from "../core/network";
import { BridgeHistory } from "./BridgeHistory";
import { BridgeWalletPicker } from "./BridgeWalletPicker";
import type { BridgeActivitySelection } from "./historyRows";
import { getFluentBridgeRoute } from "./route";

/**
 * The wallet menu's Activity panel: the bridge's transfer history, listed for
 * the external wallet that signs deposits.
 *
 * `BridgeHistory` reads that wallet through wagmi and offers RainbowKit's
 * connect modal when there is none, so it needs the same providers as the
 * bridge form. `ReownProvider` renders its children bare without a Reown
 * project id, and the preview harnesses mount the wallet menu card on its own —
 * neither should crash the card, they just lose the list.
 */
export function BridgeActivity({
  network,
  onOpenRow,
}: {
  network: FluentWidgetNetwork;
  onOpenRow: (selection: BridgeActivitySelection) => void;
}) {
  const route = useMemo(() => getFluentBridgeRoute(network), [network]);
  const hasWagmi = useContext(WagmiContext) !== undefined;

  if (!route || !hasWagmi) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
        <span className="text-sm font-medium">No activity to show</span>
        <span className="text-xs opacity-50">
          Bridge transfers are listed here when bridging is available on this network.
        </span>
      </div>
    );
  }

  return (
    <BridgeWalletPicker route={route}>
      <BridgeHistory route={route} network={network} onOpenRow={onOpenRow} />
    </BridgeWalletPicker>
  );
}
