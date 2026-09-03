import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIdentityToken, usePrivy, useUser } from "@privy-io/react-auth";
import {
  createFluentConnectForWidget,
  FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  FLUENT_CONNECT_PRIVY_APP_ID,
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  resolveFluentWidgetConfig,
  type FluentWidgetSession,
} from "../core/config";
import { type FluentAnalyticsTrack } from "../core/analytics";
import { ConnectChoiceModal } from "../components/ConnectChoiceModal";
import { WalletMenuActionCard } from "../components/WalletMenuActionCard";
import { Toaster } from "../components/ui/toast";
import { useIsMobile } from "../hooks/use-mobile";
import { debugLog, debugWarn, debugError } from "../core/debugLogger";
import { clearPrivyRecentLoginMethod } from "../utils/clearPrivyRecentLoginMethod";
import { createLocalFluentSession } from "../utils/createLocalFluentSession";
import { useReownWallet } from "./reownAppKit";
import { useFluentZeroDevAccount } from "./zerodevSession";
import { useFluentWidgetNetwork } from "./widgetNetworkContext";
import type { FluentGasPaymentSymbol } from "../core/gasPayment";
import { BatchOperationReviewModal } from "../components/BatchOperationReviewModal";
import { FluentWidgetProvider } from "./widgetContext";
import { FluentPortalContainerProvider, WIDGET_STYLE_SCOPE } from "./portalContainer";
import { useWidgetAccount } from "./hooks/useWidgetAccount";
import { useGasPaymentSelection } from "./hooks/useGasPaymentSelection";
import { useBatchReview } from "./hooks/useBatchReview";
import { useFaucet } from "./hooks/useFaucet";
import { useFluentSession } from "./hooks/useFluentSession";
import { useWidgetExecution } from "./hooks/useWidgetExecution";
import { useZeroDevInitializer } from "./hooks/useZeroDevInitializer";
import { useExternalWalletAnalytics } from "./hooks/useExternalWalletAnalytics";
import { useConnectStatus } from "./hooks/useConnectStatus";
import { useHostedConnect } from "./hooks/useHostedConnect";
import { useAccountMenu } from "./hooks/useAccountMenu";
import { useAuthToken } from "./hooks/useAuthToken";
import { FluentAccountDrawer } from "./components/FluentAccountDrawer";
import { FluentConnectButtonSlot } from "./components/FluentConnectButtonSlot";
import { DebugPanel } from "./components/DebugPanel";
import type {
  FluentWidgetProps,
  FluentWidgetRenderContext,
} from "./FluentWidget";

// Survives the page reload that the direct X flow performs mid-login, so the widget
// can tell "the user just logged in" from "a session was restored".
const FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY = "fluent:widget:direct-login-intent:v1";

export type FluentWidgetContentProps = FluentWidgetProps & {
  track: FluentAnalyticsTrack;
  reportAnalyticsSession: (session: FluentWidgetSession | null) => void;
  externalWalletAnalytics: MutableRefObject<{ intent: boolean; connected: boolean }>;
  accountOpen: boolean;
  setAccountOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  walletMenuTab: string;
  setWalletMenuTab: (tab: string) => void;
  gasPaymentToken: FluentGasPaymentSymbol;
  setGasPaymentToken: (token: FluentGasPaymentSymbol) => void;
  silentSigningEnabled: boolean;
  silentSigningChecked: boolean;
  onSilentSigningChange: (enabled: boolean) => void;
  commitSilentSigningEnabled: (enabled: boolean) => void;
  requestPrivyLogin: () => void;
  pendingPrivyLoginRef: MutableRefObject<boolean>;
};

export function FluentWidgetContent({
  track,
  reportAnalyticsSession,
  externalWalletAnalytics,
  wallet,
  config,
  mode = "home",
  connectButton = "fixed",
  renderConnectButton,
  renderHome,
  renderPage,
  tokens,
  showDebugPayload = true,
  onSessionChange,
  accountOpen,
  setAccountOpen,
  walletMenuTab,
  setWalletMenuTab,
  gasPaymentToken,
  setGasPaymentToken,
  silentSigningEnabled,
  silentSigningChecked,
  onSilentSigningChange,
  commitSilentSigningEnabled,
  requestPrivyLogin,
  pendingPrivyLoginRef,
}: FluentWidgetContentProps) {
  const internalWallet = useReownWallet();
  const isMobile = useIsMobile();
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const smartAccount = useFluentZeroDevAccount({
    login: requestPrivyLogin,
    partnerId: resolvedConfig.partnerId,
    sponsorshipUrl: resolvedConfig.sponsorshipUrl,
  });
  const { authenticated, getAccessToken, login, logout, ready: privyReady, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const activeWallet = wallet ?? internalWallet;
  const { chain } = useFluentWidgetNetwork();
  const fluentConnect = useMemo(() => createFluentConnectForWidget(config), [config]);
  const directAuth = resolvedConfig.authMode === "direct";
  // Seeded during render, not from an effect: the driver effect runs on the same
  // mount that follows the OAuth return, and would race an effect-based restore.
  const directAuthRequested = useRef(
    (() => {
      try {
        return window.sessionStorage.getItem(FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY) === "1";
      } catch {
        return false;
      }
    })(),
  );
  const directAuthInFlight = useRef(false);
  // Blocks auto-reauthorization while an explicit disconnect is in flight, so
  // the still-authenticated Privy session can't silently recreate the session.
  const disconnectingRef = useRef(false);
  const { session, setSession } = useFluentSession({
    reportAnalyticsSession,
    onSessionChange,
  });
  const {
    status: walletStatus,
    setStatus: setWalletStatus,
    error: hostedError,
    setError: setHostedError,
  } = useConnectStatus();
  const [balanceRevisionCounter, setBalanceRevisionCounter] = useState(0);
  /** Bump to refetch the widget's on-chain balances after a confirmed tx. */
  const refreshBalances = useCallback(() => setBalanceRevisionCounter((value) => value + 1), []);
  const [connectOpen, setConnectOpen] = useState(false);
  const {
    widgetAccount,
    fluentAccountAddress,
    connectedAddress,
    accountMenuAddress,
    fluentAccountReady,
    hasConnectedAccount,
    connecting,
    status,
  } = useWidgetAccount({
    smartAccount: {
      smartAccountReady: smartAccount.smartAccountReady,
      smartAccountAddress: smartAccount.smartAccountAddress,
      signerAddress: smartAccount.signerAddress,
      error: smartAccount.error,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
    },
    wallet: activeWallet
      ? {
          connected: activeWallet.connected,
          address: activeWallet.address,
          hasWalletClient: Boolean(activeWallet.walletClient),
          reconnecting: activeWallet.reconnecting,
        }
      : null,
    sessionUserId: session?.user?.id,
    sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    directAuth,
  });
  const { selectedGasPaymentToken, defaultConfirmationMode } = useGasPaymentSelection({
    gasPaymentToken,
    tokens,
    network: resolvedConfig.network,
    silentSigningEnabled,
  });
  const { resetInitialization } = useZeroDevInitializer({
    smartAccount,
    directAuth,
    session,
    widgetAccount,
  });
  useExternalWalletAnalytics({
    analytics: externalWalletAnalytics,
    connected: Boolean(activeWallet?.connected),
    chainId: activeWallet?.chainId,
    track,
  });
  const { hostedAuthorizeUrl, beginHostedConnect } = useHostedConnect({
    fluentConnect,
    authorizeUrl: resolvedConfig.authorizeUrl,
    partnerId: resolvedConfig.partnerId,
    appName: resolvedConfig.appName,
    authMode: resolvedConfig.authMode,
    setSession,
    resetInitialization,
    setConnectOpen,
    setStatus: setWalletStatus,
    setError: setHostedError,
    smartAccountRefresh: smartAccount.refresh,
    track,
  });

  const setDirectAuthRequested = useCallback((pending: boolean) => {
    directAuthRequested.current = pending;
    try {
      if (pending) window.sessionStorage.setItem(FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY, "1");
      else window.sessionStorage.removeItem(FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY);
    } catch {
      // Private mode / storage disabled: the ref still covers the no-reload path.
    }
  }, []);

  const openConnectFlow = useCallback(
    (trigger: "connect_button" | "faucet_reauth" = "connect_button") => {
      track("connect_opened", { trigger });
      setAccountOpen(false);
      setHostedError(null);
      if (directAuth) {
        setConnectOpen(true);
        return;
      }
      beginHostedConnect();
    },
    [beginHostedConnect, directAuth, setAccountOpen, setHostedError, track],
  );
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  // Host apps wire this straight to onClick, so React would pass the click event as
  // the first argument. Swallow it: the trigger must never come from the caller.
  const openConnect = useCallback(() => openConnectFlow(), [openConnectFlow]);
  const handleDisconnect = useCallback(async () => {
    // Guard the whole teardown: the auto-authorize effect runs on the render
    // caused by setSession(null) while Privy is still authenticated (logout is
    // async), and would otherwise recreate the session we're tearing down.
    disconnectingRef.current = true;
    try {
      setAccountOpen(false);
      // Back to the default, not off — a fresh connection starts from it.
      commitSilentSigningEnabled(FLUENT_CONNECT_DEFAULT_SILENT_SIGNING);
      setSession(null);
      resetInitialization();
      setDirectAuthRequested(false);
      directAuthInFlight.current = false;
      fluentConnect.disconnect();
      // setSession(null) above already clears the session key; only the separate
      // identity token needs removing here.
      window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
      setWalletStatus("Disconnected");
      if (directAuth && authenticated) {
        try {
          await logout();
        } catch (error) {
          debugWarn("[fluent widget] Privy logout failed", error);
        }
      }
      clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
      if (activeWallet?.connected) activeWallet.disconnect();
    } finally {
      disconnectingRef.current = false;
    }
  }, [activeWallet, authenticated, commitSilentSigningEnabled, directAuth, fluentConnect, logout, setDirectAuthRequested, setSession]);

  // `handleDisconnect` is also the first step of re-login (see handleConnectWithX), so
  // the event belongs to the entry points a user reaches by asking to disconnect, not to
  // the teardown itself. Emitted before the teardown clears the analytics context, so it
  // still carries the addresses of the wallet being disconnected.
  // Returns the teardown promise so the host-facing `disconnect()` can be awaited;
  // the in-widget menu and drawer ignore it and stay fire-and-forget.
  const requestDisconnect = useCallback(() => {
    track("wallet_disconnected");
    return handleDisconnect();
  }, [handleDisconnect, track]);

  const { openAccountMenu, handleAccountMenuAction } = useAccountMenu({
    accountMenuAddress,
    network: resolvedConfig.network,
    hasConnectedAccount,
    setAccountOpen,
    requestDisconnect,
    onOpenSettings: () => setWalletMenuTab("settings"),
    track,
  });

  const lastMenuTabRef = useRef(walletMenuTab === "settings" ? "home" : walletMenuTab);
  useEffect(() => {
    if (walletMenuTab !== "settings") lastMenuTabRef.current = walletMenuTab;
  }, [walletMenuTab]);

  useEffect(() => {
    if (!accountOpen && walletMenuTab === "settings") {
      setWalletMenuTab(lastMenuTabRef.current);
    }
  }, [accountOpen, setWalletMenuTab, walletMenuTab]);

  const closeSettings = useCallback(() => {
    setWalletMenuTab(lastMenuTabRef.current);
  }, [setWalletMenuTab]);

  const { faucetBusy, claimFaucet } = useFaucet({
    session,
    identityToken,
    faucetEndpoint: resolvedConfig.faucetEndpoint,
    refreshBalances,
    refreshUser,
    onReauthRequired: () => openConnectFlow("faucet_reauth"),
    track,
    setStatus: setWalletStatus,
  });

  const completeDirectAuthorization = useCallback(async () => {
    if (!directAuth || !authenticated || !user?.id || directAuthInFlight.current) return;
    if (disconnectingRef.current) return;
    // A stored session ends direct auth only while it is still the signed-in user's and
    // no explicit login is pending. Both conditions close on their own: the intent is
    // cleared once the session is applied, and a re-issued session matches user.id by
    // construction — so this cannot cycle.
    // `user` is optional-chained because a stored session is JSON.parse'd without
    // validation and the hosted path never checks that field — a malformed one then
    // fails the comparison and gets re-issued, which is what should happen to it.
    if (session && !directAuthRequested.current && session.user?.id === user.id) return;
    if (!identityToken) {
      setWalletStatus("Waiting for Privy identity token");
      return;
    }

    directAuthInFlight.current = true;
    setWalletStatus("Preparing Fluent account");
    setHostedError(null);
    try {
      const kernel = smartAccount.kernel ?? await smartAccount.refresh();
      if (!kernel?.smartAccountAddress) {
        setWalletStatus(smartAccount.error?.message ?? "Waiting for ZeroDev smart account");
        return;
      }

      const app = fluentConnect.status().app;
      const nextSession = createLocalFluentSession({
        app,
        partnerId: resolvedConfig.partnerId,
        scopes: resolvedConfig.scopes,
        userId: user.id,
        email: typeof user.email?.address === "string" ? user.email.address : undefined,
        signerAddress: (smartAccount.signerAddress ?? undefined) as `0x${string}` | undefined,
        smartAccountAddress: kernel.smartAccountAddress,
      });

      debugLog("[fluent widget] direct auth session created", {
        userId: nextSession.user.id,
        signerAddress: nextSession.wallet.signerAddress,
        smartAccountAddress: nextSession.wallet.smartAccountAddress,
      });

      setSession(nextSession);
      // After setSession, so the event carries the addresses — the hosted branch
      // already emits in this order and the two must agree.
      track("connect_login_completed");
      resetInitialization();
      fluentConnect.setSession(nextSession);
      // setSession above persists the session key; only the identity token is separate.
      window.localStorage.setItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, identityToken);
      setWalletStatus("Wallet connected!");
      setConnectOpen(false);
      setDirectAuthRequested(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create Fluent session";
      // Clear the intent too: a failed re-issue must not stay armed for the tab.
      setDirectAuthRequested(false);
      track("connect_login_failed", { reason: "direct_auth_failed" });
      debugError("[fluent widget] direct auth failed", error);
      setHostedError(message);
      setWalletStatus(message);
    } finally {
      directAuthInFlight.current = false;
    }
  }, [
    authenticated,
    directAuth,
    fluentConnect,
    identityToken,
    resolvedConfig.scopes,
    session,
    setDirectAuthRequested,
    setSession,
    smartAccount.error?.message,
    smartAccount.kernel,
    smartAccount.refresh,
    smartAccount.signerAddress,
    user,
  ]);

  useEffect(() => {
    // The callback above owns the decision; duplicating it here would let the two
    // conditions drift.
    if (!directAuth) return;
    if (disconnectingRef.current) return;
    if (!privyReady || !authenticated) return;
    if (smartAccount.embeddedWalletCount === 0) return;
    completeDirectAuthorization();
  }, [
    authenticated,
    completeDirectAuthorization,
    directAuth,
    identityToken,
    privyReady,
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  // After remount (recent-login cleared), open Privy with X as the primary CTA.
  useEffect(() => {
    if (!pendingPrivyLoginRef.current || !privyReady || authenticated) return;
    pendingPrivyLoginRef.current = false;
    login();
  }, [authenticated, login, pendingPrivyLoginRef, privyReady]);

  const startDirectFluentLogin = useCallback(() => {
    setHostedError(null);
    setWalletStatus("Opening Fluent Connect ID");
    setDirectAuthRequested(true);

    if (authenticated) {
      completeDirectAuthorization();
      return;
    }

    requestPrivyLogin();
  }, [authenticated, completeDirectAuthorization, requestPrivyLogin, setDirectAuthRequested]);

  const handleConnectWithX = useCallback(async () => {
    await handleDisconnect();
    if (directAuth) {
      startDirectFluentLogin();
      return;
    }
    openConnectFlow();
  }, [directAuth, handleDisconnect, openConnectFlow, startDirectFluentLogin]);

  const closeAccountMenu = useCallback(() => setAccountOpen(false), [setAccountOpen]);
  const { batchReview, confirmBatchOperation, acceptBatchReview, rejectBatchReview } =
    useBatchReview({ onOpen: closeAccountMenu });

  const widgetApi = useWidgetExecution({
    chain,
    fluentAccountReady,
    wallet: activeWallet,
    smartAccount,
    widgetAccount,
    defaultConfirmationMode,
    selectedGasPaymentToken,
    confirmBatchOperation,
    refreshBalances,
    track,
  });

  const getAuthToken = useAuthToken({
    publicApiUrl: resolvedConfig.publicApiUrl,
    partnerId: resolvedConfig.partnerId,
    authMode: resolvedConfig.authMode,
    renewalOffsetSeconds: resolvedConfig.authTokenRenewalOffsetSeconds,
    accountType: widgetAccount.type,
    privyUserId: user?.id,
    getAccessToken,
    identityToken,
    walletAddress: activeWallet?.address,
    walletClient: activeWallet?.walletClient,
  });

  const context = useMemo<FluentWidgetRenderContext>(
    () => ({
      session,
      connectedAddress,
      wallet: activeWallet,
      widget: widgetApi,
      openConnect,
      openAccount: openAccountMenu,
      disconnect: requestDisconnect,
      hasConnectedAccount,
      status,
      connecting,
      refreshBalances,
      getAuthToken,
    }),
    [
      session,
      connectedAddress,
      activeWallet,
      widgetApi,
      openConnect,
      openAccountMenu,
      requestDisconnect,
      hasConnectedAccount,
      status,
      connecting,
      refreshBalances,
      getAuthToken,
    ],
  );

  const widget = (
    <FluentPortalContainerProvider>
    <Toaster>
    {/* Two scopes, with host content between them: one wrapper around everything
        would put the host inside the widget's colour scheme, and reordering to
        avoid that would move the `connectButton="inline"` slot. */}
    <div className={WIDGET_STYLE_SCOPE}>
      <FluentAccountDrawer
        accountOpen={accountOpen}
        setAccountOpen={setAccountOpen}
        hasConnectedAccount={hasConnectedAccount}
        isMobile={isMobile}
        accountMenuAddress={accountMenuAddress}
        onAccountMenuAction={handleAccountMenuAction}
        settingsOpen={walletMenuTab === "settings"}
        onCloseSettings={closeSettings}
        connectButton={
          <FluentConnectButtonSlot
            hasConnectedAccount={hasConnectedAccount}
            connecting={connecting}
            externalWalletConnected={Boolean(activeWallet?.connected)}
            connectedAddress={connectedAddress}
            fluentAccountAddress={fluentAccountAddress}
            onTopConnectClick={handleTopConnectClick}
            openConnect={openConnect}
            openAccount={openAccountMenu}
            renderConnectButton={renderConnectButton}
            connectButton={connectButton}
          />
        }
      >
        <WalletMenuActionCard
          track={track}
          session={session}
          smartAccountAddress={fluentAccountAddress}
          connectedAddress={connectedAddress}
          faucetBusy={faucetBusy}
          onFaucet={claimFaucet}
          config={config}
          tokens={tokens}
          gasPaymentToken={gasPaymentToken}
          onGasPaymentTokenChange={setGasPaymentToken}
          silentSigningEnabled={silentSigningChecked}
          onSilentSigningChange={onSilentSigningChange}
          onDisconnect={requestDisconnect}
          onConnectWithX={handleConnectWithX}
          tab={walletMenuTab}
          onTabChange={setWalletMenuTab}
          balanceRevisionCounter={balanceRevisionCounter}
        />
      </FluentAccountDrawer>
    </div>

    {/* Host app: context only, no styling — context needs no DOM ancestry. */}
    <FluentWidgetProvider value={context}>
      {mode === "page" ? renderPage?.(context) : renderHome?.(context)}
    </FluentWidgetProvider>

    <div className={WIDGET_STYLE_SCOPE}>
      {showDebugPayload && mode === "home" ? (
        <DebugPanel
          session={session}
          wallet={activeWallet}
          walletStatus={walletStatus}
          hostedError={hostedError}
        />
      ) : null}

      <ConnectChoiceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        wallet={activeWallet}
        fluentReady={directAuth ? privyReady : true}
        authMode={resolvedConfig.authMode}
        config={config}
        fluentAuthorizeUrl={directAuth ? undefined : hostedAuthorizeUrl}
        hostedError={hostedError}
        track={track}
        onExternalWalletSelected={() => {
          externalWalletAnalytics.current.intent = true;
        }}
        onFluentLogin={() => {
          track("connect_login_started");
          if (directAuth) {
            startDirectFluentLogin();
            return;
          }
          setWalletStatus("Opening hosted Fluent Connect ID");
        }}
      />
      <BatchOperationReviewModal
        operation={batchReview}
        onConfirm={acceptBatchReview}
        onCancel={rejectBatchReview}
      />
    </div>
    </Toaster>
    </FluentPortalContainerProvider>
  );

  return widget;
}
