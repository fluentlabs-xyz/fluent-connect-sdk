import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useIdentityToken,
  useLinkAccount,
  useLoginWithSiwe,
  usePrivy,
  useUser,
  type PrivyErrorCode,
} from "@privy-io/react-auth";
import type { Hash } from "viem";
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
  resolveSessionStorage,
  writeStoredValue,
} from "../core/browserStorage";
import { FluentAuthError } from "../core/authToken";
import type { FluentAccountType } from "./batchOperation";
import {
  clearLinkXMarker,
  linkXIntentDiscardedError,
  privyUserHasExternalWallet,
  privyUserHasLinkedX,
  privyUserOwnsWallet,
  readLinkXMarker,
  requestLinkX,
  toLinkXPrivyError,
  type FluentLinkXPrivyErrorCode,
  type FluentLinkXPrivyUser,
  type FluentLinkXResult,
  type LinkXWalletInput,
} from "../core/linkX";
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
import { FluentTopLayerBridge } from "./topLayerElevator";
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
import { useTokenTransfer } from "./hooks/useTokenTransfer";
import {
  FLUENT_SEND_TOKEN_OP_ID,
  resolveFluentTransferGasContext,
  type FluentPendingTransfer,
} from "./tokenTransfer";
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

/** How long a settled transfer waits for the history to list it before its row goes. */
const SETTLED_TRANSFER_GRACE_MS = 90_000;

/**
 * How long a `linkX()` waits for Privy to publish the identity token `refreshUser()` has already
 * put in its store, and for the signed-out commit after a `logout()` it asked for. One React
 * commit is all either should take; the bound exists so a Privy that never publishes fails the
 * call instead of leaving the integrator's promise out forever.
 */
const LINK_X_IDENTITY_TOKEN_TIMEOUT_MS = 10_000;

/**
 * How long each of Privy's two headless SIWE steps — `generateSiweMessage`, `loginWithSiwe` —
 * may take before `linkX()` gives up on it. The same bound as the identity token: both are one
 * Privy round trip. The case the bound exists for is Privy's captcha: with captcha enabled on
 * the Privy app, both steps wait on a `Captcha` component this SDK mounts only inside the
 * connect modal, which is closed during `linkX()`, so the wait never ends. Mounting it beside
 * `LinkXSiweSource` is a follow-up; until then the message below names the cause.
 */
const LINK_X_SIWE_STEP_TIMEOUT_MS = LINK_X_IDENTITY_TOKEN_TIMEOUT_MS;

/**
 * How long the wallet may take to answer the SIWE signature prompt. A person is on the other
 * end of this one — reading the message, unlocking the wallet, confirming on a hardware device —
 * so it is minutes where Privy's steps get seconds. A prompt nobody answers in this time is a
 * `link_failed` rather than a promise held open for the life of the page, and its message names
 * the likely causes Privy's own steps name, so every SIWE-step timeout points an integrator at
 * the same two Privy settings.
 */
const LINK_X_WALLET_SIGNATURE_TIMEOUT_MS = 5 * 60_000;

/** What every SIWE-step timeout names as its likely causes: what an integrator can check. */
const SIWE_TIMEOUT_LIKELY_CAUSES =
  "Likely causes: captcha is enabled on the Privy app, which linkX() cannot solve, or wallet login is disabled there.";

/** What a Privy SIWE step that never answers rejects with. */
function siweStepTimedOut(step: string): string {
  return `Privy did not ${step} within ${LINK_X_SIWE_STEP_TIMEOUT_MS / 1000} seconds. ${SIWE_TIMEOUT_LIKELY_CAUSES} Nothing was linked.`;
}

/** What the wallet's SIWE signature prompt that never answers rejects with. */
function walletSignatureTimedOut(): string {
  return `The wallet did not answer the signature request within ${LINK_X_WALLET_SIGNATURE_TIMEOUT_MS / 60_000} minutes. ${SIWE_TIMEOUT_LIKELY_CAUSES} Nothing was linked.`;
}

/**
 * `work`, or `link_failed` with `message` once `ms` have passed without it settling. The late
 * settlement of `work` is ignored: the caller has its answer by then, and nothing resumes on
 * a promise that answered after the bound. The timer is cleared as soon as `work` settles.
 */
function bounded<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FluentAuthError("link_failed", message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The check, not dead code: `core/linkX` maps Privy's link failures by their exact
 * `PrivyErrorCode` values and holds them as string literals, because it is the core and
 * because 2.25.0 declares that enum in its types without exporting it at runtime — importing
 * it for a value breaks every bundler. `Exactly` makes the two sets each other's subset, so a
 * Privy release that renames one of these values fails this build rather than quietly turning
 * a refusal the integrator can act on into `link_failed`.
 */
type MappedPrivyLinkXCode =
  | `${PrivyErrorCode.OAUTH_USER_DENIED}`
  | `${PrivyErrorCode.USER_EXITED_LINK_FLOW}`
  | `${PrivyErrorCode.LINKED_TO_ANOTHER_USER}`;
type Extends<A extends B, B> = A;
/** Each set a subset of the other, which is to say: the same set. */
type EveryPrivyCodeIsMapped = Extends<MappedPrivyLinkXCode, FluentLinkXPrivyErrorCode>;
type EveryMappedCodeIsPrivys = Extends<FluentLinkXPrivyErrorCode, MappedPrivyLinkXCode>;

/**
 * What the return gate settles with: the link is on the restored user, Privy refused it, or the
 * page turned out to belong to somebody else and the hop it was waiting for is not theirs.
 */
type LinkXReturnSignal =
  | { status: "linked" }
  | { status: "error"; error: FluentAuthError }
  | { status: "discarded" };

/** Where the gate stands for one subject's return, read off the latest render. */
type LinkXReturnState = "waiting" | "ready" | "foreign";

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
  // Held here rather than in the wallet menu card, which the drawer unmounts
  // every time a transaction review opens — taking any panel a send had chosen
  // with it, so the settled transfer came back to the token list.
  const [walletMenuPanel, setWalletMenuPanel] = useState("tokens");
  /** Bump to refetch the widget's on-chain balances after a confirmed tx. */
  const refreshBalances = useCallback(() => setBalanceRevisionCounter((value) => value + 1), []);
  const [connectOpen, setConnectOpen] = useState(() => directAuth && hasPendingInlineOAuth());
  const connectedWalletAddress = activeWallet?.connected ? activeWallet.address : undefined;
  /** Whether the connector has handed over the client that signs for the address it reports. */
  const walletClientReady = Boolean(
    activeWallet?.address &&
      activeWallet.walletClient?.account?.address?.toLowerCase() === activeWallet.address.toLowerCase(),
  );
  /** Whether the Privy user holds the connected wallet among their linked accounts. */
  const privyOwnsConnectedWallet = privyUserOwnsWallet(user, connectedWalletAddress);
  /**
   * Whether the Privy session on this page is an external wallet's — the kind `linkX()` makes
   * through SIWE — rather than a Fluent ID's: the user holds an external Ethereum wallet among
   * its linked accounts (`privyUserHasExternalWallet`: the one way this SDK puts one there is
   * SIWE) and no Fluent session names them.
   *
   * Such a session is not a Fluent ID, and nothing on it is a signer this widget uses. It must
   * not run the direct-auth exchange, and an embedded wallet Privy might attach to it must not
   * become the smart account's signer — either would replace the wallet as the connected account
   * with a Fluent session this person never asked for. That holds whichever wallet the connector
   * reports now, and whether it reports one at all: the session of a wallet the user has since
   * switched away from is *mismatched* for `linkX()`, which logs it out and signs the connected
   * wallet in (`requestLinkX`), and until then it is still a wallet's session, not a Fluent ID
   * in waiting; and a wallet the connector has dropped leaves the session it made exactly as
   * much a wallet's. Reading ownership of the connected wallet here would turn both into a Fluent
   * ID the moment the addresses stop matching. Ownership is the return gate's question
   * (`privyOwnsConnectedWallet`), not this one.
   *
   * Read from the restored user and the stored session, never from anything in memory: the
   * return from X is a page load, and the guard has to hold on it as on the page that started
   * the hop.
   *
   * The Fluent session is the second half of the test because holding an external wallet alone
   * does not make a session SIWE's. A Fluent ID may hold a wallet among its linked accounts too,
   * and a Fluent session naming the Privy user is the widget's own record that this person
   * signed in as that Fluent ID — the session SIWE never creates. Such a page keeps its smart
   * account, its signer and its direct auth exactly as before this guard existed.
   *
   * The assumption this rests on, stated once: **this SDK is the only way an external wallet
   * lands on a Privy user of this Privy app.** Its login modal offers X, Google, email and a
   * passkey and never a wallet, nothing here calls Privy's `linkWallet` or `linkWithSiwe`, and
   * Privy sessions are per origin, so a wallet linked to the same user on another site cannot
   * arrive here. Should that change — a wallet login method added to the modal, a portal that
   * links wallets to Fluent IDs on this origin — a Fluent ID holding a linked wallet, on a page
   * with no stored Fluent session (a fresh browser, a cleared storage), would read as a wallet's
   * session: no direct-auth exchange, no smart account, no Fluent session, until the person
   * signs in again. The guard would then need a positive mark of SIWE's own — which Privy does
   * not record for a headless login — or the stored session would have to carry one.
   *
   * The restored user's shape covers every session SIWE made *and verified*. It cannot cover
   * the one SIWE is making right now, nor one it made for a user who turns out not to own the
   * connected wallet: Privy publishes the user it signed in before `loginWithSiwe` resolves,
   * and a user without the wallet holds no external wallet entry to be read — `linkX()` logs
   * them out before it answers (`signWalletInWithSiwe`), but between Privy's commit of that
   * user and the signed-out commit, an embedded wallet on them would read as a Fluent ID login.
   * So the page also remembers the logins `linkX()` itself ran (`linkXSiweLogins`): a login in
   * flight, and every user it signed in, is a wallet's session here too. In memory on purpose —
   * the window is inside one call on one page — and emptied once Privy has signed everybody
   * out: on the commit on which Privy reports nobody (the `privySignedOut` effect below), and
   * when a logout `linkX()` asked for resolves (`logoutPrivyForLinkX`), since between a login
   * Privy answers at once and the logout that follows it React may commit no render at all. A
   * user Privy has signed out is nobody's SIWE login any more, and the same person signing in
   * later the ordinary way, with the Google account and embedded wallet a rejected SIWE user may
   * well hold, is a Fluent ID login and gets its session as before. A logout the bound ran out
   * on clears nothing, and leaves that user here until the page goes.
   */
  const fluentSessionNamesPrivyUser = user?.id !== undefined && session?.user?.id === user.id;
  const linkXSiweLogins = useRef({ pending: false, userIds: new Set<string>() });
  const siweSignedInOnThisPage =
    linkXSiweLogins.current.pending ||
    (user?.id !== undefined && linkXSiweLogins.current.userIds.has(user.id));
  const walletUserPrivySession =
    (privyUserHasExternalWallet(user) || siweSignedInOnThisPage) && !fluentSessionNamesPrivyUser;
  // What `startDirectFluentLogin` reads off the latest render, written during render like
  // `linkXInputs` below and for the same reason: the call may follow a logout whose commit is
  // still pending. `logoutPrivyForLinkXRef` is filled in beside `logoutPrivyForLinkX`, which is
  // defined with the link-X adapter further down — the `endAuthSessionRef` arrangement.
  const privySessionNow = useRef({ authenticated, walletUserPrivySession });
  privySessionNow.current = { authenticated, walletUserPrivySession };
  const logoutPrivyForLinkXRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // The embedded wallets as the account model and the ZeroDev initializer may count them: none
  // on a wallet user's session, whatever Privy attached to it.
  const embeddedWalletCount = walletUserPrivySession ? 0 : smartAccount.embeddedWalletCount;
  const derivedAccount = useWidgetAccount({
    smartAccount: {
      smartAccountReady: smartAccount.smartAccountReady,
      smartAccountAddress: smartAccount.smartAccountAddress,
      signerAddress: smartAccount.signerAddress,
      error: smartAccount.error,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount,
    },
    wallet: activeWallet
      ? {
          connected: activeWallet.connected,
          address: activeWallet.address,
          hasWalletClient: walletClientReady,
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
    // The same count the account model reads: a wallet's own Privy session initializes nothing.
    smartAccount: { ...smartAccount, embeddedWalletCount },
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

  // Sub-pages (Settings, Deposit, Bridge) ride on the same
  // value as the real tabs, so remember the tab they were opened from — that is
  // where Back leaves the stack, and where closing the drawer mid-stack returns
  // to.
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
    // A wallet user's Privy session, made by `linkX()` through SIWE: not a Fluent ID, and not to
    // be turned into one — not for the wallet it owns, not for another wallet the connector
    // reports now, and not once the connector reports none. See `walletUserPrivySession`.
    if (walletUserPrivySession) return;
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
    walletUserPrivySession,
  ]);

  useEffect(() => {
    // The callback above owns the decision; duplicating it here would let the two
    // conditions drift.
    if (!directAuth) return;
    if (disconnectingRef.current) return;
    if (!privyReady || !authenticated) return;
    if (embeddedWalletCount === 0) return;
    completeDirectAuthorization();
  }, [
    authenticated,
    completeDirectAuthorization,
    directAuth,
    embeddedWalletCount,
    identityToken,
    privyReady,
    session,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  // After remount (recent-login cleared), open Privy with X as the primary CTA.
  useEffect(() => {
    if (!pendingPrivyLoginRef.current || !privyReady || authenticated) return;
    pendingPrivyLoginRef.current = false;
    login();
  }, [authenticated, login, pendingPrivyLoginRef, privyReady]);

  /**
   * The Fluent ID sign-in, as the connect modal's Fluent methods, the account menu's re-login
   * (`handleConnectWithX`) and the bridge screen start it.
   *
   * Read off the latest render through `privySessionNow`, not captured: `handleConnectWithX`
   * calls this right after a Privy logout it awaited, whose commit may or may not have happened
   * yet, and the answer has to follow Privy's state, not the render the click landed on.
   *
   * A live Privy session is a Fluent ID's to complete — unless it is a wallet user's, made by
   * `linkX()` through SIWE (`walletUserPrivySession`), which `completeDirectAuthorization`
   * refuses to turn into a Fluent ID. That session is not what the person is asking for now. It
   * is signed out first, through the same bounded helper the mismatch path of `linkX()` uses
   * (`logoutPrivyForLinkX`, reached through its ref: it is defined with the link-X adapter
   * below), and the modal opens on the commit that reports nobody; the wallet is not
   * disconnected, and its Fluent session is untouched. Without this branch the refusal was a
   * dead end: the status said "Opening Fluent Connect ID", the armed intent survived reloads,
   * and no modal opened.
   *
   * The intent is armed only once there is a modal for it to belong to. A logout that does not
   * complete within the bound leaves no intent behind — nothing would consume it — and reports
   * the failure where the modal and the debug panel show it.
   *
   * The promise is the modal's gate. The modal is open on its methods before any is chosen,
   * and the real one calls `onFluentLogin` and then its method at once — `initOAuth` leaves the
   * page — so opening the modal after the logout gates nothing there. What does is the modal
   * awaiting this, and running no method on the still-signed-in session; so a logout that did
   * not complete rejects, after it has been reported here, and the modal shows the rejection as
   * its error and runs nothing. Resolving is after the signed-out commit, with the intent armed:
   * the OAuth that follows leaves the page with the intent in place for the return.
   */
  const startDirectFluentLogin = useCallback(async (): Promise<void> => {
    setHostedError(null);
    const live = privySessionNow.current;
    if (live.authenticated && !live.walletUserPrivySession) {
      setWalletStatus("Opening Fluent Connect ID");
      setDirectAuthRequested(true);
      completeDirectAuthorization();
      return;
    }
    if (live.walletUserPrivySession) {
      setWalletStatus("Signing the wallet's Privy session out");
      try {
        await logoutPrivyForLinkXRef.current();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Privy did not sign the previous session out.";
        debugWarn("[fluent widget] could not sign the wallet's Privy session out", error);
        setDirectAuthRequested(false);
        setHostedError(message);
        setWalletStatus(message);
        throw error instanceof Error ? error : new Error(message);
      }
    }
    setWalletStatus("Opening Fluent Connect ID");
    setDirectAuthRequested(true);
    setConnectOpen(true);
  }, [completeDirectAuthorization, setDirectAuthRequested]);

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
      // A failure is reported inside, in the status and `hostedError`; no modal is open yet to
      // hand it to.
      void startDirectFluentLogin().catch(() => undefined);
      return;
    }
    openConnectFlow();
  }, [directAuth, handleDisconnect, openConnectFlow, startDirectFluentLogin]);
  // The bridge page's way in for someone who only has an External wallet: no
  // teardown, since that wallet is the one funding the deposit.
  const signInWithFluent = useCallback(() => {
    if (directAuth) {
      void startDirectFluentLogin().catch(() => undefined);
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
    defaultSponsorship: resolvedConfig.gasPayment.sponsorship,
    authMode: resolvedConfig.authMode,
    confirmSignature,
    refreshBalances,
    track,
  });

  // Transfers the widget has sent and is still waiting on. Held above the
  // drawer so a review closing it cannot take them with it.
  const [pendingTransfers, setPendingTransfers] = useState<readonly FluentPendingTransfer[]>([]);
  const pendingTransferCount = useRef(0);
  const beginTransfer = useCallback(
    (transfer: Omit<FluentPendingTransfer, "id">) => {
      const id = `pending-${(pendingTransferCount.current += 1)}`;
      setPendingTransfers((list) => [...list, { ...transfer, id }]);
      // The panel only. Leaving the Send page is deliberately not done here:
      // the review can still be refused, and the form behind it is holding the
      // address and amount the user typed.
      setWalletMenuPanel("activity");
      return id;
    },
    [],
  );
  const endTransfer = useCallback((id: string) => {
    setPendingTransfers((list) => list.filter((transfer) => transfer.id !== id));
  }, []);
  const settleTransfer = useCallback(
    (id: string, hash: Hash) => {
      setPendingTransfers((list) =>
        list.map((transfer) => (transfer.id === id ? { ...transfer, hash } : transfer)),
      );
      // The list drops it as soon as the history lists the hash. This is the
      // backstop for the history that never does — an indexer outage, a reorg —
      // so a settled transfer cannot leave a row spinning for the whole session.
      setTimeout(() => endTransfer(id), SETTLED_TRANSFER_GRACE_MS);
    },
    [endTransfer],
  );

  const sendToken = useTokenTransfer({
    widget: widgetApi,
    track,
    beginTransfer,
    settleTransfer,
    endTransfer,
  });
  const gasContext = useMemo(
    () =>
      resolveFluentTransferGasContext({
        fluentAccountAddress,
        walletConnected,
        sponsorshipUrl: resolvedConfig.sponsorshipUrl,
        appId: resolvedConfig.appId,
      }),
    [fluentAccountAddress, walletConnected, resolvedConfig.appId, resolvedConfig.sponsorshipUrl],
  );

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

  // ── Linking X ──────────────────────────────────────────────────────────────────────────
  // The adapter half of `linkX()`: the Privy hooks and the return gate. The action itself is
  // `requestLinkX` in `core/linkX`, which calls no hook and is handed everything below.

  /**
   * The identity token as the last commit published it, plus whoever is waiting for the next
   * one. `refreshUser()` is `updateUserAndIdToken()`: it sets Privy's identity-token store
   * synchronously before it resolves, so by the time the await returns the new token exists —
   * but `useIdentityToken()` is a render snapshot, and this is how the value reaches a caller
   * that is not a component.
   */
  const identityTokenRef = useRef(identityToken);
  const identityTokenWaiters = useRef<Array<(token: string | null) => void>>([]);
  useEffect(() => {
    identityTokenRef.current = identityToken;
    const waiters = identityTokenWaiters.current;
    if (waiters.length === 0) return;
    identityTokenWaiters.current = [];
    for (const resolve of waiters) resolve(identityToken);
  }, [identityToken]);

  /**
   * A fresh identity token, for the POST that completes a link. Refuses rather than hangs: a
   * Privy that accepts the refresh and never publishes the token is a `link_failed`, not a
   * promise the integrator waits on forever.
   *
   * `localStorage["privy:id_token"]` and the `privy-id-token` cookie are deliberately not read.
   * Privy writes both, and neither is a contract this SDK may hold Privy to.
   */
  const refreshIdentityToken = useCallback(async (): Promise<string | null> => {
    const before = identityTokenRef.current;
    await refreshUser();
    // The commit may already have happened inside the await — React can flush the store's
    // notification before `refreshUser` resolves — in which case there is nothing to wait for.
    if (identityTokenRef.current !== before) return identityTokenRef.current;
    return new Promise<string | null>((resolve, reject) => {
      const waiter = (token: string | null) => {
        clearTimeout(timer);
        resolve(token);
      };
      const timer = setTimeout(() => {
        identityTokenWaiters.current = identityTokenWaiters.current.filter(
          (pending) => pending !== waiter,
        );
        reject(
          new FluentAuthError(
            "link_failed",
            "Privy did not publish a fresh identity token after the link.",
          ),
        );
      }, LINK_X_IDENTITY_TOKEN_TIMEOUT_MS);
      identityTokenWaiters.current = [...identityTokenWaiters.current, waiter];
    });
  }, [refreshUser]);

  /**
   * Whether the signed-in Privy user has an X account.
   *
   * This is the completion signal of a redirected link — `useLinkAccount`'s `onSuccess` is not,
   * and is deliberately not passed below. In 2.25.0 the link intent that callback fires from is
   * a `useRef`, so the page reload the OAuth hop performs destroys it: after a *redirected*
   * link `onSuccess` never fires at all. What survives the reload is the user Privy restores,
   * and `user.linkedAccounts` gaining a `twitter_oauth` entry is the fact the gate waits for.
   */
  const privyHasLinkedX = privyUserHasLinkedX(user?.linkedAccounts);

  /** The one re-entry waiting for its return, if any. One `linkX()` per user is assumed. */
  const linkXReturnWaiter = useRef<{
    subject: string;
    settle: (signal: LinkXReturnSignal) => void;
  } | null>(null);
  const settleLinkXReturn = useCallback((signal: LinkXReturnSignal) => {
    const waiting = linkXReturnWaiter.current;
    if (!waiting) return false;
    linkXReturnWaiter.current = null;
    waiting.settle(signal);
    return true;
  }, []);

  // Signal (b): Privy refused the link. `onError` only — see `privyHasLinkedX` for why there
  // is no `onSuccess` here.
  const { linkTwitter } = useLinkAccount({
    onError: (code) => {
      const error = toLinkXPrivyError(code);
      debugWarn("[fluent widget] linking X failed", { code, fluentCode: error.code });
      // With nobody waiting, the hop failed before the page ever left — the probe in
      // `requestLinkX` makes `cannot_link_more_of_type` unreachable, but a Privy that cannot
      // reach its own API is not. The marker goes either way: there is no return coming.
      if (!settleLinkXReturn({ status: "error", error })) {
        clearLinkXMarker(resolveSessionStorage());
      }
    },
  });

  /**
   * The connected external wallet as the core signs it in: its address as the connector spells
   * it, the widget's chain, and `personal_sign` through its client. `null` until the connector
   * has handed the client over, which is after it has named the address.
   */
  const connectedWalletClient = activeWallet?.walletClient;
  const linkXWallet: LinkXWalletInput | null =
    connectedWalletAddress && walletClientReady && connectedWalletClient
      ? {
          address: connectedWalletAddress,
          chainId: chain.id,
          signMessage: (message) =>
            bounded(
              connectedWalletClient.signMessage({
                account: connectedWalletAddress as `0x${string}`,
                message,
              }),
              LINK_X_WALLET_SIGNATURE_TIMEOUT_MS,
              walletSignatureTimedOut(),
            ),
        }
      : null;

  /**
   * Whoever is waiting for the commit on which Privy reports nobody signed in. The mirror of
   * `identityTokenWaiters`: `logout()` resolves once Privy's own state has moved on, and the
   * render that publishes it is what a caller outside React has to be told about.
   */
  const privySignedOut = !authenticated && user === null;
  const privySignedOutWaiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (!privySignedOut) return;
    // Every user `linkX()` signed in on this page is signed out now; none is a wallet's session
    // any longer, whoever signs in next. A login still in flight keeps its own flag.
    linkXSiweLogins.current.userIds.clear();
    const waiters = privySignedOutWaiters.current;
    if (waiters.length === 0) return;
    privySignedOutWaiters.current = [];
    for (const resolve of waiters) resolve();
  }, [privySignedOut]);

  /**
   * Privy's `logout()`, awaited to the signed-out commit, for a `linkX()` that met a Privy
   * session belonging to another wallet, or signed in a user that turned out not to own the
   * connected one. Refuses rather than hangs, like the identity-token refresh, and the bound
   * covers the whole of it: it starts before Privy is asked, because Privy's `logout()` itself
   * awaits its own calls before it publishes anything, and a logout that never resolves is as
   * much a logout that did not complete as a commit that never comes. Once the bound has run
   * out the call has its answer, and a logout completing late changes nothing: no waiter is
   * registered for it, and nothing continues into SIWE on its account. Read through
   * `linkXInputs` at call time, like everything the core is handed.
   *
   * Only Privy is logged out. The wallet connector is not touched — Privy's logout reaches no
   * connector — and the wallet's Fluent session is neither ended nor re-keyed: it is derived
   * from the address, and nothing here calls `endAuthSession`, `setSession` or `disconnect`.
   *
   * Resolving is also when the users `linkX()` signed in on this page stop being remembered
   * (`linkXSiweLogins`), not only the signed-out commit: a logout Privy has confirmed leaves
   * nobody signed in, whether or not React committed a render of the user in between — and
   * between a login Privy answers at once and the logout that follows it, it may not have. A
   * logout the bound ran out on, or one Privy refused, clears nothing.
   */
  const logoutPrivyForLinkX = useCallback((): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let waiter: (() => void) | null = null;
      const settle = (answer: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        privySignedOutWaiters.current = privySignedOutWaiters.current.filter(
          (pending) => pending !== waiter,
        );
        answer();
      };
      const signedOut = () => {
        linkXSiweLogins.current.userIds.clear();
        resolve();
      };
      timer = setTimeout(() => {
        settle(() =>
          reject(new FluentAuthError("link_failed", "Privy did not sign the previous session out.")),
        );
      }, LINK_X_IDENTITY_TOKEN_TIMEOUT_MS);
      linkXInputs.current.logout().then(
        () => {
          if (settled) return;
          // The commit may already have happened inside the await, in which case there is
          // nothing to wait for.
          if (linkXInputs.current.privySignedOut) {
            settle(signedOut);
            return;
          }
          waiter = () => settle(signedOut);
          privySignedOutWaiters.current = [...privySignedOutWaiters.current, waiter];
        },
        (err: unknown) => settle(() => reject(err)),
      );
    });
  }, []);

  // Kept current for `startDirectFluentLogin`, which is defined above this line.
  useEffect(() => {
    logoutPrivyForLinkXRef.current = logoutPrivyForLinkX;
  }, [logoutPrivyForLinkX]);

  /**
   * Everything `linkX()` hands the core, and the gate's own conditions, as of the latest
   * render — read when the core is called rather than captured when `linkX()` was.
   *
   * This is not a convenience. A re-entry is started *before* Privy has restored anything,
   * which is the whole reason the gate exists: a closure taken at that moment carries no Privy
   * user, an account kind of `undefined` and the pre-link identity token, and would refuse the
   * very call it was waiting to make. Written during render, like `connectedPresentation.current`
   * above and for the same reason. The SIWE functions are read the same way, from `linkXSiwe`.
   */
  const linkXInputs = useRef({
    accountKind: undefined as FluentAccountType | undefined,
    privyUserId: undefined as string | undefined,
    privyUser: null as FluentLinkXPrivyUser | null,
    sessionUserId: undefined as string | undefined,
    privyReady: false,
    authenticated: false,
    privySignedOut: true,
    privyOwnsWallet: false,
    hasLinkedX: false,
    hasWalletClient: false,
    wallet: null as LinkXWalletInput | null,
    identityToken: null as string | null,
    getAuthToken,
    getAccessToken,
    getIdentityToken: refreshIdentityToken,
    linkTwitter,
    logout,
  });
  linkXInputs.current = {
    accountKind: widgetAccount.type,
    privyUserId: user?.id,
    privyUser: authenticated && user ? user : null,
    sessionUserId: session?.user?.id,
    privyReady,
    authenticated,
    privySignedOut,
    privyOwnsWallet: privyOwnsConnectedWallet,
    hasLinkedX: privyHasLinkedX,
    hasWalletClient: walletClientReady,
    wallet: linkXWallet,
    identityToken,
    getAuthToken,
    getAccessToken,
    getIdentityToken: refreshIdentityToken,
    linkTwitter,
    logout,
  };

  /**
   * Privy's headless SIWE, as of the latest render of the page that may need it — an external
   * wallet connected and no Fluent session — and `null` on every other page. Written by
   * `LinkXSiweSource` below, which is mounted on exactly that page, during its render.
   *
   * Read at call time, never captured when `linkX()` started: in 2.25.0 `loginWithSiwe` throws
   * `User already authenticated` from the `user` of the render that created it, and
   * `generateSiweMessage` reads that render's `authenticated` to tell a login from a link, so
   * the ones a `linkX()` captured before logging a mismatched session out would keep refusing
   * after it.
   *
   * A page holding a Fluent session has no source, and a `linkX()` that reaches for one there is
   * refused: that page is a Fluent ID's, whether Privy has restored them yet or not, and signing
   * the wallet beside them in to Privy would put a second user under the Fluent ID's own session.
   */
  const linkXSiwe = useRef<LinkXSiweSourceFunctions | null>(null);
  const linkXSiweOrRefuse = (): LinkXSiweSourceFunctions => {
    const source = linkXSiwe.current;
    if (source) return source;
    throw new FluentAuthError(
      "link_failed",
      "A Fluent ID is signed in on this page. Linking X for the connected external wallet would sign it out; disconnect the Fluent ID first, or link X as the Fluent ID.",
    );
  };

  /**
   * Where the page stands on finishing a hop `subject` started.
   *
   * `ready`: signed in as that subject, with an X account on the Privy user, and the account
   * the core needs back. For a Fluent ID that is the smart account: a reload restores the Privy
   * session in a tick and the smart account in seconds, and a re-entry that ran in between would
   * refuse itself with `not_authenticated` for an account merely still arriving. For an
   * external wallet it is the wallet's client — the thing that signs the Fluent token's
   * exchange, which the connector hands over after it has named the address — and the Privy
   * session being the wallet's own (`privyOwnsWallet`).
   *
   * `foreign`: nobody on this page is going to finish the hop, and only its own subject may.
   * Privy has restored somebody else: the marker is another person's, left in a browser they
   * share. Or Privy has restored the subject, but the wallet connected now is not the one that
   * wallet-user's session owns: the user switched wallets across the redirect, and the link the
   * marker records is the other wallet's. Or, for a wallet page, Privy has restored nobody at all:
   * a wallet user's Privy session is the one SIWE made, and with it gone the subject cannot come
   * back except through a new SIWE, which a fresh `linkX()` will run once the marker is out of
   * its way. Privy's restored user is the authority on who is here; the Fluent session is
   * derived from it and re-issued when the two disagree, so a session that still names somebody
   * else is a page catching up, not a verdict.
   *
   * `waiting`: anything else — Privy still restoring, or restored as the subject with the Fluent
   * ID, the wallet's client or the X account still to come. A Fluent ID whose smart account is
   * still arriving reads as `eoa` while an external wallet is connected beside it; its session
   * names the subject, and it waits for the smart account like any Fluent ID. Nothing is read from
   * the marker's age: a Fluent ID's signed-out page keeps its marker for the subject to come back
   * to.
   */
  const linkXReturnState = (subject: string): LinkXReturnState => {
    const live = linkXInputs.current;
    const privyRestored = live.authenticated && live.privyUserId !== undefined;
    if (privyRestored && live.privyUserId !== subject) return "foreign";
    const fluentIdPage = live.sessionUserId !== undefined;
    if (!privyRestored) {
      // The wallet page Privy restored nobody on. `privyReady` is Privy's word that the restore
      // is over, not merely not started.
      if (live.privyReady && !fluentIdPage && live.accountKind === "eoa") return "foreign";
      return "waiting";
    }
    if (live.accountKind === "smart") {
      return live.sessionUserId === subject && live.hasLinkedX ? "ready" : "waiting";
    }
    if (live.accountKind === "eoa" && !fluentIdPage) {
      // Ownership is decided before anything is waited for: a wallet the restored session does
      // not own is not going to be owned by it later, and the X account or the client it would
      // wait for are the other wallet's to finish with.
      if (!live.privyOwnsWallet) return "foreign";
      return live.hasLinkedX && live.hasWalletClient ? "ready" : "waiting";
    }
    return "waiting";
  };

  const settleLinkXReturnFor = (subject: string): boolean => {
    switch (linkXReturnState(subject)) {
      case "ready":
        return settleLinkXReturn({ status: "linked" });
      case "foreign":
        return settleLinkXReturn({ status: "discarded" });
      case "waiting":
        return false;
    }
  };

  // Signal (a) of the gate, driven by what Privy restored rather than by a poll — and the
  // discard, which the same restore decides.
  useEffect(() => {
    const waiting = linkXReturnWaiter.current;
    if (!waiting) return;
    settleLinkXReturnFor(waiting.subject);
    // `linkXReturnState` reads the render-written ref above, so the deps are the values that
    // ref carries, not the function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authenticated,
    privyHasLinkedX,
    privyOwnsConnectedWallet,
    privyReady,
    session,
    settleLinkXReturn,
    user?.id,
    walletClientReady,
    widgetAccount.type,
  ]);

  /**
   * Wait for the return of a hop this subject started. Settles on the first of the signals and
   * on nothing else: before one of them lands, no core call, no POST, no token refresh and no
   * second `linkTwitter()` happen.
   */
  const awaitLinkXReturn = useCallback(
    (subject: string) =>
      new Promise<LinkXReturnSignal>((settle) => {
        // The verdict may already be in: a reload lands with everything restored and the
        // effect above ran before anything called `linkX()`, or the page is plainly somebody
        // else's. Registered first so the one settle path serves both.
        linkXReturnWaiter.current = { subject, settle };
        settleLinkXReturnFor(subject);
      }),
    // Same reason as the effect: the conditions are read from the ref, not captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * `linkX()` for the render context. Idempotent and re-enterable: see `requestLinkX`.
   *
   * The return gate is the one piece of this action that cannot live in the core, because it is
   * driven by the restored Privy user and by Privy's own callback rather than by anything a
   * caller could hand in. Both ways in go through it — `useLinkX()` on mount, and an integrator
   * calling `linkX()` on the render context itself.
   */
  const linkX = useCallback(async (): Promise<FluentLinkXResult> => {
    // Before the marker, the Privy hooks and the network, for the same reason `getAuthToken`
    // refuses first: a hosted-mode Fluent ID has no Privy session in this page at all.
    if (resolvedConfig.authMode !== "direct") {
      throw new FluentAuthError(
        "hosted_not_supported",
        'linkX() needs authMode: "direct" — in hosted mode the user\'s Privy session lives on the authorize page, not in this page.',
      );
    }
    const storage = resolveSessionStorage();
    const stored = readLinkXMarker(storage);
    if (stored.kind === "invalid") {
      // Something was in the tab and it was not a link. Already removed by the reader; the
      // call stops here, having done nothing, rather than read a leftover as a fresh ask.
      debugWarn("[fluent widget] dropped a stored value that is not a link-X marker");
      throw linkXIntentDiscardedError();
    }
    if (stored.kind === "marker") {
      const signal = await awaitLinkXReturn(stored.marker.subject);
      // Cleared on every signal, before any work: the hop this marker recorded is over, and a
      // reload must not resume it a second time.
      clearLinkXMarker(storage);
      if (signal.status === "error") throw signal.error;
      if (signal.status === "discarded") {
        // Another person's half-finished hop, in a browser they share. Dropped rather than
        // resumed — only the subject that started one may finish it — and dropped rather than
        // carried on as a fresh ask: this call did no work, and says so.
        debugWarn("[fluent widget] dropped a link-X marker of another subject");
        throw linkXIntentDiscardedError();
      }
    }
    const live = linkXInputs.current;
    return requestLinkX({
      authMode: resolvedConfig.authMode,
      accountKind: live.accountKind,
      subject: live.privyUserId,
      wallet: live.wallet,
      siwe: {
        session: live.privyUser,
        fluentSessionUserId: live.sessionUserId,
        logout: logoutPrivyForLinkX,
        // Thunks on purpose: Privy's functions of the render that is current when each is
        // called, not of the one this `linkX()` started on. See `linkXSiwe`.
        // Each Privy step bounded (`LINK_X_SIWE_STEP_TIMEOUT_MS`): one that never answers is a
        // `link_failed` naming the likely cause, not a promise the integrator holds forever.
        generateSiweMessage: (input) =>
          bounded(
            linkXSiweOrRefuse().generateSiweMessage(input),
            LINK_X_SIWE_STEP_TIMEOUT_MS,
            siweStepTimedOut("generate the sign-in message"),
          ),
        // Marked in flight before Privy is asked, and the user it signed in remembered, so
        // the renders Privy makes of that user read as a wallet's session, never a Fluent ID's.
        // See `walletUserPrivySession`. Both follow Privy's own answer, not the bound: a login
        // Privy completes after the bound ran out still signs somebody in on this page, and
        // that somebody is a wallet's session here as much as one signed in on time. Until
        // Privy answers, the flag stays up.
        loginWithSiwe: (input) => {
          const logins = linkXSiweLogins.current;
          logins.pending = true;
          let login: Promise<FluentLinkXPrivyUser>;
          try {
            login = linkXSiweOrRefuse().loginWithSiwe(input);
          } catch (err) {
            logins.pending = false;
            throw err;
          }
          void login.then(
            (signedIn) => {
              if (typeof signedIn?.id === "string") logins.userIds.add(signedIn.id);
              logins.pending = false;
            },
            () => {
              logins.pending = false;
            },
          );
          return bounded(login, LINK_X_SIWE_STEP_TIMEOUT_MS, siweStepTimedOut("sign the wallet in"));
        },
      },
      publicApiUrl: resolvedConfig.publicApiUrl,
      identityToken: live.identityToken,
      getAuthToken: live.getAuthToken,
      getAccessToken: live.getAccessToken,
      getIdentityToken: live.getIdentityToken,
      linkTwitter: live.linkTwitter,
      storage,
    });
  }, [awaitLinkXReturn, logoutPrivyForLinkX, resolvedConfig.authMode, resolvedConfig.publicApiUrl]);

  // A signed-in Fluent ID whose smart account is on its way back. With an
  // additional external wallet connected, the rebuild that applying Quick sign
  // causes would otherwise derive `type: "eoa"` for its first renders, and the
  // settings subject would flip from the Fluent ID to the wallet and back: each
  // flip applies the defaults, each apply changes the `PrivyProvider` key, and
  // the widget remounts without end. Through this window the settings belong to
  // the Fluent ID, and the subject is held, not renamed.
  //
  // Read from the session, not from Privy: the session hydrates synchronously
  // and lives above the key, while the rebuilt Privy reports no user, no
  // authentication and no wallets for its first ticks.
  const sessionPrivyUserId = directAuth ? session?.user?.id : undefined;
  const fluentIdRebuilding =
    Boolean(sessionPrivyUserId) &&
    smartAccount.smartAccountEnabled &&
    !derivedAccount.fluentAccountReady &&
    !smartAccount.error;
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
    accountType: fluentIdRebuilding ? undefined : widgetAccount.type,
    defaultGasToken: resolvedConfig.gasPayment.defaultToken,
    // The session names the same person through the ticks on which the rebuilt
    // Privy cannot yet, so the held subject stays a known one.
    privyUserId: user?.id ?? sessionPrivyUserId,
    identityToken,
    walletAddress: activeWallet?.address,
    hasWalletClient: Boolean(activeWallet?.walletClient),
    // `connecting` and `restoring` are exactly the windows in which the account
    // is on its way in: the rebuild that applying Quick sign causes reports
    // `connecting` until the smart account is ready again. Read from the raw
    // derivation, not from what the widget shows: the presentation is held at
    // `connected` through precisely this window, which is the opposite of what
    // the controller has to be told.
    settling:
      fluentIdRebuilding ||
      derivedAccount.status === "connecting" ||
      derivedAccount.status === "restoring",
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
      linkX,
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
      linkX,
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
    <FluentTopLayerBridge />
    {!session && connectedWalletAddress !== undefined ? <LinkXSiweSource source={linkXSiwe} /> : null}
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
            externalWalletAddress={activeWallet?.connected ? activeWallet.address : undefined}
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
            panel={walletMenuPanel}
            onPanelChange={setWalletMenuPanel}
            onSendToken={sendToken}
            pendingTransfers={pendingTransfers}
            onRevealAccount={() => setAccountOpen(true)}
            gasContext={gasContext}
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
          // Returned, not dropped: the modal runs the chosen method once this has resolved,
          // and not at all once it has rejected. See `startDirectFluentLogin`.
          if (directAuth) return startDirectFluentLogin();
          setWalletStatus("Opening hosted Fluent Connect ID");
          return undefined;
        }}
      />
      <BatchOperationReviewModal
        operation={batchReview}
        // Opening this review closed the drawer. For the widget's own Send that
        // has to be undone once the user confirms, or the pending row they were
        // just sent to would be behind a closed drawer for the whole wait.
        // Scoped by operation id on purpose: a host app's batch — a chess move,
        // a vault deposit — must not pop the wallet open behind its own UI.
        onConfirm={() => {
          const wasSend = batchReview?.id === FLUENT_SEND_TOKEN_OP_ID;
          acceptBatchReview();
          if (!wasSend) return;
          // Confirmed, so the form has nothing left to hold: leave it for the
          // list the pending row is already on, and put the drawer back up.
          setWalletMenuTab("home");
          setAccountOpen(true);
        }}
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

/** The two SIWE functions `linkX()` reads, as `useLoginWithSiwe` hands them out. */
type LinkXSiweSourceFunctions = Pick<
  ReturnType<typeof useLoginWithSiwe>,
  "generateSiweMessage" | "loginWithSiwe"
>;

/**
 * The page's source of Privy's headless SIWE: `useLoginWithSiwe`, mounted only on the page a
 * wallet may be signed in on — an external wallet connected and no Fluent session — and handing
 * the functions of its latest render to `FluentWidgetContent` through `source`, during render,
 * for the same reason `linkXInputs` is written then. Nothing is rendered.
 *
 * A component of its own rather than one more hook in `FluentWidgetContent` because the hook is
 * that page's alone: a Fluent ID's page never signs a wallet in, and should not hold the means
 * to. Unmounting clears the source, so a `linkX()` still in flight when a Fluent session arrives
 * is refused rather than handed functions of a page that is gone.
 */
function LinkXSiweSource({
  source,
}: {
  source: MutableRefObject<LinkXSiweSourceFunctions | null>;
}) {
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  source.current = { generateSiweMessage, loginWithSiwe };
  useEffect(
    () => () => {
      source.current = null;
    },
    [source],
  );
  return null;
}
