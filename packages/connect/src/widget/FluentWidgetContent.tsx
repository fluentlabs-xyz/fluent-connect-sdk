import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Copy, ExternalLink, LogOut } from "lucide-react";
import { useIdentityToken, usePrivy, useUser } from "@privy-io/react-auth";
import {
  createFluentConnectForWidget,
  FLUENT_CONNECT_PRIVY_APP_ID,
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  resolveFluentWidgetConfig,
  type FluentWidgetSession,
} from "../core/config";
import { ConnectChoiceModal } from "../components/ConnectChoiceModal";
import { FluentWidgetConnectButton } from "../components/FluentWidgetConnectButton";
import { Icon } from "../components/Icon";
import { WalletMenuActionCard } from "../components/WalletMenuActionCard";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
} from "../components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../components/ui/select";
import { toast, Toaster } from "../components/ui/toast";
import { useIsMobile } from "../hooks/use-mobile";
import { getFluentDefaultGasTokens } from "../core/network";
import { clearPrivyRecentLoginMethod } from "../utils/clearPrivyRecentLoginMethod";
import { copyAddressToClipboard } from "../utils/copyAddress";
import { createLocalFluentSession } from "../utils/createLocalFluentSession";
import { explorerAddress } from "../utils/explorerAddress";
import { formatAddress } from "../utils/formatAddress";
import { formatExternalWallet } from "../utils/formatExternalWallet";
import { formatSession } from "../utils/formatSession";
import { getAnonymousId } from "../utils/getAnonymousId";
import { toastFaucetError, toastFaucetSuccess } from "../utils/faucetToast";
import { HttpError, postJson } from "../utils/postJson";
import { useReownWallet } from "./reownAppKit";
import {
  createFluentBatchOp,
  type FluentAccountType,
  type FluentBatchApi,
  type FluentBatchConfirmationMode,
  type FluentBatchOperationExecuteOptions,
  type FluentBatchOperationInput,
  type FluentBatchOperationReview,
  type FluentEncodedBatchCall,
  type FluentExecuteResult,
  type FluentWidgetAccount,
} from "./batchOperation";
import { createFluentPermissionApi } from "./permissionSession";
import { useFluentZeroDevAccount } from "./zerodevSession";
import { useFluentWidgetNetwork } from "./widgetNetworkContext";
import type { FluentExternalWalletState } from "../core/types";
import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
} from "viem";
import type { FluentGasPaymentSymbol } from "../core/gasPayment";
import { BatchOperationReviewModal } from "../components/BatchOperationReviewModal";
import { FluentWidgetProvider } from "./widgetContext";
import type {
  FluentWidgetConnectButtonRenderContext,
  FluentWidgetProps,
  FluentWidgetRenderContext,
} from "./FluentWidget";

const FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY = "fluent:widget:auth-state:v1";

/**
 * Execute batch calls through an external EOA (e.g. MetaMask): no smart account,
 * so send each call as its own native-gas transaction, in order, waiting for
 * each receipt. Not atomic — `approve` then `deposit` are separate signatures.
 */
async function sendCallsViaExternalWallet(
  calls: FluentEncodedBatchCall[],
  wallet: FluentExternalWalletState,
  chain: Chain,
  publicClient: PublicClient,
): Promise<FluentExecuteResult> {
  const walletClient = wallet.walletClient;
  if (!walletClient) throw new Error("External wallet client is not available");
  // Best-effort: ensure the wallet is on the widget chain (Reown's single-network
  // config can report the configured chain even when the wallet's real one differs).
  try {
    await wallet.switchChain(chain.id);
  } catch {
    // already on chain, or the wallet added/rejected it itself
  }
  const account = walletClient.account ?? (wallet.address as `0x${string}` | undefined);
  if (!account) throw new Error("External wallet has no active account");

  const hashes: Hash[] = [];
  for (const call of calls) {
    const hash = await walletClient.sendTransaction({
      to: call.to,
      data: call.data,
      value: call.value,
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    hashes.push(hash);
  }
  const hash = hashes[hashes.length - 1];
  if (!hash) throw new Error("A Fluent batch operation requires at least one call");
  return { hash, hashes, atomic: false };
}

export type FluentWidgetContentProps = FluentWidgetProps & {
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
  const smartAccount = useFluentZeroDevAccount({ login: requestPrivyLogin });
  const { authenticated, login, logout, ready: privyReady, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const activeWallet = wallet ?? internalWallet;
  const { chain } = useFluentWidgetNetwork();
  // Public client for waiting on external-wallet (EOA) transaction receipts.
  const eoaPublicClient = useMemo<PublicClient>(
    () => createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) }),
    [chain],
  );
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  const fluentConnect = useMemo(() => createFluentConnectForWidget(config), [config]);
  const directAuth = resolvedConfig.authMode === "direct";
  const directAuthRequested = useRef(false);
  const directAuthInFlight = useRef(false);
  // Blocks auto-reauthorization while an explicit disconnect is in flight, so
  // the still-authenticated Privy session can't silently recreate the session.
  const disconnectingRef = useRef(false);
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
  const [balanceRevisionCounter, setBalanceRevisionCounter] = useState(0);
  /** Bump to refetch the widget's on-chain balances after a confirmed tx. */
  const refreshBalances = useCallback(() => setBalanceRevisionCounter((value) => value + 1), []);
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
  // Direct auth (e.g. Twitter): Privy signs in fast, but the ZeroDev smart
  // account takes a few seconds to become ready. Surface that window so the
  // button can show a pending state instead of looking disconnected.
  const connecting = Boolean(
    !hasConnectedAccount &&
      directAuth &&
      smartAccount.privyAuthenticated &&
      !smartAccount.error,
  );
  const defaultConfirmationMode: FluentBatchConfirmationMode = silentSigningEnabled ? "session" : "always";
  const defaultGasTokens = useMemo(
    () => getFluentDefaultGasTokens(resolvedConfig.network),
    [resolvedConfig.network],
  );
  const selectedGasPaymentToken = useMemo(() => {
    const availableTokens = tokens ?? defaultGasTokens;
    const selected = availableTokens.find(
      (token) => token.symbol === gasPaymentToken,
    );
    return {
      symbol: gasPaymentToken,
      token: selected && "address" in selected ? selected.address : undefined,
      decimals: selected?.decimals ?? (gasPaymentToken === "ETH" ? 18 : 0),
    };
  }, [gasPaymentToken, tokens, defaultGasTokens]);
  const widgetAccount = useMemo<FluentWidgetAccount>(() => {
    const address = (smartAccount.smartAccountAddress ?? fluentAccountAddress ?? connectedAddress) as Address | undefined;
    // Smart account (Fluent ID) takes precedence; otherwise a connected external
    // EOA (MetaMask) can also execute — just without AA perks.
    const externalReady = Boolean(activeWallet?.connected && activeWallet.walletClient);
    const type: FluentAccountType | undefined = fluentAccountReady
      ? "smart"
      : activeWallet?.connected
        ? "eoa"
        : undefined;
    const executionReady = fluentAccountReady || externalReady;
    const connected = Boolean(activeWallet?.connected || executionReady);

    return {
      address,
      signerAddress: smartAccount.signerAddress,
      connected,
      executionReady,
      type,
      capabilities: {
        atomicBatch: type === "smart",
        sponsoredGas: type === "smart",
      },
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
    activeWallet?.walletClient,
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
  const openAccountMenu = useCallback(() => {
    setAccountOpen(true);
  }, []);
  const connectAddressLabel = hasConnectedAccount
    ? activeWallet?.connected
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
      onClick={handleTopConnectClick}
    />
  );
  const connectButtonContext: FluentWidgetConnectButtonRenderContext = {
    connected: hasConnectedAccount,
    pending: connecting,
    addressLabel: connectAddressLabel,
    onClick: handleTopConnectClick,
    openConnect: openConnectFlow,
    openAccount: openAccountMenu,
    DefaultButton: () => defaultConnectButton,
  };
  const renderedConnectButton =
    renderConnectButton?.(connectButtonContext) ??
    (connectButton === false
      ? null
      : connectButton === "inline"
        ? defaultConnectButton
        : (
            <div className="fixed top-5 right-5 z-50">
              {defaultConnectButton}
            </div>
          ));
  const handleDisconnect = useCallback(async () => {
    // Guard the whole teardown: the auto-authorize effect runs on the render
    // caused by setSession(null) while Privy is still authenticated (logout is
    // async), and would otherwise recreate the session we're tearing down.
    disconnectingRef.current = true;
    try {
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
    } finally {
      disconnectingRef.current = false;
    }
  }, [activeWallet, authenticated, commitSilentSigningEnabled, directAuth, fluentConnect, logout, setSession]);

  const handleAccountMenuAction = useCallback(
    (value: string | null) => {
      if (!value || !accountMenuAddress) return;

      if (value === "explorer") {
        const popup = globalThis.window?.open(
          explorerAddress(accountMenuAddress, resolvedConfig.network),
          "_blank",
          "noopener,noreferrer",
        );
        if (popup) popup.opener = null;
        return;
      }
      if (value === "copy") {
        void copyAddressToClipboard(accountMenuAddress);
        return;
      }
      if (value === "disconnect") {
        void handleDisconnect();
      }
    },
    [accountMenuAddress, handleDisconnect, resolvedConfig.network],
  );

  const handleFaucetClaim = useCallback(async () => {
    if (!session) {
      toast.add({
        type: "warning",
        title: "Connect required",
        description: "Connect with Fluent ID before claiming faucet.",
      });
      setWalletStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!identityToken) {
      openConnectFlow();
      return;
    }

    setFaucetBusy(true);
    setWalletStatus("Requesting BLEND faucet");
    const loadingToastId = toast.add({
      type: "loading",
      title: "Requesting faucet",
      description: "Claiming testnet BLEND…",
    });
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
      toast.close(loadingToastId);
      toastFaucetSuccess(receipt);
      refreshBalances();
      setWalletStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
    } catch (err) {
      toast.close(loadingToastId);
      if (err instanceof HttpError && err.status === 401) {
        try {
          await refreshUser();
          toast.add({
            type: "info",
            title: "Session refreshed",
            description: "Tap Faucet again to claim BLEND.",
          });
          setWalletStatus("Session refreshed. Tap Faucet again.");
        } catch {
          openConnectFlow();
        }
        return;
      }
      toastFaucetError(err);
      setWalletStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [identityToken, openConnectFlow, refreshBalances, refreshUser, resolvedConfig.faucetEndpoint, session]);

  const completeDirectAuthorization = useCallback(async () => {
    if (!directAuth || !authenticated || !user?.id || session || directAuthInFlight.current) return;
    if (disconnectingRef.current) return;
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
    directAuthRequested.current = true;

    if (authenticated) {
      completeDirectAuthorization();
      return;
    }

    requestPrivyLogin();
  }, [authenticated, completeDirectAuthorization, requestPrivyLogin]);

  const handleConnectWithX = useCallback(async () => {
    await handleDisconnect();
    if (directAuth) {
      startDirectFluentLogin();
      return;
    }
    openConnectFlow();
  }, [directAuth, handleDisconnect, openConnectFlow, startDirectFluentLogin]);

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

  /// Unified execution: route to the Fluent smart account (one sponsored,
  /// atomic UserOp) when it's ready, otherwise to the connected external EOA
  /// (sequential native-gas txs). Host apps call `createBatchOp().execute()`
  /// once and never branch on the account type.
  const sendCalls = useCallback(
    async (
      calls: FluentEncodedBatchCall[],
      options: FluentBatchOperationExecuteOptions,
    ): Promise<FluentExecuteResult> => {
      if (fluentAccountReady) {
        const hash = await smartAccount.sendCalls(calls, options);
        refreshBalances();
        return { hash, hashes: [hash], atomic: true };
      }
      if (activeWallet?.connected && activeWallet.walletClient) {
        const result = await sendCallsViaExternalWallet(calls, activeWallet, chain, eoaPublicClient);
        refreshBalances();
        return result;
      }
      throw new Error("No Fluent account is available to execute this operation");
    },
    [activeWallet, chain, eoaPublicClient, fluentAccountReady, refreshBalances, smartAccount.sendCalls],
  );
  const createBatchOp = useCallback(
    (input: FluentBatchOperationInput) =>
      createFluentBatchOp(input, {
        account: widgetAccount,
        smartAccountReady: smartAccount.smartAccountReady,
        ensureReady: smartAccount.ensureExecutionReady,
        defaultConfirmation: defaultConfirmationMode,
        defaultGasPayment: selectedGasPaymentToken,
        confirm: confirmBatchOperation,
        sendCalls,
      }),
    [
      widgetAccount,
      smartAccount.smartAccountReady,
      smartAccount.ensureExecutionReady,
      sendCalls,
      defaultConfirmationMode,
      selectedGasPaymentToken,
      confirmBatchOperation,
    ],
  );

  /// ZeroDev permission sessions are bound to the active Kernel account so
  /// apps can later request scoped session policies instead of raw private
  /// key delegation.
  const permissionApi = useMemo(
    () =>
      createFluentPermissionApi({
        kernel: smartAccount.kernel,
        smartAccountReady: smartAccount.smartAccountReady,
      }),
    [smartAccount.kernel, smartAccount.smartAccountReady],
  );

  const widgetApi = useMemo<FluentBatchApi>(
    () => ({
      account: widgetAccount,
      confirmationMode: defaultConfirmationMode,
      gasPayment: selectedGasPaymentToken,
      createBatchOp,
      ...permissionApi,
    }),
    [widgetAccount, defaultConfirmationMode, selectedGasPaymentToken, createBatchOp, permissionApi],
  );

  const context = useMemo<FluentWidgetRenderContext>(
    () => ({
      session,
      connectedAddress,
      wallet: activeWallet,
      widget: widgetApi,
      openConnect: openConnectFlow,
      openAccount: openAccountMenu,
      hasConnectedAccount,
      connecting,
      refreshBalances,
    }),
    [
      session,
      connectedAddress,
      activeWallet,
      widgetApi,
      openConnectFlow,
      openAccountMenu,
      hasConnectedAccount,
      connecting,
      refreshBalances,
    ],
  );

  const widget = (
    <Toaster>
    <div className="dark contents text-white antialiased">
      <Drawer
        open={hasConnectedAccount && accountOpen}
        onOpenChange={setAccountOpen}
        swipeDirection={isMobile ? "down" : "right"}
      >
        {renderedConnectButton}

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
                connectedAddress={connectedAddress}
                faucetBusy={faucetBusy}
                onFaucet={handleFaucetClaim}
                config={config}
                tokens={tokens}
                gasPaymentToken={gasPaymentToken}
                onGasPaymentTokenChange={setGasPaymentToken}
                silentSigningEnabled={silentSigningChecked}
                onSilentSigningChange={onSilentSigningChange}
                onDisconnect={handleDisconnect}
                onConnectWithX={handleConnectWithX}
                tab={walletMenuTab}
                onTabChange={setWalletMenuTab}
                balanceRevisionCounter={balanceRevisionCounter}
              />
            </div>
          </DrawerContent>
        ) : null}
      </Drawer>

      <FluentWidgetProvider value={context}>
        {mode === "page" ? renderPage?.(context) : renderHome?.(context)}
      </FluentWidgetProvider>

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
    </Toaster>
  );

  return widget;
}
