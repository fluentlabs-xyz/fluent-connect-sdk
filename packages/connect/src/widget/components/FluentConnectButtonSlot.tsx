import { createContext, type ReactNode, useContext } from "react";

import { FluentWidgetConnectButton } from "../../components/FluentWidgetConnectButton";
import { formatAddress } from "../../utils";
import type { FluentWidgetConnectButtonRenderContext } from "../FluentWidget";

/** The default button of the slot that renders the App's `renderConnectButton` output. */
const DefaultConnectButtonContext = createContext<ReactNode>(null);

/**
 * The render context's `DefaultButton`: one component for every slot and render, so React
 * updates the button in place rather than remounting it, and draws the enclosing slot's button.
 */
function DefaultConnectButton(): ReactNode {
  return useContext(DefaultConnectButtonContext);
}

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
    DefaultButton: DefaultConnectButton,
  };

  const appButton = renderConnectButton?.(connectButtonContext);
  if (appButton !== null && appButton !== undefined) {
    return (
      <DefaultConnectButtonContext.Provider value={defaultConnectButton}>
        {appButton}
      </DefaultConnectButtonContext.Provider>
    );
  }
  return connectButton === false ? null : connectButton === "inline" ? (
    defaultConnectButton
  ) : (
    <div className="fixed top-5 right-5 z-50">{defaultConnectButton}</div>
  );
}
