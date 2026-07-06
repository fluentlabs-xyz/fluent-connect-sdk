import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_PRIVY_APP_ID,
  FLUENT_CONNECT_PRIVY_CONFIG,
  createFluentConnectForWidget,
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "./config";
import { type FluentExternalWalletState } from "./types";
import { ConnectChoiceModal } from "./components/ConnectChoiceModal";
import { WalletMenuActionCard } from "./components/WalletMenuActionCard";
import { formatAddress } from "./utils/formatAddress";
import { formatExternalWallet } from "./utils/formatExternalWallet";
import { formatSession } from "./utils/formatSession";
import { getAnonymousId } from "./utils/getAnonymousId";
import { postJson } from "./utils/postJson";
import type { FluentTokenDefinition } from "@fluent/wallet-sdk";
import { ReownProvider, useReownWallet } from "./reownAppKit";
import { createFluentBatchOp, type FluentBatchApi, type FluentWidgetAccount } from "./batchOperation";
import { createFluentPermissionApi } from "./permissionSession";
import { useFluentZeroDevAccount } from "./zerodevSession";
import type { Address } from "viem";

export type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
};

export type FluentWidgetProps = {
  wallet?: FluentExternalWalletState | null;
  config?: FluentWidgetConfig;
  mode?: "home" | "page";
  renderHome?: (context: FluentWidgetRenderContext) => ReactNode;
  renderPage?: (context: FluentWidgetRenderContext) => ReactNode;
  renderPermissions?: (context: { session: FluentWidgetSession | null; compact: boolean }) => ReactNode;
  tokens?: readonly FluentTokenDefinition[];
  showDebugPayload?: boolean;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
};

export function FluentWidget(props: FluentWidgetProps) {
  return (
    <PrivyProvider appId={FLUENT_CONNECT_PRIVY_APP_ID} config={FLUENT_CONNECT_PRIVY_CONFIG}>
      <ReownProvider>
        <FluentWidgetContent {...props} />
      </ReownProvider>
    </PrivyProvider>
  );
}

function FluentWidgetContent({
  wallet,
  config,
  mode = "home",
  renderHome,
  renderPage,
  renderPermissions,
  tokens,
  showDebugPayload = true,
  onSessionChange,
}: FluentWidgetProps) {
  const internalWallet = useReownWallet();
  const smartAccount = useFluentZeroDevAccount();
  const activeWallet = wallet ?? internalWallet;
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const fluentConnect = useMemo(() => createFluentConnectForWidget(config), [config]);
  const [session, setSessionState] = useState<FluentWidgetSession | null>(() => {
    try {
      const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as FluentWidgetSession) : null;
    } catch {
      return null;
    }
  });
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [privyIdentityToken, setPrivyIdentityToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [hostedAuthorizeUrl, setHostedAuthorizeUrl] = useState<string | undefined>();
  const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostedConnectWindow = useRef<Window | null>(null);
  const zeroDevInitRequested = useRef(false);
  const fluentAccountAddress = session?.wallet.smartAccountAddress;
  const connectedAddress = activeWallet?.connected && activeWallet.address ? activeWallet.address : fluentAccountAddress;
  const hasConnectedAccount = Boolean(activeWallet?.connected || session?.user?.id || session?.wallet?.smartAccountAddress);
  const widgetAccount = useMemo<FluentWidgetAccount>(() => {
    const address = (smartAccount.smartAccountAddress ?? fluentAccountAddress ?? connectedAddress) as Address | undefined;
    const executionReady = Boolean(smartAccount.smartAccountReady && smartAccount.smartAccountAddress);
    const connected = Boolean(hasConnectedAccount || address);

    return {
      address,
      signerAddress: smartAccount.signerAddress,
      connected,
      executionReady,
      executionStatus: executionReady
        ? "ready"
        : !connected
          ? "disconnected"
          : smartAccount.error
            ? "error"
            : "unavailable",
      executionError: smartAccount.error?.message,
    };
  }, [
    connectedAddress,
    fluentAccountAddress,
    hasConnectedAccount,
    smartAccount.error,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  const setSession = useCallback(
    (nextSession: FluentWidgetSession | null) => {
      setSessionState(nextSession);
      onSessionChange?.(nextSession);
    },
    [onSessionChange],
  );

  const openConnectFlow = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    setAccountOpen(false);
    setHostedError(null);
    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const authorizeUrl = fluentConnect.buildAuthorizeUrl(state).toString();
    console.log("[fluent widget] open connect", {
      state,
      authorizeUrl,
      clientId: resolvedConfig.clientId,
      appName: resolvedConfig.appName,
    });
    setHostedAuthorizeUrl(authorizeUrl);
    setConnectOpen(true);
  }, [fluentConnect, resolvedConfig.appName, resolvedConfig.clientId]);
  const openAccountMenu = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    if (hasConnectedAccount) setAccountOpen(true);
  }, [hasConnectedAccount]);
  const scheduleAccountMenuClose = useCallback(() => {
    if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    accountCloseTimer.current = setTimeout(() => {
      setAccountOpen(false);
      accountCloseTimer.current = null;
    }, 250);
  }, []);
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  const handleDisconnect = useCallback(async () => {
    setAccountOpen(false);
    setSession(null);
    setPrivyIdentityToken(null);
    zeroDevInitRequested.current = false;
    fluentConnect.disconnect();
    window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
    setWalletStatus("Disconnected");
    if (activeWallet?.connected) activeWallet.disconnect();
  }, [activeWallet, fluentConnect, setSession]);

  const handleFaucetClaim = useCallback(async () => {
    if (!session) {
      setWalletStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!privyIdentityToken) {
      setWalletStatus("Privy identity token missing. Reconnect with Fluent ID.");
      return;
    }

    setFaucetBusy(true);
    setWalletStatus("Requesting BLEND faucet");
    try {
      const receipt = await postJson<{ status?: string; txHash?: string; message?: string }>(
        resolvedConfig.faucetEndpoint,
        {
          visitorId: getAnonymousId(),
          fluentSessionToken: session.idToken,
        },
        {
          Authorization: `Bearer ${privyIdentityToken}`,
        },
      );
      setWalletStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
    } catch (err) {
      setWalletStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [privyIdentityToken, resolvedConfig.faucetEndpoint, session]);

  const acceptHostedResult = useCallback(
    (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as {
        type?: string;
        error?: string;
        session?: FluentWidgetSession;
        privyIdentityToken?: string | null;
      };
      if (payload.type === "fluent:connect:error") {
        setHostedError(typeof payload.error === "string" ? payload.error : "Fluent Connect login failed");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (payload.type !== "fluent:connect:session" || !payload.session) return;

      const nextIdentityToken =
        typeof payload.privyIdentityToken === "string" ? payload.privyIdentityToken : null;
      console.log("[fluent widget] hosted result accepted", {
        userId: payload.session.user?.id,
        signerAddress: payload.session.wallet?.signerAddress,
        smartAccountAddress: payload.session.wallet?.smartAccountAddress,
        scopes: payload.session.scopes,
        hasIdentityToken: Boolean(nextIdentityToken),
      });
      setSession(payload.session);
      zeroDevInitRequested.current = false;
      fluentConnect.setSession(payload.session);
      setPrivyIdentityToken(nextIdentityToken);
      window.localStorage.setItem(FLUENT_WIDGET_SESSION_STORAGE_KEY, JSON.stringify(payload.session));
      if (nextIdentityToken) {
        window.localStorage.setItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, nextIdentityToken);
      } else {
        window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
      }
      setWalletStatus("Wallet connected!");
      setHostedError(null);
      setConnectOpen(false);
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
      window.setTimeout(() => {
        void smartAccount.refresh().catch((error) => {
          console.warn("[fluent widget] ZeroDev account not ready after hosted login", error);
        });
      }, 250);
    },
    [fluentConnect, setSession, smartAccount.refresh],
  );

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const rawResult = hash.get("fluent_connect_result");
    if (!rawResult) return;

    try {
      acceptHostedResult(JSON.parse(rawResult));
    } catch {
      setHostedError("Could not parse Fluent Connect result");
    } finally {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }, [acceptHostedResult]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(resolvedConfig.authorizeUrl, location.href).origin) return;
      if (!event.data) return;
      acceptHostedResult(event.data);
    }

    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [acceptHostedResult, resolvedConfig.authorizeUrl]);

  useEffect(() => {
    return () => {
      if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
    };
  }, []);

  useEffect(() => {
    if (!session || smartAccount.smartAccountReady) return;
    if (!smartAccount.privyAuthenticated || smartAccount.embeddedWalletCount === 0) return;
    if (zeroDevInitRequested.current) return;

    zeroDevInitRequested.current = true;
    void smartAccount.refresh().catch((error) => {
      zeroDevInitRequested.current = false;
      console.warn("[fluent widget] ZeroDev account initialization failed", error);
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.refresh,
    smartAccount.smartAccountReady,
  ]);

  const context: FluentWidgetRenderContext = {
    session,
    connectedAddress,
    wallet: activeWallet,
    widget: {
      account: widgetAccount,
      /// Batch operations are initialised from the widget object exposed to a
      /// host app. Builders provide ABI/method calls, the SDK encodes them,
      /// and `smartAccount.sendCalls` submits the bundled UserOp through the
      /// user's Fluent ZeroDev account.
      createBatchOp: (input) =>
        createFluentBatchOp(input, {
          account: widgetAccount,
          smartAccountReady: smartAccount.smartAccountReady,
          sendCalls: smartAccount.sendCalls,
        }),
      /// ZeroDev permission sessions are initialised from the same widget
      /// object. `createFluentPermissionApi` binds the active Kernel account so
      /// apps can later request scoped session policies instead of raw private
      /// key delegation.
      ...createFluentPermissionApi({
        kernel: smartAccount.kernel,
        smartAccountReady: smartAccount.smartAccountReady,
      }),
    },
    openConnect: openConnectFlow,
  };

  const widget = (
    <>
      <div
        className="wallet-control"
        onMouseEnter={openAccountMenu}
        onMouseLeave={scheduleAccountMenuClose}
      >
        <button
          type="button"
          className={hasConnectedAccount ? "top-connect top-connect-connected" : "top-connect"}
          aria-expanded={hasConnectedAccount ? accountOpen : undefined}
          onClick={handleTopConnectClick}
          onFocus={() => {
            openAccountMenu();
          }}
        >
          {hasConnectedAccount ? (
            <>
              <img className="top-connect-logo" src={resolvedConfig.assets.fluentLogo} alt="" aria-hidden="true" />
              <span className="top-connect-copy">
                <strong>Wallet Connected</strong>
                <small>Powered by Fluent</small>
              </span>
            </>
          ) : (
            "Connect Wallet"
          )}
        </button>

        {hasConnectedAccount && accountOpen ? (
          <section className="wallet-menu" aria-label="Connected account">
            <div className="wallet-menu-header">
              <span>{activeWallet?.connected ? "Reown AppKit" : "Fluent Connect ID"}</span>
              <strong>
                {activeWallet?.connected
                  ? connectedAddress
                    ? formatAddress(connectedAddress)
                    : "Connected"
                  : fluentAccountAddress
                    ? formatAddress(fluentAccountAddress)
                    : "Connected"}
              </strong>
            </div>
            <div className="wallet-menu-row">
              <span>Status</span>
              <strong className="wallet-menu-status">
                <span aria-hidden="true" />
                Connected
              </strong>
            </div>
            <WalletMenuActionCard
              session={session}
              connectedAddress={connectedAddress}
              faucetBusy={faucetBusy}
              onFaucet={handleFaucetClaim}
              config={config}
              renderPermissions={renderPermissions}
              tokens={tokens}
            />
            <div className="wallet-menu-actions">
              <button type="button" onClick={() => activeWallet?.open()}>
                Wallet Connect
              </button>
              <button className="wallet-menu-danger" type="button" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {mode === "page" ? renderPage?.(context) : renderHome?.(context)}

      {showDebugPayload && mode === "home" ? (
        <section className="payload">
          <div className="payload-header">
            <h2>Host app callback</h2>
            <span>mock</span>
          </div>
          <pre>{formatSession(session)}</pre>
          <div className="payload-header payload-header-secondary">
            <h2>External wallet</h2>
            <span>{activeWallet?.connected ? "Reown" : "wallet"}</span>
          </div>
          <pre>{formatExternalWallet(activeWallet, walletStatus)}</pre>
          {hostedError ? <p className="payload-error">{hostedError}</p> : null}
        </section>
      ) : null}

      <ConnectChoiceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        wallet={activeWallet}
        fluentReady
        config={config}
        fluentAuthorizeUrl={hostedAuthorizeUrl}
        hostedError={hostedError}
        onFluentLogin={() => {
          setWalletStatus("Opening hosted Fluent Connect ID");
        }}
      />
    </>
  );

  return widget;
}
