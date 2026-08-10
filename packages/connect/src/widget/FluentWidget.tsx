import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_DEFAULT_ASSETS,
  FLUENT_CONNECT_PRIVY_APP_ID,
  createFluentConnectPrivyConfig,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../core/config";
import { type FluentExternalWalletState } from "../core/types";
import {
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { ReownProvider } from "./reownAppKit";
import { FluentWidgetNetworkProvider } from "./widgetNetworkContext";
import { type FluentBatchApi } from "./batchOperation";
import { FluentWidgetContent } from "./FluentWidgetContent";
import type { FluentGasPaymentSymbol } from "../core/gasPayment";

const SILENT_SIGNING_REMOUNT_MS = 220;

export type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
  openAccount: () => void;
  hasConnectedAccount: boolean;
};

export type FluentWidgetConnectButtonRenderContext = {
  connected: boolean;
  addressLabel?: string;
  onClick: () => void;
  openConnect: () => void;
  openAccount: () => void;
  DefaultButton: () => ReactNode;
};

export type FluentWidgetProps = {
  wallet?: FluentExternalWalletState | null;
  config: FluentWidgetConfig;
  mode?: "home" | "page";
  /**
   * Show the default connect/account control.
   * - `"fixed"` (default) — top-right floating button
   * - `"inline"` — same button, no fixed positioning (host places via CSS / wrapper)
   * - `false` — hide; use `renderConnectButton`, `openConnect`, or `openAccount`
   */
  connectButton?: "fixed" | "inline" | false;
  /** Replace the default connect button UI / placement entirely. */
  renderConnectButton?: (context: FluentWidgetConnectButtonRenderContext) => ReactNode;
  renderHome?: (context: FluentWidgetRenderContext) => ReactNode;
  renderPage?: (context: FluentWidgetRenderContext) => ReactNode;
  tokens?: readonly FluentTokenDefinition[];
  showDebugPayload?: boolean;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
};

export function FluentWidget(props: FluentWidgetProps) {
  const [silentSigningEnabled, setSilentSigningEnabled] = useState(false);
  // Optimistic UI so the switch can animate before Privy remounts.
  const [silentSigningChecked, setSilentSigningChecked] = useState(false);
  const silentSigningRemountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep drawer + active tab across Privy remounts when silent signing toggles.
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletMenuTab, setWalletMenuTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] =
    useState<FluentGasPaymentSymbol>("BLEND");
  const resolvedNetwork = useMemo(
    () => resolveFluentWidgetConfig(props.config).network,
    [props.config],
  );
  const privyConfig = useMemo(
    () =>
      createFluentConnectPrivyConfig({
        network: resolvedNetwork,
        showWalletUIs: !silentSigningEnabled,
        logo: props.config?.assets?.fluentLogo ?? FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
      }),
    [props.config?.assets?.fluentLogo, resolvedNetwork, silentSigningEnabled],
  );

  const commitSilentSigningEnabled = useCallback((enabled: boolean) => {
    if (silentSigningRemountTimer.current) {
      clearTimeout(silentSigningRemountTimer.current);
      silentSigningRemountTimer.current = null;
    }
    setSilentSigningChecked(enabled);
    setSilentSigningEnabled(enabled);
  }, []);

  const handleSilentSigningChange = useCallback((enabled: boolean) => {
    setSilentSigningChecked(enabled);
    if (silentSigningRemountTimer.current) {
      clearTimeout(silentSigningRemountTimer.current);
    }
    // Delay Privy remount so the switch thumb transition can finish.
    silentSigningRemountTimer.current = setTimeout(() => {
      setSilentSigningEnabled(enabled);
      silentSigningRemountTimer.current = null;
    }, SILENT_SIGNING_REMOUNT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (silentSigningRemountTimer.current) {
        clearTimeout(silentSigningRemountTimer.current);
      }
    };
  }, []);

  return (
    <FluentWidgetNetworkProvider network={resolvedNetwork}>
      <PrivyProvider
        key={`${resolvedNetwork}:${silentSigningEnabled ? "silent-signing" : "prompt-signing"}`}
        appId={FLUENT_CONNECT_PRIVY_APP_ID}
        config={privyConfig}
      >
        <ReownProvider network={resolvedNetwork}>
          <FluentWidgetContent
          {...props}
          accountOpen={accountOpen}
          setAccountOpen={setAccountOpen}
          walletMenuTab={walletMenuTab}
          setWalletMenuTab={setWalletMenuTab}
          gasPaymentToken={gasPaymentToken}
          setGasPaymentToken={setGasPaymentToken}
          silentSigningEnabled={silentSigningEnabled}
          silentSigningChecked={silentSigningChecked}
          onSilentSigningChange={handleSilentSigningChange}
          commitSilentSigningEnabled={commitSilentSigningEnabled}
        />
        </ReownProvider>
      </PrivyProvider>
    </FluentWidgetNetworkProvider>
  );
}
