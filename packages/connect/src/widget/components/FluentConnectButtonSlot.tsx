import type { ReactNode } from "react";

import { FluentWidgetConnectButton } from "../../components/FluentWidgetConnectButton";
import { formatAddress } from "../../utils/formatAddress";
import type { FluentWidgetConnectButtonRenderContext } from "../FluentWidget";

/**
 * Renders the connect/account control: the host's `renderConnectButton` when
 * provided, otherwise the default button placed per `connectButton`
 * ("fixed" top-right, "inline", or hidden with `false`).
 */
export function FluentConnectButtonSlot(props: {
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
}): ReactNode {
  const {
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
  } = props;

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
    />
  );

  const connectButtonContext: FluentWidgetConnectButtonRenderContext = {
    connected: hasConnectedAccount,
    pending: connecting,
    addressLabel: connectAddressLabel,
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
