import type { ReactNode } from "react";

import { FluentWidgetConnectButton } from "../../components/FluentWidgetConnectButton";
import { formatAddress } from "../../utils";
import type { FluentWidgetConnectButtonRenderContext } from "../FluentWidget";

interface FluentConnectButtonSlotProps {
  hasConnectedAccount: boolean;
  connecting: boolean;
  externalWalletConnected: boolean;
  connectedAddress?: string;
  fluentAccountAddress?: string;
  onTopConnectClick: () => void;
  openConnect: () => void;
  openAccount: () => void;
  renderConnectButton?: (context: FluentWidgetConnectButtonRenderContext) => ReactNode;
  connectButton: "fixed" | "inline" | false;
  userAvatarUrl?: string | null;
  userXDisplayName?: string;
  userGoogleName?: string;
  defaultLogoUrl?: string | null;
}

/**
 * The connect button: what the App's `renderConnectButton` returns, or, when it is absent or
 * returns `null` or `undefined`, the default button placed by `connectButton` (`"fixed"` top
 * right, `"inline"` in place, `false` hidden).
 */
export function FluentConnectButtonSlot({
  hasConnectedAccount,
  connecting,
  externalWalletConnected,
  connectedAddress,
  fluentAccountAddress,
  onTopConnectClick,
  openConnect,
  openAccount,
  renderConnectButton,
  connectButton,
  userAvatarUrl,
  userXDisplayName,
  userGoogleName,
  defaultLogoUrl,
}: FluentConnectButtonSlotProps): ReactNode {

  const connectAddressLabel = hasConnectedAccount
    ? externalWalletConnected
      ? connectedAddress
        ? formatAddress(connectedAddress)
        : "Connected"
      : fluentAccountAddress
        ? formatAddress(fluentAccountAddress)
        : "Connected"
    : undefined;

  const defaultConnectButton = (
    <FluentWidgetConnectButton
      connected={hasConnectedAccount}
      pending={connecting}
      addressLabel={connectAddressLabel}
      onClick={onTopConnectClick}
      userAvatarUrl={userAvatarUrl}
      defaultLogoUrl={defaultLogoUrl}
    />
  );

  const connectButtonContext: FluentWidgetConnectButtonRenderContext = {
    connected: hasConnectedAccount,
    pending: connecting,
    addressLabel: connectAddressLabel,
    userAvatarUrl: userAvatarUrl || undefined,
    userXDisplayName,
    userGoogleName,
    onClick: onTopConnectClick,
    openConnect,
    openAccount,
    DefaultButton: () => defaultConnectButton,
  };

  return (
    renderConnectButton?.(connectButtonContext) ??
    (connectButton === false
      ? null
      : connectButton === "inline"
        ? defaultConnectButton
        : <div className="fixed top-5 right-5 z-50">{defaultConnectButton}</div>)
  );
}
