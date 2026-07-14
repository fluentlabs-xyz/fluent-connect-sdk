import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_PRIVY_APP_ID,
  createFluentConnectPrivyConfig,
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
import {
  createFluentBatchOp,
  type FluentBatchApi,
  type FluentBatchConfirmationMode,
  type FluentBatchOperationReview,
  type FluentWidgetAccount,
} from "./batchOperation";
import { createFluentPermissionApi } from "./permissionSession";
import { useFluentZeroDevAccount } from "./zerodevSession";
import type { Address } from "viem";

const FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY = "fluent:widget:auth-state:v1";
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
  const [silentSigningEnabled, setSilentSigningEnabled] = useState(false);
  const privyConfig = useMemo(
    () => createFluentConnectPrivyConfig({ showWalletUIs: !silentSigningEnabled }),
    [silentSigningEnabled],
  );

  return (
    <PrivyProvider
      key={silentSigningEnabled ? "silent-signing" : "prompt-signing"}
      appId={FLUENT_CONNECT_PRIVY_APP_ID}
      config={privyConfig}
    >
      <ReownProvider>
        <FluentWidgetContent
          {...props}
          silentSigningEnabled={silentSigningEnabled}
          setSilentSigningEnabled={setSilentSigningEnabled}
        />
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
  silentSigningEnabled,
  setSilentSigningEnabled,
}: FluentWidgetProps & {
  silentSigningEnabled: boolean;
  setSilentSigningEnabled: (enabled: boolean) => void;
}) {
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
  const [batchReview, setBatchReview] = useState<FluentBatchOperationReview | null>(null);
  const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostedConnectWindow = useRef<Window | null>(null);
  const zeroDevInitRequested = useRef(false);
  const hostedConnectState = useRef<string | null>(null);
  if (hostedConnectState.current === null) {
    try {
      hostedConnectState.current = window.sessionStorage.getItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
    } catch {
      hostedConnectState.current = null;
    }
  }
  const batchReviewResolution = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const fluentAccountAddress = smartAccount.smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const connectedAddress = activeWallet?.connected && activeWallet.address ? activeWallet.address : fluentAccountAddress;
  const hasConnectedAccount = Boolean(activeWallet?.connected || session?.user?.id || session?.wallet?.smartAccountAddress);
  const defaultConfirmationMode: FluentBatchConfirmationMode = silentSigningEnabled ? "session" : "always";
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
      console.log("[fluent widget] setSession", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id,
        smartAccountAddress: nextSession?.wallet?.smartAccountAddress,
        scopes: nextSession?.scopes,
      });
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
    hostedConnectState.current = state;
    try {
      window.sessionStorage.setItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY, state);
    } catch {
      // Session storage is best-effort; in-memory state still protects popup flows.
    }
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
    setSilentSigningEnabled(false);
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

  const confirmBatchOperation = useCallback((operation: FluentBatchOperationReview) => {
    console.log("[fluent widget] opening batch operation review", {
      id: operation.id,
      account: operation.account?.address,
      calls: operation.encodedCalls.map((call) => ({
        id: call.id,
        label: call.label,
        to: call.to,
        value: call.value.toString(),
      })),
    });
    setAccountOpen(false);
    batchReviewResolution.current?.reject(new Error("A newer Fluent transaction review replaced this request"));
    setBatchReview(operation);
    return new Promise<void>((resolve, reject) => {
      batchReviewResolution.current = { resolve, reject };
    });
  }, []);

  const acceptBatchReview = useCallback(() => {
    console.log("[fluent widget] batch operation review accepted", { id: batchReview?.id });
    batchReviewResolution.current?.resolve();
    batchReviewResolution.current = null;
    setBatchReview(null);
  }, [batchReview?.id]);

  const rejectBatchReview = useCallback(() => {
    console.log("[fluent widget] batch operation review rejected", { id: batchReview?.id });
    batchReviewResolution.current?.reject(new Error("User rejected Fluent transaction review"));
    batchReviewResolution.current = null;
    setBatchReview(null);
  }, [batchReview?.id]);

  const acceptHostedResult = useCallback(
    (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as {
        type?: string;
        error?: string;
        state?: string;
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

      let expectedState = hostedConnectState.current;
      try {
        expectedState = expectedState ?? window.sessionStorage.getItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
      } catch {
        // Use the in-memory value when storage is unavailable.
      }
      if (!payload.state || !expectedState || payload.state !== expectedState) {
        setHostedError("Fluent Connect login failed state validation");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (payload.session.app?.origin && payload.session.app.origin !== fluentConnect.status().app.origin) {
        setHostedError("Fluent Connect session origin does not match this app");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (!payload.session.wallet?.smartAccountAddress) {
        setHostedError("Fluent smart account is not ready. Reconnect with Fluent ID.");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      const nextIdentityToken =
        typeof payload.privyIdentityToken === "string" ? payload.privyIdentityToken : null;
      console.log("[fluent widget] hosted result accepted", {
        userId: payload.session.user?.id,
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
      hostedConnectState.current = null;
      try {
        window.sessionStorage.removeItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
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
      batchReviewResolution.current?.reject(new Error("Fluent transaction review was closed"));
      batchReviewResolution.current = null;
    };
  }, []);

  useEffect(() => {
    console.log("[fluent widget] account state", {
      hasSession: Boolean(session),
      sessionUserId: session?.user?.id,
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
      widgetAddress: widgetAccount.address,
      widgetConnected: widgetAccount.connected,
      executionReady: widgetAccount.executionReady,
      executionStatus: widgetAccount.executionStatus,
      executionError: widgetAccount.executionError,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
      signerAddress: smartAccount.signerAddress,
      zeroDevSmartAccountAddress: smartAccount.smartAccountAddress,
      zeroDevInitRequested: zeroDevInitRequested.current,
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    widgetAccount.address,
    widgetAccount.connected,
    widgetAccount.executionError,
    widgetAccount.executionReady,
    widgetAccount.executionStatus,
  ]);

  useEffect(() => {
    if (!session || smartAccount.smartAccountReady) return;
    if (!smartAccount.privyAuthenticated || smartAccount.embeddedWalletCount === 0) {
      console.warn("[fluent widget] ZeroDev init skipped: signer unavailable", {
        privyReady: smartAccount.privyReady,
        privyAuthenticated: smartAccount.privyAuthenticated,
        embeddedWalletCount: smartAccount.embeddedWalletCount,
      });
      return;
    }
    if (zeroDevInitRequested.current) {
      console.log("[fluent widget] ZeroDev init skipped: request already in flight");
      return;
    }

    zeroDevInitRequested.current = true;
    console.log("[fluent widget] requesting ZeroDev refresh");
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
          ensureReady: smartAccount.ensureExecutionReady,
          defaultConfirmation: defaultConfirmationMode,
          confirm: confirmBatchOperation,
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
            <label className="wallet-menu-toggle">
              <span>
                <strong>Silent signing</strong>
                <small>Skip Fluent review for batch operations in this session.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={silentSigningEnabled}
                onChange={(event) => setSilentSigningEnabled(event.target.checked)}
              />
            </label>
            <WalletMenuActionCard
              session={session}
              smartAccountAddress={fluentAccountAddress}
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

      <BatchOperationReviewModal
        operation={batchReview}
        onConfirm={acceptBatchReview}
        onCancel={rejectBatchReview}
      />
    </>
  );

  return widget;
}

function BatchOperationReviewModal({
  operation,
  onConfirm,
  onCancel,
}: {
  operation: FluentBatchOperationReview | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!operation) return null;
  const title = operation.button?.label ?? "Confirm transaction";

  return (
    <div
      className="fluent-transaction-review-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="fluent-transaction-review"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Fluent transaction"
      >
        <div className="fluent-transaction-review-header">
          <div>
            <span>Fluent transaction review</span>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onCancel}>
            x
          </button>
        </div>

        <div className="fluent-transaction-review-account">
          <span>Signing account</span>
          <strong>{operation.account?.address ? formatAddress(operation.account.address) : "Fluent account"}</strong>
        </div>

        <ul className="fluent-transaction-review-calls" aria-label="Transaction calls">
          {operation.encodedCalls.map((call, index) => (
            <li key={call.id ?? `${call.to}-${index}`}>
              <div>
                <strong>{call.label ?? operation.calls[index]?.method ?? operation.calls[index]?.functionName ?? "Contract call"}</strong>
                <span>{formatAddress(call.to)}</span>
              </div>
              {call.value > 0n ? <small>Value {call.value.toString()} wei</small> : null}
            </li>
          ))}
        </ul>

        <p>
          Confirming allows the Fluent embedded signer to sign this ZeroDev UserOperation.
        </p>

        <div className="fluent-transaction-review-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Confirm and sign
          </button>
        </div>
      </section>
    </div>
  );
}
