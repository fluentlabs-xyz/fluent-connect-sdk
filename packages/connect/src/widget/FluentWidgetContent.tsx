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
import { hasPendingInlineOAuth } from "../utils/inlineOAuth";
import { ConnectChoiceModal } from "../components/ConnectChoiceModal";
import { WalletMenuActionCard } from "../components/WalletMenuActionCard";
import { BridgeScreen } from "../bridge/BridgeScreen";
import {
  isWalletMenuCardTab,
  WALLET_MENU_SUB_PAGES,
} from "./walletMenuSubPages";
import { Toaster } from "../components/ui/toast";
import { useIsMobile } from "../hooks/use-mobile";
import { debugLog, debugWarn, debugError } from "../core/debugLogger";
import {
  removeStoredValue,
  resolveLocalStorage,
  writeStoredValue,
} from "../core/browserStorage";
import {
  clearPrivyRecentLoginMethod,
  createLocalFluentSession,
  getHighResTwitterAvatar,
} from "../utils";
import { useReownWallet } from "./reownAppKit";
import {
  useFluentZeroDevAccount,
  type FluentZeroDevSponsorshipTokenSource,
} from "./zerodevSession";
import { useFluentWidgetNetwork } from "./widgetNetworkContext";
import type { FluentGasTokenSymbol } from "../core/gasPayment";
import { BatchOperationReviewModal } from "../components/BatchOperationReviewModal";
import { SignatureReviewModal } from "../components/SignatureReviewModal";
import { FluentWidgetProvider } from "./widgetContext";
import { FluentPortalContainerProvider, WIDGET_STYLE_SCOPE } from "./portalContainer";
import {
  captureConnectedPresentation,
  presentWidgetAccount,
  useWidgetAccount,
  type ConnectedPresentationState,
} from "./hooks/useWidgetAccount";
import { useGasPaymentSelection } from "./hooks/useGasPaymentSelection";
import { useBatchReview } from "./hooks/useBatchReview";
import { useSignatureReview } from "./hooks/useSignatureReview";
import { useFaucet } from "./hooks/useFaucet";
import { useFluentSession } from "./hooks/useFluentSession";
import { useWidgetExecution } from "./hooks/useWidgetExecution";
import { useZeroDevInitializer } from "./hooks/useZeroDevInitializer";
import { useExternalWalletAnalytics } from "./hooks/useExternalWalletAnalytics";
import { useConnectStatus } from "./hooks/useConnectStatus";
import { useHostedConnect } from "./hooks/useHostedConnect";
import { useAccountMenu } from "./hooks/useAccountMenu";
import { useAuthToken, type AuthTokenState } from "./hooks/useAuthToken";
import { useUserSettings, type UserSettingsRef } from "./hooks/useUserSettings";
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
  gasPaymentToken: FluentGasTokenSymbol;
  setGasPaymentToken: (token: FluentGasTokenSymbol) => void;
  silentSigningEnabled: boolean;
  silentSigningChecked: boolean;
  onSilentSigningChange: (enabled: boolean) => void;
  commitSilentSigningEnabled: (enabled: boolean) => void;
  requestPrivyLogin: () => void;
  inlineLoginRequest: number;
  handledInlineLoginRequest: MutableRefObject<number>;
  pendingPrivyLoginRef: MutableRefObject<boolean>;
  /** Created above the PrivyProvider so a Quick sign toggle cannot drop it. */
  authTokenState: MutableRefObject<AuthTokenState>;
  /** Likewise: the read marker, the snapshot and the backend store live here. */
  userSettingsRef: MutableRefObject<UserSettingsRef>;
  /** Likewise: what a signed-in person is shown while the subtree is rebuilt. */
  connectedPresentation: MutableRefObject<ConnectedPresentationState>;
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
  inlineLoginRequest,
  handledInlineLoginRequest,
  pendingPrivyLoginRef,
  authTokenState,
  userSettingsRef,
  connectedPresentation,
}: FluentWidgetContentProps) {
  const internalWallet = useReownWallet();
  const isMobile = useIsMobile();
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  // The sponsorship paymaster authenticates with the Fluent token, which `useAuthToken` below
  // mints — and that hook needs `widgetAccount`, which needs this one. So the ZeroDev hook reads
  // the token source through a ref filled in further down rather than taking it as a value:
  // reordering the widget would change when the kernel initializes.
  const sponsorshipTokenSource = useRef<FluentZeroDevSponsorshipTokenSource | null>(null);
  const readSponsorshipTokenSource = useCallback(() => sponsorshipTokenSource.current, []);
  // And for the same reason: `handleDisconnect` below has to end the Fluent session, but
  // `useAuthToken` needs the account this component derives further down. The teardown is read
  // through a ref rather than captured, so the disconnect callback keeps a stable identity.
  const endAuthSessionRef = useRef<(() => Promise<void>) | null>(null);
  const smartAccount = useFluentZeroDevAccount({
    login: requestPrivyLogin,
    appId: resolvedConfig.appId,
    sponsorshipUrl: resolvedConfig.sponsorshipUrl,
    sponsorshipTokenSource: readSponsorshipTokenSource,
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
  const [connectOpen, setConnectOpen] = useState(() => directAuth && hasPendingInlineOAuth());
  const derivedAccount = useWidgetAccount({
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
          hasWalletClient: Boolean(
            activeWallet.address &&
            activeWallet.walletClient?.account?.address?.toLowerCase() === activeWallet.address.toLowerCase(),
          ),
          reconnecting: activeWallet.reconnecting,
        }
      : null,
    sessionUserId: session?.user?.id,
    sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    directAuth,
  });
  const walletConnected = Boolean(activeWallet?.connected);
  // The account as everything visible sees it. `derivedAccount` stays the raw
  // truth for everything that acts: execution readiness, the ZeroDev
  // initializer, and the settings controller's "this is a rebuild" signal.
  const account = presentWidgetAccount({
    derived: derivedAccount,
    walletConnected,
    rebuilding: connectedPresentation.current.rebuilding,
    sessionUserId: session?.user?.id,
    sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    failed: Boolean(smartAccount.error),
  });
  // Written during render, like `setDebugLogging` in `FluentWidget`: applying a
  // stored Quick sign value arms the next rebuild from a read that can land
  // between this render and its effects.
  if (derivedAccount.hasConnectedAccount) {
    connectedPresentation.current.connected = captureConnectedPresentation({
      derived: derivedAccount,
      walletConnected,
      sessionUserId: session?.user?.id,
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    });
    connectedPresentation.current.rebuilding = null;
  } else if (derivedAccount.status === "disconnected") {
    connectedPresentation.current.connected = null;
    connectedPresentation.current.rebuilding = null;
  }
  const {
    widgetAccount,
    fluentAccountAddress,
    connectedAddress,
    accountMenuAddress,
    accountMenuIsExternalWallet,
    fluentAccountReady,
    hasConnectedAccount,
    connecting,
    status,
  } = account;
  const { selectedGasPaymentToken, defaultConfirmationMode } = useGasPaymentSelection({
    gasPaymentToken,
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
    appId: resolvedConfig.appId,
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
  /**
   * The teardown. `awaitAuthSession` decides whether the returned promise also covers ending the
   * Fluent session at the service: a host's `disconnect()` must not resolve before every refresh
   * family this disconnect ended has been revoked, best effort, and that wait lasts as long as the
   * auth work still out takes — a wallet dialog nobody answers included (`endAuthSession`). The
   * re-login step needs the local teardown and nothing more, and must not sit behind that dialog.
   */
  const handleDisconnect = useCallback(async ({ awaitAuthSession }: { awaitAuthSession: boolean }) => {
    // Guard the local teardown: the auto-authorize effect runs on the render
    // caused by setSession(null) while Privy is still authenticated (logout is
    // async), and would otherwise recreate the session we're tearing down.
    disconnectingRef.current = true;
    let authSessionEnded: Promise<void> = Promise.resolve();
    try {
      // Started before anything else. Its local half is synchronous, so from this line on no
      // renewal or exchange still out can put a token or a refresh credential back; its slow
      // half — revoking the families at the service — holds up neither the drawer closing nor the
      // guard below, and does belong to the promise a host awaits. It never rejects: the identity,
      // session and wallet teardown below runs whatever the service says.
      authSessionEnded = endAuthSessionRef.current?.() ?? Promise.resolve();
      setAccountOpen(false);
      setSession(null);
      resetInitialization();
      setDirectAuthRequested(false);
      directAuthInFlight.current = false;
      fluentConnect.disconnect();
      // setSession(null) above already clears the session key; only the separate
      // identity token needs removing here. Best effort, like every storage access in this
      // teardown: a browser that refuses to remove it — blocked site data, a throwing
      // `removeItem` — must not skip the Privy logout and the wallet disconnect below, which are
      // what actually end the session.
      removeStoredValue(resolveLocalStorage(), FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
      setWalletStatus("Disconnected");
      if (directAuth && authenticated) {
        try {
          await logout();
        } catch (error) {
          debugWarn("[fluent widget] Privy logout failed", error);
        }
      }
      // Back to the default, not off — a fresh connection starts from it. Kept
      // until after the logout above: this value is part of the PrivyProvider
      // key, so resetting it earlier remounts Privy during the await. The logout
      // then settles on a destroyed instance while the fresh one rehydrates the
      // very session this teardown is ending — a disconnect that leaves the user
      // signed in, X avatar and all.
      commitSilentSigningEnabled(FLUENT_CONNECT_DEFAULT_SILENT_SIGNING);
      // And that change may rebuild the subtree. The person is leaving, so the
      // rebuild must show them the connect button, not the account they just
      // gave up: after the commit, never before it.
      connectedPresentation.current.connected = null;
      connectedPresentation.current.rebuilding = null;
      clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
      if (activeWallet?.connected) activeWallet.disconnect();
    } finally {
      // Released with the local teardown, not with the revokes: this guard exists for the renders
      // between setSession(null) and the Privy logout, and holding it until the service answers
      // would suppress the auto-authorize of the *next* login.
      disconnectingRef.current = false;
    }
    if (awaitAuthSession) await authSessionEnded;
  }, [activeWallet, authenticated, commitSilentSigningEnabled, connectedPresentation, directAuth, fluentConnect, logout, setDirectAuthRequested, setSession]);

  // `handleDisconnect` is also the first step of re-login (see handleConnectWithX), so
  // the event belongs to the entry points a user reaches by asking to disconnect, not to
  // the teardown itself. Emitted before the teardown clears the analytics context, so it
  // still carries the addresses of the wallet being disconnected.
  // Returns the teardown promise so the host-facing `disconnect()` can be awaited; it covers
  // revoking the session at the service. The in-widget menu and drawer ignore it and stay
  // fire-and-forget.
  const requestDisconnect = useCallback(() => {
    track("wallet_disconnected");
    return handleDisconnect({ awaitAuthSession: true });
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

  // Sub-pages (Settings, Deposit, Bridge) ride on the same value as the real
  // tabs, so remember the tab they were opened from — that is where Back leaves
  // the stack, and where closing the drawer mid-stack returns to.
  const subPage = WALLET_MENU_SUB_PAGES[walletMenuTab] ?? null;
  const lastMenuTabRef = useRef(subPage ? "home" : walletMenuTab);
  useEffect(() => {
    if (!WALLET_MENU_SUB_PAGES[walletMenuTab]) lastMenuTabRef.current = walletMenuTab;
  }, [walletMenuTab]);

  useEffect(() => {
    if (!accountOpen && WALLET_MENU_SUB_PAGES[walletMenuTab]) {
      setWalletMenuTab(lastMenuTabRef.current);
    }
  }, [accountOpen, setWalletMenuTab, walletMenuTab]);

  // Back walks one level up a nested page (Bridge → Deposit) before it drops
  // out to the tab the stack was entered from.
  const closeSubPage = useCallback(() => {
    setWalletMenuTab(
      WALLET_MENU_SUB_PAGES[walletMenuTab]?.parent ?? lastMenuTabRef.current,
    );
  }, [setWalletMenuTab, walletMenuTab]);

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
        appId: resolvedConfig.appId,
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
      // setSession above persists the session key; only the identity token is separate. Best
      // effort: a storage that will not keep it costs the next page load one re-authentication,
      // and must never turn the sign-in that just succeeded into `direct_auth_failed` below.
      writeStoredValue(resolveLocalStorage(), FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, identityToken);
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

    setConnectOpen(true);
  }, [authenticated, completeDirectAuthorization, setDirectAuthRequested]);

  useEffect(() => {
    if (!directAuth || inlineLoginRequest <= handledInlineLoginRequest.current) return;
    handledInlineLoginRequest.current = inlineLoginRequest;
    setHostedError(null);
    setDirectAuthRequested(true);
    setConnectOpen(true);
  }, [directAuth, inlineLoginRequest, handledInlineLoginRequest, setDirectAuthRequested]);

  const handleConnectWithX = useCallback(async () => {
    // The local teardown only: the new login starts as soon as the old identity is gone, and
    // revoking the old session at the service is not something it has to wait for.
    await handleDisconnect({ awaitAuthSession: false });
    if (directAuth) {
      startDirectFluentLogin();
      return;
    }
    openConnectFlow();
  }, [directAuth, handleDisconnect, openConnectFlow, startDirectFluentLogin]);
  // The bridge page's way in for someone who only has an External wallet: no
  // teardown, since that wallet is the one funding the deposit.
  const signInWithFluent = useCallback(() => {
    if (directAuth) {
      startDirectFluentLogin();
      return;
    }
    openConnectFlow();
  }, [directAuth, openConnectFlow, startDirectFluentLogin]);

  const closeAccountMenu = useCallback(() => setAccountOpen(false), [setAccountOpen]);
  const { batchReview, confirmBatchOperation, acceptBatchReview, rejectBatchReview } =
    useBatchReview({ onOpen: closeAccountMenu });
  const { signatureReview, confirmSignature, acceptSignatureReview, rejectSignatureReview } =
    useSignatureReview({ onOpen: closeAccountMenu });

  const widgetApi = useWidgetExecution({
    chain,
    fluentAccountReady,
    wallet: activeWallet,
    smartAccount,
    widgetAccount,
    defaultConfirmationMode,
    selectedGasPaymentToken,
    confirmBatchOperation,
    authMode: resolvedConfig.authMode,
    confirmSignature,
    refreshBalances,
    track,
  });

  const { getAuthToken, requestSponsorshipToken, endAuthSession } = useAuthToken(
    {
      publicApiUrl: resolvedConfig.publicApiUrl,
      appId: resolvedConfig.appId,
      authMode: resolvedConfig.authMode,
      renewalOffsetSeconds: resolvedConfig.authTokenRenewalOffsetSeconds,
      accountType: widgetAccount.type,
      privyUserId: user?.id,
      getAccessToken,
      identityToken,
      walletAddress: activeWallet?.address,
      walletClient: activeWallet?.walletClient,
    },
    authTokenState,
  );

  const {
    userTokenStore,
    settingsPending,
    preferenceError,
    tokenError,
    onQuickSignChange,
    onGasTokenChange,
  } = useUserSettings({
    state: userSettingsRef,
    publicApiUrl: resolvedConfig.publicApiUrl,
    appId: resolvedConfig.appId,
    authMode: resolvedConfig.authMode,
    network: resolvedConfig.network,
    accountType: widgetAccount.type,
    privyUserId: user?.id,
    identityToken,
    walletAddress: activeWallet?.address,
    hasWalletClient: Boolean(activeWallet?.walletClient),
    // `connecting` and `restoring` are exactly the windows in which the account
    // is on its way in: the rebuild that applying Quick sign causes reports
    // `connecting` until the smart account is ready again. Read from the raw
    // derivation, not from what the widget shows: the presentation is held at
    // `connected` through precisely this window, which is the opposite of what
    // the controller has to be told.
    settling: derivedAccount.status === "connecting" || derivedAccount.status === "restoring",
    getAuthToken,
    commitQuickSign: commitSilentSigningEnabled,
    setGasPaymentToken,
  });

  // Hands the ZeroDev hook what it could not be given at construction. Only a Fluent ID in
  // direct mode ends up with a token here; the resolver in `core/sponsoredClient` decides that
  // from `accountType` and from what the exchange answers.
  useEffect(() => {
    sponsorshipTokenSource.current = {
      accountType: widgetAccount.type,
      getAuthToken: requestSponsorshipToken,
    };
  }, [requestSponsorshipToken, widgetAccount.type]);

  // Kept current for `handleDisconnect`, which is defined above this line and must end the
  // session of whoever is connected now.
  useEffect(() => {
    endAuthSessionRef.current = endAuthSession;
  }, [endAuthSession]);

  // The Settings screen writes through these: the local change first, so the
  // switch and the select answer at once, then the service.
  const handleSilentSigningChange = useCallback(
    (enabled: boolean) => {
      onSilentSigningChange(enabled);
      onQuickSignChange(enabled);
    },
    [onQuickSignChange, onSilentSigningChange],
  );

  const handleGasPaymentTokenChange = useCallback(
    (symbol: FluentGasTokenSymbol) => {
      setGasPaymentToken(symbol);
      onGasTokenChange(symbol);
    },
    [onGasTokenChange, setGasPaymentToken],
  );

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
      authMode: resolvedConfig.authMode,
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
      resolvedConfig.authMode,
    ],
  );

  // `forceDefault` drops the X avatar at the source, so every avatar slot below
  // only has to know about the default logo.
  //
  // The X avatar belongs to the Privy user signed in on this page, which is not
  // the same thing as the account the menu is showing: connect an External
  // wallet and the header switches to its address while Privy still holds the
  // Fluent ID. Tied to `accountMenuIsExternalWallet` so the picture can never
  // describe a different account than the address beside it.
  const accountAvatarUrl =
    resolvedConfig.avatar.forceDefault || accountMenuIsExternalWallet
      ? undefined
      : getHighResTwitterAvatar(user?.twitter?.profilePictureUrl);
  const defaultLogoUrl = resolvedConfig.avatar.defaultLogoUrl;

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
        subPageTitle={subPage?.title ?? null}
        onCloseSubPage={closeSubPage}
        userLogoUrl={accountAvatarUrl}
        defaultLogoUrl={defaultLogoUrl}
        connectButton={
          <FluentConnectButtonSlot
            hasConnectedAccount={hasConnectedAccount}
            connecting={connecting}
            externalWalletConnected={account.walletConnected}
            connectedAddress={connectedAddress}
            fluentAccountAddress={fluentAccountAddress}
            onTopConnectClick={handleTopConnectClick}
            openConnect={openConnect}
            openAccount={openAccountMenu}
            renderConnectButton={renderConnectButton}
            connectButton={connectButton}
            userLogoUrl={accountAvatarUrl}
            defaultLogoUrl={defaultLogoUrl}
          />
        }
      >
        {isWalletMenuCardTab(walletMenuTab) ? (
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
            onGasPaymentTokenChange={handleGasPaymentTokenChange}
            silentSigningEnabled={silentSigningChecked}
            onSilentSigningChange={handleSilentSigningChange}
            onDisconnect={requestDisconnect}
            onConnectWithX={handleConnectWithX}
            tab={walletMenuTab}
            onTabChange={setWalletMenuTab}
            balanceRevisionCounter={balanceRevisionCounter}
            userTokenStore={userTokenStore}
            settingsPending={settingsPending}
            settingsError={preferenceError}
            tokenListError={tokenError}
          />
        ) : (
          <BridgeScreen
            config={config}
            recipient={fluentAccountAddress as `0x${string}` | undefined}
            onSignIn={signInWithFluent}
            track={track}
          />
        )}
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
        onClose={() => {
          setConnectOpen(false);
          if (directAuth) setDirectAuthRequested(false);
        }}
        onRetry={() => {
          setHostedError(null);
          void completeDirectAuthorization();
        }}
        wallet={activeWallet}
        fluentReady={directAuth ? privyReady : true}
        authMode={resolvedConfig.authMode}
        config={config}
        fluentAuthorizeUrl={directAuth ? undefined : hostedAuthorizeUrl}
        hostedError={hostedError ?? smartAccount.error?.message}
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
      <SignatureReviewModal
        review={signatureReview}
        onConfirm={acceptSignatureReview}
        onCancel={rejectSignatureReview}
      />
    </div>
    </Toaster>
    </FluentPortalContainerProvider>
  );

  return widget;
}
