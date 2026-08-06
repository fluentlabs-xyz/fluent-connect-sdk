import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Copy, ExternalLink, LogOut } from "lucide-react";
import { PrivyProvider, useIdentityToken, usePrivy, useUser } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_DEFAULT_ASSETS,
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
import { Icon } from "./components/Icon";
import { WalletMenuActionCard } from "./components/WalletMenuActionCard";
import { Button } from "./components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
} from "./components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./components/ui/select";
import { useIsMobile } from "./hooks/use-mobile";
import { clearPrivyRecentLoginMethod } from "./utils/clearPrivyRecentLoginMethod";
import { createLocalFluentSession } from "./utils/createLocalFluentSession";
import { explorerAddress } from "./utils/explorerAddress";
import { formatAddress } from "./utils/formatAddress";
import { formatExternalWallet } from "./utils/formatExternalWallet";
import { formatSession } from "./utils/formatSession";
import { getAnonymousId } from "./utils/getAnonymousId";
import { HttpError, postJson } from "./utils/postJson";
import {
  fluentTestnetTokenDefaults,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
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
import type { FluentGasPaymentSymbol } from "./gasPayment";

const FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY = "fluent:widget:auth-state:v1";
const SILENT_SIGNING_REMOUNT_MS = 220;

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
  // Optimistic UI so the switch can animate before Privy remounts.
  const [silentSigningChecked, setSilentSigningChecked] = useState(false);
  const silentSigningRemountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remount Privy after clearing recent-login storage so X stays first.
  const [privyEpoch, setPrivyEpoch] = useState(0);
  const pendingPrivyLoginRef = useRef(false);
  // Keep drawer + active tab across Privy remounts when silent signing toggles.
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletMenuTab, setWalletMenuTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] =
    useState<FluentGasPaymentSymbol>("BLEND");
  const privyConfig = useMemo(
    () =>
      createFluentConnectPrivyConfig({
        showWalletUIs: !silentSigningEnabled,
        logo: props.config?.assets?.fluentLogo ?? FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
      }),
    [props.config?.assets?.fluentLogo, silentSigningEnabled],
  );

  // Drop last-used promotion before Privy's mount effect reads storage.
  useLayoutEffect(() => {
    clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
  }, [privyEpoch, silentSigningEnabled]);

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

  const requestPrivyLogin = useCallback(() => {
    clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
    pendingPrivyLoginRef.current = true;
    setPrivyEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    return () => {
      if (silentSigningRemountTimer.current) {
        clearTimeout(silentSigningRemountTimer.current);
      }
    };
  }, []);

  return (
    <PrivyProvider
      key={`${silentSigningEnabled ? "silent-signing" : "prompt-signing"}-${privyEpoch}`}
      appId={FLUENT_CONNECT_PRIVY_APP_ID}
      config={privyConfig}
    >
      <ReownProvider>
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
          requestPrivyLogin={requestPrivyLogin}
          pendingPrivyLoginRef={pendingPrivyLoginRef}
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
}: FluentWidgetProps & {
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
}) {
  const internalWallet = useReownWallet();
  const isMobile = useIsMobile();
  const smartAccount = useFluentZeroDevAccount({ login: requestPrivyLogin });
  const { authenticated, login, logout, ready: privyReady, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const activeWallet = wallet ?? internalWallet;
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const fluentConnect = useMemo(() => createFluentConnectForWidget(config), [config]);
  const directAuth = resolvedConfig.authMode === "direct";
  const directAuthRequested = useRef(false);
  const directAuthInFlight = useRef(false);
  const [session, setSessionState] = useState<FluentWidgetSession | null>(() => {
    try {
      const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as FluentWidgetSession) : null;
    } catch {
      return null;
    }
  });
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [hostedAuthorizeUrl, setHostedAuthorizeUrl] = useState<string | undefined>();
  const [batchReview, setBatchReview] = useState<FluentBatchOperationReview | null>(null);
  const hostedConnectWindow = useRef<Window | null>(null);
  const hostedConnectState = useRef<string | null>(null);
  const batchReviewResolution = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const zeroDevInitRequested = useRef(false);
  const fluentAccountAddress = smartAccount.smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const connectedAddress = activeWallet?.connected && activeWallet.address ? activeWallet.address : fluentAccountAddress;
  const accountMenuAddress = activeWallet?.connected ? connectedAddress : fluentAccountAddress;
  const localPrivySignerReady = Boolean(
    smartAccount.privyReady &&
      smartAccount.privyAuthenticated &&
      smartAccount.embeddedWalletCount > 0,
  );
  const fluentAccountReady = Boolean(
    smartAccount.smartAccountReady &&
      smartAccount.smartAccountAddress &&
      (!directAuth || localPrivySignerReady),
  );
  const hasConnectedAccount = Boolean(
    activeWallet?.connected ||
      (directAuth
        ? fluentAccountReady
        : session?.user?.id || session?.wallet?.smartAccountAddress),
  );
  const defaultConfirmationMode: FluentBatchConfirmationMode = silentSigningEnabled ? "session" : "always";
  const selectedGasPaymentToken = useMemo(() => {
    const availableTokens = tokens ?? [
      fluentTestnetTokenDefaults.USDnr,
      fluentTestnetTokenDefaults.BLEND,
      fluentTestnetTokenDefaults.ETH,
    ];
    const selected = availableTokens.find(
      (token) => token.symbol === gasPaymentToken,
    );
    return {
      symbol: gasPaymentToken,
      token: selected && "address" in selected ? selected.address : undefined,
      decimals: selected?.decimals ?? (gasPaymentToken === "ETH" ? 18 : 0),
    };
  }, [gasPaymentToken, tokens]);
  const widgetAccount = useMemo<FluentWidgetAccount>(() => {
    const address = (smartAccount.smartAccountAddress ?? fluentAccountAddress ?? connectedAddress) as Address | undefined;
    const executionReady = fluentAccountReady;
    const connected = Boolean(activeWallet?.connected || executionReady);

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
    activeWallet?.connected,
    connectedAddress,
    fluentAccountAddress,
    fluentAccountReady,
    smartAccount.error,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
  ]);

  const setSession = useCallback(
    (nextSession: FluentWidgetSession | null) => {
      console.log("[fluent widget] setSession", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id,
        signerAddress: nextSession?.wallet?.signerAddress,
        smartAccountAddress: nextSession?.wallet?.smartAccountAddress,
        scopes: nextSession?.scopes,
      });
      setSessionState(nextSession);
      onSessionChange?.(nextSession);
    },
    [onSessionChange],
  );

  const openConnectFlow = useCallback(() => {
    setAccountOpen(false);
    setHostedError(null);

    if (directAuth) {
      setHostedAuthorizeUrl(undefined);
      setConnectOpen(true);
      return;
    }

    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    hostedConnectState.current = state;
    try {
      window.sessionStorage.setItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY, state);
    } catch {
      // In-memory state still protects popup flows when storage is unavailable.
    }
    const authorizeUrl = fluentConnect.buildAuthorizeUrl(state).toString();
    console.log("[fluent widget] open connect", {
      state,
      authorizeUrl,
      clientId: resolvedConfig.clientId,
      appName: resolvedConfig.appName,
      authMode: resolvedConfig.authMode,
    });
    setHostedAuthorizeUrl(authorizeUrl);
    setConnectOpen(true);
  }, [directAuth, fluentConnect, resolvedConfig.appName, resolvedConfig.authMode, resolvedConfig.clientId]);
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  const handleDisconnect = useCallback(async () => {
    setAccountOpen(false);
    commitSilentSigningEnabled(false);
    setSession(null);
    zeroDevInitRequested.current = false;
    directAuthRequested.current = false;
    directAuthInFlight.current = false;
    fluentConnect.disconnect();
    window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
    setWalletStatus("Disconnected");
    if (directAuth && authenticated) {
      try {
        await logout();
      } catch (error) {
        console.warn("[fluent widget] Privy logout failed", error);
      }
    }
    clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
    if (activeWallet?.connected) activeWallet.disconnect();
  }, [activeWallet, authenticated, commitSilentSigningEnabled, directAuth, fluentConnect, logout, setSession]);

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
    } catch (error) {
      console.warn("[fluent widget] Failed to copy address", error);
    }
  }, []);

  const handleAccountMenuAction = useCallback(
    (value: string | null) => {
      if (!value || !accountMenuAddress) return;

      if (value === "explorer") {
        const popup = globalThis.window?.open(
          explorerAddress(accountMenuAddress),
          "_blank",
          "noopener,noreferrer",
        );
        if (popup) popup.opener = null;
        return;
      }
      if (value === "copy") {
        void handleCopyAddress(accountMenuAddress);
        return;
      }
      if (value === "disconnect") {
        void handleDisconnect();
      }
    },
    [accountMenuAddress, handleCopyAddress, handleDisconnect],
  );

  const handleFaucetClaim = useCallback(async () => {
    if (!session) {
      setWalletStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!identityToken) {
      openConnectFlow();
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
          Authorization: `Bearer ${identityToken}`,
        },
      );
      setWalletStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        try {
          await refreshUser();
          setWalletStatus("Session refreshed. Tap Faucet again.");
        } catch {
          openConnectFlow();
        }
        return;
      }
      setWalletStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [identityToken, openConnectFlow, refreshUser, resolvedConfig.faucetEndpoint, session]);

  const completeDirectAuthorization = useCallback(async () => {
    if (!directAuth || !authenticated || !user?.id || session || directAuthInFlight.current) return;
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
        scopes: resolvedConfig.scopes,
        userId: user.id,
        email: typeof user.email?.address === "string" ? user.email.address : undefined,
        signerAddress: (smartAccount.signerAddress ?? undefined) as `0x${string}` | undefined,
        smartAccountAddress: kernel.smartAccountAddress,
      });

      console.log("[fluent widget] direct auth session created", {
        userId: nextSession.user.id,
        signerAddress: nextSession.wallet.signerAddress,
        smartAccountAddress: nextSession.wallet.smartAccountAddress,
      });

      setSession(nextSession);
      zeroDevInitRequested.current = false;
      fluentConnect.setSession(nextSession);
      window.localStorage.setItem(FLUENT_WIDGET_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      window.localStorage.setItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, identityToken);
      setWalletStatus("Wallet connected!");
      setConnectOpen(false);
      directAuthRequested.current = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create Fluent session";
      console.error("[fluent widget] direct auth failed", error);
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
    setSession,
    smartAccount.error?.message,
    smartAccount.kernel,
    smartAccount.refresh,
    smartAccount.signerAddress,
    user,
  ]);

  useEffect(() => {
    if (!directAuth || session) return;
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
    directAuthRequested.current = true;

    if (authenticated) {
      completeDirectAuthorization();
      return;
    }

    requestPrivyLogin();
  }, [authenticated, completeDirectAuthorization, requestPrivyLogin]);

  const confirmBatchOperation = useCallback((operation: FluentBatchOperationReview) => {
    setAccountOpen(false);
    batchReviewResolution.current?.reject(
      new Error("A newer Fluent transaction review replaced this request"),
    );
    setBatchReview(operation);
    return new Promise<void>((resolve, reject) => {
      batchReviewResolution.current = { resolve, reject };
    });
  }, []);

  const acceptBatchReview = useCallback(() => {
    batchReviewResolution.current?.resolve();
    batchReviewResolution.current = null;
    setBatchReview(null);
  }, []);

  const rejectBatchReview = useCallback(() => {
    batchReviewResolution.current?.reject(new Error("User rejected Fluent transaction review"));
    batchReviewResolution.current = null;
    setBatchReview(null);
  }, []);

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
        expectedState ??= window.sessionStorage.getItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
      } catch {
        // Fall back to the in-memory state.
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
        signerAddress: payload.session.wallet?.signerAddress,
        smartAccountAddress: payload.session.wallet?.smartAccountAddress,
        scopes: payload.session.scopes,
        hasIdentityToken: Boolean(nextIdentityToken),
      });
      setSession(payload.session);
      zeroDevInitRequested.current = false;
      fluentConnect.setSession(payload.session);
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
        smartAccount.refresh().catch((error) => {
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
      sessionSignerAddress: session?.wallet?.signerAddress,
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
    if (smartAccount.smartAccountReady) return;
    if (!directAuth && !session) return;
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
    smartAccount.refresh().catch((error) => {
      zeroDevInitRequested.current = false;
      console.warn("[fluent widget] ZeroDev account initialization failed", error);
    });
  }, [
    directAuth,
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
      confirmationMode: defaultConfirmationMode,
      gasPayment: selectedGasPaymentToken,
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
    <div className="dark contents text-white antialiased">
      <Drawer
        open={hasConnectedAccount && accountOpen}
        onOpenChange={setAccountOpen}
        swipeDirection={isMobile ? "down" : "right"}
      >
        <div className="fixed top-5 right-5 z-50">
          <button
            type="button"
            className="bg-black p-1.5 pr-3 rounded-xl flex items-center gap-2 text-white shadow-2xl overflow-hidden relative group"
            aria-expanded={hasConnectedAccount ? accountOpen : undefined}
            onClick={handleTopConnectClick}
          >
            <div className="size-8 bg-white/5 rounded-md flex items-center justify-center relative z-10 ">
              <Icon name="fluent" className="size-3" />
            </div>

            <div
              className="absolute z-[1] inset-0 h-[200%] opacity-25 group-hover:opacity-50 transition-all duration-250 ease-in-out -translate-y-0 group-hover:-translate-y-5 group-hover:h-[300%]"
              style={{
                background:
                    "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
                backgroundSize: "150% auto",
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
              }}
            />

            {hasConnectedAccount ? (
              <div className="flex flex-col items-start gap-0.5 relative z-10">
                {/* <div className="text-[10px] leading-none text-white/50">Wallet</div> */}
                <div className="text-sm font-medium leading-none">
                  {activeWallet?.connected
                    ? connectedAddress
                      ? formatAddress(connectedAddress)
                      : "Connected"
                    : fluentAccountAddress
                      ? formatAddress(fluentAccountAddress)
                      : "Connected"}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-0.5 relative z-10">
                <div className="text-sm font-medium leading-none">Connect Wallet</div>
                {/* <div className="text-[10px] leading-none text-white/50">Powered by Fluent</div> */}
              </div>
            )}
          </button>
        </div>

        {hasConnectedAccount ? (
          <DrawerContent
            aria-label="Connected account"
            className="dark text-white antialiased sm:w-96"
          >
            <DrawerHeader className="items-stretch p-4 pb-0">
              {accountMenuAddress ? (
                <Select value={null} onValueChange={handleAccountMenuAction}>
                  <SelectTrigger
                    aria-label="Account actions"
                    className="!h-auto w-full gap-2 overflow-hidden rounded-xl border border-white/10 !bg-transparent p-1.5 pr-3 hover:border-white/20 hover:!bg-white/5 aria-expanded:border-white/20 aria-expanded:!bg-white/5"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
                      <Icon name="fluent" className="size-3" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-none text-white">
                      {formatAddress(accountMenuAddress)}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    alignItemWithTrigger={false}
                    className="min-w-(--anchor-width)"
                  >
                    <SelectItem value="explorer">
                      <ExternalLink className="size-4" />
                      Open on FluentScan
                    </SelectItem>
                    <SelectItem value="copy">
                      <Copy className="size-4" />
                      Copy address
                    </SelectItem>
                    <SelectItem value="disconnect">
                      <LogOut className="size-4" />
                      Disconnect
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 p-2 pr-3 shadow-2xl">
                  <div className="relative z-10 flex size-8 items-center justify-center rounded-md bg-white/10">
                    <Icon name="fluent" className="size-3" />
                  </div>
                  <div className="relative z-10 text-sm font-medium leading-none">Connected</div>
                </div>
              )}
            </DrawerHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <WalletMenuActionCard
                session={session}
                smartAccountAddress={fluentAccountAddress}
                faucetBusy={faucetBusy}
                onFaucet={handleFaucetClaim}
                config={config}
                renderPermissions={renderPermissions}
                tokens={tokens}
                gasPaymentToken={gasPaymentToken}
                onGasPaymentTokenChange={setGasPaymentToken}
                silentSigningEnabled={silentSigningChecked}
                onSilentSigningChange={onSilentSigningChange}
                onDisconnect={handleDisconnect}
                tab={walletMenuTab}
                onTabChange={setWalletMenuTab}
              />
            </div>
          </DrawerContent>
        ) : null}
      </Drawer>

      {mode === "page" ? renderPage?.(context) : renderHome?.(context)}

      {showDebugPayload && mode === "home" ? (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 text-white shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
            <h2 className="m-0 text-base font-medium">Host app callback</h2>
            <span className="rounded-full bg-[#49eded]/15 px-2 py-1 text-xs font-medium text-[#49eded]">
              mock
            </span>
          </div>
          <pre className="overflow-auto p-4 text-xs">{formatSession(session)}</pre>
          <div className="flex items-center justify-between gap-3 border-y border-white/10 px-4 py-3.5">
            <h2 className="m-0 text-base font-medium">External wallet</h2>
            <span className="rounded-full bg-[#49eded]/15 px-2 py-1 text-xs font-medium text-[#49eded]">
              {activeWallet?.connected ? "Reown" : "wallet"}
            </span>
          </div>
          <pre className="overflow-auto p-4 text-xs">{formatExternalWallet(activeWallet, walletStatus)}</pre>
          {hostedError ? (
            <p className="m-0 px-4 pb-4 text-[13px] leading-5 text-[#ff8fda]">{hostedError}</p>
          ) : null}
        </section>
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
        onFluentLogin={() => {
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

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#030213]/70 p-6 backdrop-blur-md"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="w-full max-w-[520px] rounded-[18px] border border-[#49eded]/30 bg-[#030213] p-[18px] text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Fluent transaction"
      >
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black uppercase text-[#49eded]">
              Fluent transaction review
            </span>
            <h2 className="mt-1 text-2xl leading-[30px] font-medium">
              {operation.button?.label ?? "Confirm transaction"}
            </h2>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Close"
            onClick={onCancel}
          >
            x
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3">
          <span className="text-xs text-white/65">Signing account</span>
          <strong className="text-sm">
            {operation.account?.address ? formatAddress(operation.account.address) : "Fluent account"}
          </strong>
        </div>
        <ul className="my-3 flex list-none flex-col gap-2 p-0" aria-label="Transaction calls">
          {operation.encodedCalls.map((call, index) => (
            <li
              className="flex flex-col gap-1 rounded-xl border border-[#49eded]/20 bg-[#49eded]/10 p-3"
              key={call.id ?? `${call.to}-${index}`}
            >
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm">
                  {call.label ?? operation.calls[index]?.method ??
                    operation.calls[index]?.functionName ?? "Contract call"}
                </strong>
                <span className="text-xs text-white/65">{formatAddress(call.to)}</span>
              </div>
              {call.value > 0n ? (
                <small className="text-xs text-white/65">Value {call.value.toString()} wei</small>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs leading-[18px] text-white/65">
          Confirming allows the Fluent embedded signer to sign this ZeroDev UserOperation.
        </p>
        <div className="mt-3 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2.5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Confirm and sign
          </Button>
        </div>
      </section>
    </div>
  );
}
