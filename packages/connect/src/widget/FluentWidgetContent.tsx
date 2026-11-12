import type { PasskeyWithMetadata, PrivyErrorCode } from "@privy-io/react-auth";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useIdentityToken,
  useLinkAccount,
  useLinkWithPasskey,
  useLoginWithSiwe,
  usePrivy,
  useUser,
} from "./privyAdapter";
import type { Hash } from "viem";
import {
  createFluentConnectForWidget,
  FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  getFluentPrivyAppId,
  resolveFluentWidgetConfig,
  toFluentWidgetSession,
  type FluentStoredSession,
  type FluentWidgetConfig,
} from "../core/config";
import type { FluentAnalyticsTrack } from "../core/analytics";
import {
  clearInlineOAuth,
  getPendingInlineOAuth,
  hasPendingInlineOAuth,
} from "../utils/inlineOAuth";
import { InlineConnectModal } from "../components/InlineConnectModal";
import { WalletMenuActionCard } from "../components/WalletMenuActionCard";
import { BridgeScreen } from "../bridge/BridgeScreen";
import type { SentBridgeDeposit } from "../bridge/historyRows";
import {
  DEPOSIT_SWAP_TAB,
  SENT_TRANSFER_TAB,
  isBridgeTab,
  isReviewTab,
  isWalletMenuCardTab,
  REVIEW_TAB,
  WALLET_MENU_SUB_PAGES,
} from "./walletMenuSubPages";
import { Toaster, toast } from "../components/ui/toast";
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
import { TransactionReviewScreen } from "../components/TransactionReviewScreen";
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
import { FLUENT_SWAP_OP_ID } from "../swap/calls";
import { useFluentDepositSwap } from "./hooks/useFluentDepositSwap";
import { useTokenTransfer } from "./hooks/useTokenTransfer";
import { useFluentSendRetry, withFluentInsufficientGasTokenNotice } from "./gasTokenFee";
import { useUsdnrMint } from "./hooks/useUsdnrMint";
import {
  FLUENT_SEND_TOKEN_OP_ID,
  resolveFluentTransferGasContext,
  type FluentPendingTransfer,
} from "./tokenTransfer";
import { useZeroDevInitializer } from "./hooks/useZeroDevInitializer";
import { useExternalWalletAnalytics } from "./hooks/useExternalWalletAnalytics";
import { useConnectStatus } from "./hooks/useConnectStatus";
import { useAccountMenu } from "./hooks/useAccountMenu";
import { useAuthToken, type AuthTokenState } from "./hooks/useAuthToken";
import { useUserSettings, type UserSettingsRef } from "./hooks/useUserSettings";
import { FluentAccountDrawer } from "./components/FluentAccountDrawer";
import { FluentConnectButtonSlot } from "./components/FluentConnectButtonSlot";
import { DebugPanel } from "./components/DebugPanel";
import type { FluentWidgetProps, FluentWidgetRenderContext } from "./FluentWidget";

// In `sessionStorage`, so it survives the OAuth redirect of a Direct login: the widget tells a
// sign-in this tab asked for from a restored session.
const FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY = "fluent:widget:direct-login-intent:v1";

/**
 * Reports whether this tab holds both marks a Fluent ID sign-in started from the connect dialog
 * leaves: the armed intent (`setDirectAuthRequested`) and the inline OAuth marker the dialog
 * writes before `initOAuth` leaves the page. Both are in `sessionStorage`, so they survive the
 * redirect and end with the tab.
 *
 * The pair, because each alone is weaker: the intent is armed by the no-reload methods too and
 * survives a reload that completed no sign-in, and the marker stays for up to ten minutes on a
 * page the person never came back to. The intent counts only at exactly `"1"`, the marker only
 * when `getPendingInlineOAuth()` accepts it.
 */
function directLoginDialogMarksPresent(): boolean {
  try {
    if (window.sessionStorage.getItem(FLUENT_WIDGET_DIRECT_LOGIN_INTENT_KEY) !== "1") return false;
  } catch {
    // Private mode / storage disabled: no mark can be read, so there is no pair.
    return false;
  }
  return getPendingInlineOAuth() !== null;
}

/**
 * What the dialog says when the Fluent ID sign-in it started cannot be completed because a
 * `linkX()` SIWE login holds the page's Privy session. The sign-in has to start again once the
 * link has finished, which is what the dialog's "Try again" does with this shown.
 */
const LINK_X_IN_PROGRESS_REFUSAL =
  "Linking X to your wallet is still in progress. Try again when it finishes.";

/** How long a settled transfer's stand-in row waits for the history to list it. */
const SETTLED_TRANSFER_GRACE_MS = 90_000;
/**
 * How long its details are kept after that. The history may list the operation
 * well before the transfer it carried, and the details are what fill in that
 * bare row in the meantime.
 */
const SETTLED_TRANSFER_RETENTION_MS = 30 * 60_000;

/**
 * How long a `linkX()` waits for Privy to publish the identity token `refreshUser()` has already
 * put in its store, and for the signed-out commit after a `logout()` it asked for. One React
 * commit is all either should take; the bound exists so a Privy that never publishes fails the
 * call instead of leaving the App's promise out forever.
 */
const LINK_X_IDENTITY_TOKEN_TIMEOUT_MS = 10_000;

/**
 * How long each of Privy's two headless SIWE steps, `generateSiweMessage` and `loginWithSiwe`,
 * may take before `linkX()` gives up on it: one Privy round trip, like the identity token. With
 * captcha enabled on the Privy app, both steps wait on a `Captcha` component this SDK mounts only
 * inside the connect dialog, which is closed during `linkX()`, so the wait never ends; the
 * timeout message names that cause.
 */
const LINK_X_SIWE_STEP_TIMEOUT_MS = LINK_X_IDENTITY_TOKEN_TIMEOUT_MS;

/**
 * How long the wallet may take to answer the SIWE signature prompt: minutes, where Privy's steps
 * get seconds, because a person reads, unlocks and confirms. A prompt nobody answers in this
 * time is a `link_failed`, and its message names the same likely causes as Privy's steps.
 */
const LINK_X_WALLET_SIGNATURE_TIMEOUT_MS = 5 * 60_000;

/** What every SIWE-step timeout names as its likely causes: what an App can check. */
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
 * The two waits of the hop itself, each under `LINK_X_IDENTITY_TOKEN_TIMEOUT_MS`: the render
 * that publishes the user SIWE signed in, and Privy's own start of the navigation to X. Neither
 * involves the user or a Privy setting the App could change, so unlike the SIWE steps
 * their messages name no cause.
 */
function privyUserNotPublished(): string {
  return `Privy did not publish the user it signed in within ${LINK_X_IDENTITY_TOKEN_TIMEOUT_MS / 1000} seconds. Nothing was linked.`;
}

function linkXHopTimedOut(): string {
  return `Privy did not start the redirect to X within ${LINK_X_IDENTITY_TOKEN_TIMEOUT_MS / 1000} seconds. Nothing was linked.`;
}

/** Whether what a Privy function returned is a promise to follow. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Settles as `work` does, or rejects with `link_failed` and `message` once `ms` have passed
 * without it settling. A later settlement of `work` is ignored.
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
 * A compile-time check. `core/linkX` holds Privy's link failure codes as string literals,
 * because Privy 2.25.0 declares `PrivyErrorCode` in its types without exporting it at runtime.
 * The two `Extends` aliases below make the sets each other's subset, so a Privy release that
 * renames one of these values fails the build instead of turning that refusal into `link_failed`.
 */
type MappedPrivyLinkXCode =
  | `${PrivyErrorCode.OAUTH_USER_DENIED}`
  | `${PrivyErrorCode.USER_EXITED_LINK_FLOW}`
  | `${PrivyErrorCode.LINKED_TO_ANOTHER_USER}`;
type Extends<A extends B, B> = A;
/** Each set a subset of the other, which is to say: the same set. */
// biome-ignore lint/correctness/noUnusedVariables: a compile-time check, failing the build when a Privy code is not mapped
type EveryPrivyCodeIsMapped = Extends<MappedPrivyLinkXCode, FluentLinkXPrivyErrorCode>;
// biome-ignore lint/correctness/noUnusedVariables: a compile-time check, failing the build when a mapped code is not Privy's
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
  reportAnalyticsSession: (session: FluentStoredSession | null) => void;
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
  /** Created above the keyed `PrivyProvider`, so a Network change does not drop it. */
  authTokenState: MutableRefObject<AuthTokenState>;
  /** Likewise: the User settings controller and its state. */
  userSettingsRef: MutableRefObject<UserSettingsRef>;
  /** Likewise: the last connected presentation. */
  connectedPresentation: MutableRefObject<ConnectedPresentationState>;
  /** The App's query client, read above the widget's own; `undefined` when the App mounted none. */
  appQueryClient?: QueryClient;
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
  debugLogging = false,
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
  authTokenState,
  userSettingsRef,
  connectedPresentation,
  appQueryClient,
}: FluentWidgetContentProps) {
  const internalWallet = useReownWallet();
  const isMobile = useIsMobile();
  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(config), [config]);
  // The sponsorship paymaster authenticates with an Auth token, which `useAuthToken` below mints
  // from `widgetAccount`, which needs this hook. So the ZeroDev hook reads the token source
  // through a ref filled in further down; reordering would change when the kernel initializes.
  const sponsorshipTokenSource = useRef<FluentZeroDevSponsorshipTokenSource | null>(null);
  const readSponsorshipTokenSource = useCallback(() => sponsorshipTokenSource.current, []);
  // Likewise: `handleDisconnect` below ends the Service session through `useAuthToken`, which
  // needs the account derived further down, so the teardown is read through a ref.
  const endAuthSessionRef = useRef<(() => Promise<void>) | null>(null);
  const smartAccount = useFluentZeroDevAccount({
    login: requestPrivyLogin,
    appId: resolvedConfig.appId,
    sponsorshipUrl: resolvedConfig.sponsorshipUrl,
    sponsorshipTokenSource: readSponsorshipTokenSource,
    // Passed on every render, not captured once: the hook reads these settings at the moment a
    // send or a signature needs them, so an App that changes them is obeyed by the next one
    // without the kernel being rebuilt.
    execution: resolvedConfig.execution,
  });
  const {
    authenticated,
    getAccessToken,
    logout,
    ready: privyReady,
    unlinkPasskey,
    user,
  } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const activeWallet = wallet ?? internalWallet;
  const { chain } = useFluentWidgetNetwork();
  /**
   * The connect-sdk handle, built on first use rather than during render: its constructor throws
   * without a browser origin, so building it in render would break a server render. Every caller
   * runs from a user's action, in a browser. Rebuilt when `config` changes identity.
   */
  const fluentConnectRef = useRef<{
    config: FluentWidgetConfig;
    sdk: ReturnType<typeof createFluentConnectForWidget>;
  } | null>(null);
  const getFluentConnect = useCallback(() => {
    if (fluentConnectRef.current?.config !== config) {
      fluentConnectRef.current = { config, sdk: createFluentConnectForWidget(config) };
    }
    return fluentConnectRef.current.sdk;
  }, [config]);
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
  /**
   * Whether this page armed the direct-login intent, as opposed to restoring it from the tab. A
   * passkey or an email code signs in with no reload and leaves no OAuth marker, so this page
   * remembers its own ask. Never seeded from storage; set and cleared with the intent by
   * `setDirectAuthRequested`.
   */
  const dialogAskedOnThisPage = useRef(false);
  // Blocks direct authorization while a disconnect is in flight, so the still-authenticated Privy
  // session cannot recreate the Widget session being ended.
  const disconnectingRef = useRef(false);
  const { session, setSession } = useFluentSession({
    reportAnalyticsSession,
    onSessionChange,
  });
  const {
    status: walletStatus,
    setStatus: setWalletStatus,
    error: loginError,
    setError: setLoginError,
  } = useConnectStatus();
  const [balanceRevisionCounter, setBalanceRevisionCounter] = useState(0);
  // Held here, not in the wallet menu card: the drawer unmounts the card whenever a Review opens,
  // and the panel a Send chose has to outlive that.
  const [walletMenuPanel, setWalletMenuPanel] = useState("tokens");
  /** Refetches the widget's on-chain balances. */
  const refreshBalances = useCallback(() => setBalanceRevisionCounter((value) => value + 1), []);
  const [connectOpen, setConnectOpen] = useState(() => hasPendingInlineOAuth());
  const connectedWalletAddress = activeWallet?.connected ? activeWallet.address : undefined;
  /** Whether the connector has handed over the client that signs for the address it reports. */
  const walletClientReady = Boolean(
    activeWallet?.address &&
      activeWallet.walletClient?.account?.address?.toLowerCase() ===
        activeWallet.address.toLowerCase(),
  );
  /** Whether the Privy user holds the connected wallet among their linked accounts. */
  const privyOwnsConnectedWallet = privyUserOwnsWallet(user, connectedWalletAddress);
  // Whether the stored session names the Privy user: the widget's own record that this person
  // signed in as a Fluent ID, which a SIWE login never writes.
  const fluentSessionNamesPrivyUser = user?.id !== undefined && session?.user?.id === user.id;
  /**
   * The SIWE logins `linkX()` ran on this page: one in flight, and the Privy users they signed in.
   * Privy publishes a user before `loginWithSiwe` resolves, and `linkX()` logs out a user that
   * does not own the connected wallet only afterwards, so until then an embedded wallet on that
   * user would read as a Fluent ID login. In memory, since the window is inside one call. Emptied
   * on the commit on which Privy reports nobody, and when a logout `linkX()` asked for resolves;
   * a logout that timed out empties nothing.
   */
  const linkXSiweLogins = useRef({ pending: false, userIds: new Set<string>() });
  const siweSignedInOnThisPage =
    linkXSiweLogins.current.pending ||
    (user?.id !== undefined && linkXSiweLogins.current.userIds.has(user.id));
  /**
   * The Privy users that answer a Fluent ID sign-in this dialog started: an OAuth sign-in proven
   * by the tab's two marks (`directLoginDialogMarksPresent`), or a no-reload one this page asked
   * for (`dialogAskedOnThisPage`). Remembered for the page, because the dialog clears the inline
   * marker on its connecting screen, before the authorization completes. Emptied wherever
   * `linkXSiweLogins` is.
   */
  const dialogSignInUserIds = useRef(new Set<string>());
  // Written during render: the user is published on the commit after the OAuth return, and that
  // commit's effects complete the authorization. Storage is read only for a Privy user holding an
  // external wallet who is not remembered yet.
  if (
    user?.id !== undefined &&
    !dialogSignInUserIds.current.has(user.id) &&
    privyUserHasExternalWallet(user) &&
    (dialogAskedOnThisPage.current || directLoginDialogMarksPresent())
  )
    dialogSignInUserIds.current.add(user.id);
  /** Whether the Privy session on this page answers a Fluent ID sign-in this dialog started. */
  const dialogSignedInOnThisPage =
    user?.id !== undefined && dialogSignInUserIds.current.has(user.id);
  /**
   * Whether the Privy session on this page is an External wallet's, the kind `linkX()` makes
   * through SIWE, rather than a Fluent ID's. Such a session runs no direct-auth exchange, and no
   * embedded wallet on it becomes the Signer of a smart account.
   *
   * It is a wallet's when the Privy user holds an external wallet (`privyUserHasExternalWallet`)
   * or `linkX()` signed it in here, and the stored session does not name that user. A sign-in
   * this dialog started makes it a Fluent ID's, unless `linkX()` signed it in. Which wallet the
   * connector reports, if any, is not read: a switched or dropped wallet leaves a wallet's session.
   *
   * This rests on one assumption: this SDK is the only way an external wallet lands on a Privy
   * user of this Privy app. Its login offers no wallet method, nothing here calls `linkWallet` or
   * `linkWithSiwe`, and Privy sessions are per origin. Were a wallet linked to a Fluent ID some
   * other way, that Fluent ID would read as a wallet's session on a browser with no stored session.
   */
  const walletUserPrivySession =
    (privyUserHasExternalWallet(user) || siweSignedInOnThisPage) &&
    !fluentSessionNamesPrivyUser &&
    !(dialogSignedInOnThisPage && !siweSignedInOnThisPage);
  /**
   * Why the sign-in the dialog is waiting on cannot be completed on the session this page holds,
   * or `null` when nothing stands in its way. The one case: a `linkX()` SIWE login has the Privy
   * session, and keeps it whatever the dialog's marks say. The dialog shows this instead of
   * "Preparing your account." forever, and its "Try again" starts the sign-in over.
   */
  const directLoginSignInRefusal =
    dialogSignedInOnThisPage && walletUserPrivySession ? LINK_X_IN_PROGRESS_REFUSAL : null;
  // Written during render for `startDirectFluentLogin`, which may run after a logout whose commit
  // is still pending. `logoutPrivyForLinkXRef` is filled in beside `logoutPrivyForLinkX`, which is
  // defined further down.
  const privySessionNow = useRef({ authenticated, walletUserPrivySession });
  privySessionNow.current = { authenticated, walletUserPrivySession };
  const logoutPrivyForLinkXRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // None on a wallet's Privy session, whatever Privy attached to it. The account model also gets
  // `walletUserPrivySession`: Privy reports that session authenticated, which would otherwise
  // read as a Fluent ID sign-in stuck at `connecting` once the connector reports no wallet.
  const embeddedWalletCount = walletUserPrivySession ? 0 : smartAccount.embeddedWalletCount;
  const derivedAccount = useWidgetAccount({
    smartAccount: {
      smartAccountReady: smartAccount.smartAccountReady,
      smartAccountAddress: smartAccount.smartAccountAddress,
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
    sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    walletUserPrivySession,
  });
  const walletConnected = Boolean(activeWallet?.connected);
  // The account as the button, the drawer and the App see it. `presentWidgetAccount` leaves
  // `widgetAccount` and `fluentAccountReady` as derived, and the settings read `derivedAccount`.
  const account = presentWidgetAccount({
    derived: derivedAccount,
    walletConnected,
    rebuilding: connectedPresentation.current.rebuilding,
    sessionUserId: session?.user?.id,
    sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
    failed: Boolean(smartAccount.error),
  });
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
  const { selectedGasPaymentToken, defaultSigningMode } = useGasPaymentSelection({
    gasPaymentToken,
    network: resolvedConfig.network,
    silentSigningEnabled,
  });
  const { resetInitialization } = useZeroDevInitializer({
    // The same count the account model reads: a wallet's own Privy session initializes nothing.
    smartAccount: { ...smartAccount, embeddedWalletCount },
    session,
    widgetAccount,
  });
  useExternalWalletAnalytics({
    analytics: externalWalletAnalytics,
    connected: Boolean(activeWallet?.connected),
    chainId: activeWallet?.chainId,
    track,
  });

  const setDirectAuthRequested = useCallback((pending: boolean) => {
    directAuthRequested.current = pending;
    // Only through this setter: an intent restored from storage is a reloaded page's, and this
    // flag answers for asks this page made.
    dialogAskedOnThisPage.current = pending;
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
      setLoginError(null);
      setConnectOpen(true);
    },
    [setAccountOpen, setLoginError, track],
  );
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  // Apps wire this straight to onClick, so React would pass the click event as
  // the first argument. Swallow it: the trigger must never come from the caller.
  const openConnect = useCallback(() => openConnectFlow(), [openConnectFlow]);
  /**
   * Disconnects the Widget account. With `awaitAuthSession`, the promise also waits for the
   * service to answer the revoke of the Service session, best effort, which lasts as long as
   * the auth work still out, an unanswered wallet dialog included (`endAuthSession`). Re-login
   * needs only the local teardown, and does not wait behind that dialog.
   */
  const handleDisconnect = useCallback(
    async ({ awaitAuthSession }: { awaitAuthSession: boolean }) => {
      // The direct-authorization effect runs on the render setSession(null) causes while Privy is
      // still authenticated (logout is async), and would otherwise recreate the Widget session.
      disconnectingRef.current = true;
      let authSessionEnded: Promise<void> = Promise.resolve();
      try {
        // First: its local half is synchronous, so no renewal still out can store a token again.
        // Its slow half, the revoke at the service, is what the App's `disconnect()` awaits. It
        // never rejects, so the teardown below runs whatever the service answers.
        authSessionEnded = endAuthSessionRef.current?.() ?? Promise.resolve();
        setAccountOpen(false);
        setSession(null);
        resetInitialization();
        setDirectAuthRequested(false);
        directAuthInFlight.current = false;
        // The SDK holds its session in memory only; setSession(null) above already removed the
        // widget's stored session, so only the separate identity token needs removing here.
        getFluentConnect().disconnect();
        // Best effort, like every storage access in this teardown: a browser that refuses to remove
        // it — blocked site data, a throwing `removeItem` — must not skip the Privy logout and the
        // wallet disconnect below, which are what actually end the session.
        removeStoredValue(resolveLocalStorage(), FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
        setWalletStatus("Disconnected");
        if (authenticated) {
          try {
            await logout();
          } catch (error) {
            debugWarn("[fluent widget] Privy logout failed", error);
          }
        }
        // Back to the default, not off: a fresh connection starts from it.
        commitSilentSigningEnabled(FLUENT_CONNECT_DEFAULT_SILENT_SIGNING);
        connectedPresentation.current.connected = null;
        connectedPresentation.current.rebuilding = null;
        clearPrivyRecentLoginMethod(getFluentPrivyAppId(resolvedConfig.network));
        if (activeWallet?.connected) activeWallet.disconnect();
      } finally {
        // Released with the local teardown, not with the revoke: the guard covers the renders
        // between setSession(null) and the Privy logout, and holding it longer would block the
        // direct authorization of the next login.
        disconnectingRef.current = false;
      }
      if (awaitAuthSession) await authSessionEnded;
    },
    [
      activeWallet,
      authenticated,
      commitSilentSigningEnabled,
      connectedPresentation,
      getFluentConnect,
      logout,
      resolvedConfig.network,
      setDirectAuthRequested,
      setSession,
    ],
  );

  // The event is here, not in `handleDisconnect`, which re-login runs too, and before the
  // teardown clears the analytics context, so it carries the disconnected addresses. Returns the
  // teardown promise for the App's `disconnect()`; the widget's own menu ignores it.
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

  // Sub-pages (Settings, Deposit, Bridge) share the tab value, so the tab they were opened from
  // is remembered: Back leaves the stack there, and closing the drawer mid-stack returns there.
  const subPage = WALLET_MENU_SUB_PAGES[walletMenuTab] ?? null;
  const lastMenuTabRef = useRef(subPage ? "home" : walletMenuTab);
  const walletMenuTabRef = useRef(walletMenuTab);
  walletMenuTabRef.current = walletMenuTab;
  const accountOpenRef = useRef(accountOpen);
  accountOpenRef.current = accountOpen;
  useEffect(() => {
    if (!WALLET_MENU_SUB_PAGES[walletMenuTab]) lastMenuTabRef.current = walletMenuTab;
  }, [walletMenuTab]);

  useEffect(() => {
    if (!accountOpen && WALLET_MENU_SUB_PAGES[walletMenuTab]) {
      setWalletMenuTab(lastMenuTabRef.current);
    }
  }, [accountOpen, setWalletMenuTab, walletMenuTab]);

  // Back walks one level up a nested page (Bridge → Deposit) before it drops
  // out to the tab the stack was entered from. On the review page it is the
  // rejection, defined with the review further down.
  const cancelReviewRef = useRef<() => void>(() => {});
  const closeSubPage = useCallback(() => {
    if (isReviewTab(walletMenuTab)) {
      cancelReviewRef.current();
      return;
    }
    setWalletMenuTab(WALLET_MENU_SUB_PAGES[walletMenuTab]?.parent ?? lastMenuTabRef.current);
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
    if (!authenticated || !user?.id || directAuthInFlight.current) return;
    if (disconnectingRef.current) return;
    // A wallet's Privy session, made by `linkX()` through SIWE, is not turned into a Fluent ID,
    // whichever wallet the connector reports. See `walletUserPrivySession`.
    if (walletUserPrivySession) return;
    // Authentication can return before the Signer has been created or loaded. Manual retries
    // use this callback too: wait for preparation instead of reporting a missing Signer as a
    // failed Direct login and clearing its intent.
    if (!privyReady || embeddedWalletCount === 0) return;
    // A stored session of the signed-in user ends direct auth unless a login is pending; a
    // re-issued session matches `user.id`, so this cannot cycle. `user` is optional-chained:
    // `hydrateSession` checks only the address and `issuedAt`, and a malformed one is re-issued.
    if (session && !directAuthRequested.current && session.user?.id === user.id) return;
    if (!identityToken) {
      setWalletStatus("Waiting for Privy identity token");
      return;
    }

    directAuthInFlight.current = true;
    setWalletStatus("Preparing Fluent account");
    setLoginError(null);
    try {
      const kernel = smartAccount.kernel ?? (await smartAccount.refresh());
      if (!kernel?.smartAccountAddress) {
        setWalletStatus(smartAccount.error?.message ?? "Waiting for ZeroDev smart account");
        return;
      }

      const app = getFluentConnect().status().app;
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
        smartAccountAddress: nextSession.wallet.smartAccountAddress,
      });

      setSession(nextSession);
      // After setSession, so the event carries the addresses.
      track("connect_login_completed");
      resetInitialization();
      // The SDK holds this in memory only: setSession above wrote the widget's stored session, the
      // one stored copy.
      getFluentConnect().setSession(nextSession);
      // The identity token is stored separately. Best effort: a storage that will not keep it
      // costs the next page load one re-authentication, and must never turn the sign-in that
      // just succeeded into `direct_auth_failed` below.
      writeStoredValue(
        resolveLocalStorage(),
        FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
        identityToken,
      );
      setWalletStatus("Wallet connected!");
      setConnectOpen(false);
      // Both marks, not only the intent: either one left behind would classify the next Privy
      // session this tab sees (`directLoginDialogMarksPresent`). The dialog clears the marker
      // too; this clears it whether a dialog is mounted or not.
      setDirectAuthRequested(false);
      clearInlineOAuth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create Fluent session";
      // Clear both marks too: a failed re-issue must not stay armed for the tab.
      setDirectAuthRequested(false);
      clearInlineOAuth();
      track("connect_login_failed", { reason: "direct_auth_failed" });
      debugError("[fluent widget] direct auth failed", error);
      setLoginError(message);
      setWalletStatus(message);
    } finally {
      directAuthInFlight.current = false;
    }
  }, [
    authenticated,
    privyReady,
    embeddedWalletCount,
    getFluentConnect,
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
    if (disconnectingRef.current) return;
    if (!privyReady || !authenticated) return;
    if (embeddedWalletCount === 0) return;
    completeDirectAuthorization();
  }, [
    authenticated,
    completeDirectAuthorization,
    embeddedWalletCount,
    identityToken,
    privyReady,
    session,
    smartAccount.smartAccountAddress,
    smartAccount.smartAccountReady,
  ]);

  /**
   * Starts a Fluent ID sign-in, for the connect dialog's Fluent methods, the account menu's
   * re-login (`handleConnectWithX`) and the Bridge page.
   *
   * Reads Privy's state off the latest render (`privySessionNow`): `handleConnectWithX` calls it
   * right after a logout whose commit may not have happened yet. A live Fluent ID session is
   * completed at once. A wallet's Privy session (`walletUserPrivySession`) is signed out first
   * through `logoutPrivyForLinkX`, leaving the External wallet and its Service session alone.
   *
   * The dialog awaits the promise before it runs the chosen method. It resolves with the intent
   * armed, after the signed-out commit where there was a logout. A logout that does not complete
   * within its bound is reported in the status, arms no intent, and rejects, so the dialog shows
   * the error and runs nothing on the still-signed-in session.
   */
  const startDirectFluentLogin = useCallback(async (): Promise<void> => {
    setLoginError(null);
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
        setLoginError(message);
        setWalletStatus(message);
        throw error instanceof Error ? error : new Error(message);
      }
    }
    setWalletStatus("Opening Fluent Connect ID");
    setDirectAuthRequested(true);
    setConnectOpen(true);
  }, [completeDirectAuthorization, setDirectAuthRequested]);

  useEffect(() => {
    if (inlineLoginRequest <= handledInlineLoginRequest.current) return;
    handledInlineLoginRequest.current = inlineLoginRequest;
    setLoginError(null);
    setDirectAuthRequested(true);
    setConnectOpen(true);
  }, [inlineLoginRequest, handledInlineLoginRequest, setDirectAuthRequested]);

  const handleConnectWithX = useCallback(async () => {
    // The local teardown only: the new login starts as soon as the old identity is gone, and
    // revoking the old session at the service is not something it has to wait for.
    await handleDisconnect({ awaitAuthSession: false });
    // A failure is reported inside, in the status and `loginError`; no modal is open yet to
    // hand it to.
    void startDirectFluentLogin().catch(() => undefined);
  }, [handleDisconnect, startDirectFluentLogin]);
  // The Bridge page's way in for someone who has only an External wallet: no teardown, since
  // that wallet funds the Deposit.
  const signInWithFluent = useCallback(() => {
    void startDirectFluentLogin().catch(() => undefined);
  }, [startDirectFluentLogin]);

  const closeAccountMenu = useCallback(() => setAccountOpen(false), [setAccountOpen]);
  // A Review is a page of the drawer, not a modal: opening one puts the drawer up over whatever
  // was on screen. Where it came from is remembered, so cancelling returns there and confirming
  // an App's Batch operation closes the drawer again.
  const reviewOriginRef = useRef<{ tab: string; open: boolean } | null>(null);
  const openReviewPage = useCallback(() => {
    if (!isReviewTab(walletMenuTabRef.current)) {
      reviewOriginRef.current = { tab: walletMenuTabRef.current, open: accountOpenRef.current };
    }
    setWalletMenuTab(REVIEW_TAB);
    setAccountOpen(true);
  }, [setAccountOpen, setWalletMenuTab]);
  const { batchReview, confirmBatchOperation, acceptBatchReview, rejectBatchReview } =
    useBatchReview({ onOpen: openReviewPage });
  const { signatureReview, confirmSignature, acceptSignatureReview, rejectSignatureReview } =
    useSignatureReview({ onOpen: closeAccountMenu });

  // Leaving the Review page: the drawer and tab go back to where the Review found them, except
  // that a confirmed Send opens its Transfer page, and a confirmed Fluent swap the Two-step
  // deposit's Transfer page, Pending until it settles.
  const leaveReviewPage = useCallback(
    (outcome: "confirmed" | "cancelled") => {
      const origin = reviewOriginRef.current;
      reviewOriginRef.current = null;
      const wasSend = batchReview?.id === FLUENT_SEND_TOKEN_OP_ID;
      if (outcome === "confirmed" && wasSend) {
        setWalletMenuTab(SENT_TRANSFER_TAB);
        setAccountOpen(true);
        return;
      }
      if (outcome === "confirmed" && batchReview?.id === FLUENT_SWAP_OP_ID) {
        setWalletMenuTab(DEPOSIT_SWAP_TAB);
        setAccountOpen(true);
        return;
      }
      setWalletMenuTab(origin?.tab ?? "home");
      setAccountOpen(origin?.open ?? false);
    },
    [batchReview?.id, setAccountOpen, setWalletMenuTab],
  );
  const confirmReview = useCallback(() => {
    acceptBatchReview();
    leaveReviewPage("confirmed");
  }, [acceptBatchReview, leaveReviewPage]);
  const cancelReview = useCallback(() => {
    rejectBatchReview();
    leaveReviewPage("cancelled");
  }, [leaveReviewPage, rejectBatchReview]);
  cancelReviewRef.current = cancelReview;

  // Dismissing the drawer while a review is up is a rejection too, or the
  // execution awaiting it would hang until the widget unmounts.
  useEffect(() => {
    if (!accountOpen && batchReview) rejectBatchReview();
  }, [accountOpen, batchReview, rejectBatchReview]);

  const widgetApi = useWidgetExecution({
    chain,
    fluentAccountReady,
    wallet: activeWallet,
    smartAccount,
    widgetAccount,
    defaultSigningMode,
    selectedGasPaymentToken,
    confirmBatchOperation,
    defaultSponsorship: resolvedConfig.gasPayment.sponsorship,
    quickSignWhitelist: resolvedConfig.quickSign.whitelistAddresses,
    confirmSignature,
    refreshBalances,
    track,
  });

  // Transfers the widget has sent and is still waiting on. Held above the
  // drawer so a review closing it cannot take them with it.
  const [pendingTransfers, setPendingTransfers] = useState<readonly FluentPendingTransfer[]>([]);
  const pendingTransferCount = useRef(0);
  // The latest Send, for its Transfer page. Kept apart from the list: the list drops a
  // settled transfer once the history lists it, and the page stays on it after that.
  const [sentTransfer, setSentTransfer] = useState<FluentPendingTransfer | null>(null);
  const beginTransfer = useCallback((transfer: Omit<FluentPendingTransfer, "id">) => {
    pendingTransferCount.current += 1;
    const id = `pending-${pendingTransferCount.current}`;
    setPendingTransfers((list) => [...list, { ...transfer, id }]);
    setSentTransfer({ ...transfer, id });
    // The panel only, not the page: the Review can still be refused, and the Send form behind
    // it holds the address and amount the person typed.
    setWalletMenuPanel("activity");
    return id;
  }, []);
  const endTransfer = useCallback((id: string) => {
    setPendingTransfers((list) => list.filter((transfer) => transfer.id !== id));
    // A transfer without a hash never reached the chain, so its page has nothing to show.
    setSentTransfer((transfer) => (transfer?.id === id && !transfer.hash ? null : transfer));
  }, []);
  const settleTransfer = useCallback(
    (id: string, hash: Hash) => {
      setPendingTransfers((list) =>
        list.map((transfer) => (transfer.id === id ? { ...transfer, hash } : transfer)),
      );
      setSentTransfer((transfer) => (transfer?.id === id ? { ...transfer, hash } : transfer));
      // A backstop for a history that never lists the hash (an indexer outage, a reorg), so a
      // settled transfer cannot leave a row spinning. The details outlive the row: see
      // `attachFluentPendingTransfers`.
      setTimeout(() => {
        setPendingTransfers((list) =>
          list.map((transfer) => (transfer.id === id ? { ...transfer, expired: true } : transfer)),
        );
      }, SETTLED_TRANSFER_GRACE_MS);
      setTimeout(() => endTransfer(id), SETTLED_TRANSFER_RETENTION_MS);
    },
    [endTransfer],
  );
  // A Send that failed after its review was confirmed: the toast says why, and its page,
  // with nothing left to show, gives way to the account.
  useEffect(() => {
    if (walletMenuTab === SENT_TRANSFER_TAB && !sentTransfer) setWalletMenuTab("home");
  }, [walletMenuTab, sentTransfer, setWalletMenuTab]);

  // Deposits signed on the Bridge page, listed in Activity until the indexer lists them. Held
  // here because the Bridge page unmounts when Activity opens; cleared for another Fluent ID,
  // since they were credited to this one.
  const [sentDeposits, setSentDeposits] = useState<readonly SentBridgeDeposit[]>([]);
  const addSentDeposit = useCallback((deposit: SentBridgeDeposit) => {
    setSentDeposits((list) => [...list, deposit]);
  }, []);
  useEffect(() => {
    setSentDeposits([]);
  }, [fluentAccountAddress]);

  // A Send refused because its Gas token cannot pay the fee, reopened with the fee in the native
  // token when the person asks from the failure toast. Leaving the Send page drops it, so the
  // Send button opens a blank one. It belongs to the account the Send left.
  const openSendPage = useCallback(() => {
    setWalletMenuTab("send");
    setAccountOpen(true);
  }, [setAccountOpen, setWalletMenuTab]);
  const { sendRetry, payFeeInNative, clearSendRetry } = useFluentSendRetry(
    connectedAddress ?? fluentAccountAddress,
    openSendPage,
  );
  useEffect(() => {
    if (walletMenuTab !== "send" && sendRetry) clearSendRetry();
  }, [walletMenuTab, sendRetry, clearSendRetry]);
  const sendToken = useTokenTransfer({
    widget: widgetApi,
    track,
    beginTransfer,
    settleTransfer,
    endTransfer,
    onPayFeeInNative: payFeeInNative,
  });
  // Held here, not in the wallet menu: a mint's Review unmounts the card, and a busy flag kept
  // there would come back false with the mint in flight. On mainnet the card ignores both and
  // keeps the on-ramp.
  const { mintUsdnr, mintingUsdnr } = useUsdnrMint({
    widget: widgetApi,
    network: resolvedConfig.network,
    gasSymbol: gasPaymentToken,
    track,
  });
  // Held here like the mint: every other tab and the Review page unmount the Bridge page, so a
  // Two-step deposit's phase cannot live inside it.
  const depositSwap = useFluentDepositSwap({
    widget: widgetApi,
    network: resolvedConfig.network,
    gasSymbol: gasPaymentToken,
    track,
    refreshBalances,
  });
  // The Bridge page's view of it: a deposit it hands over opens the Two-step deposit's
  // Transfer page, Pending, rather than a status screen on the Bridge page.
  const bridgeDepositSwap = useMemo(
    () => ({
      ...depositSwap,
      begin: (deposit: Parameters<typeof depositSwap.begin>[0]) => {
        const taken = depositSwap.begin(deposit);
        if (taken) setWalletMenuTab(DEPOSIT_SWAP_TAB);
        return taken;
      },
    }),
    [depositSwap, setWalletMenuTab],
  );
  // A finished Two-step deposit is shown once: leaving the Bridge page clears it. Keyed to what
  // is on screen, not to the page unmounting, which StrictMode and the Review page also cause.
  const depositSwapRef = useRef(depositSwap);
  depositSwapRef.current = depositSwap;
  const bridgeOnScreen = accountOpen && isBridgeTab(walletMenuTab);
  const bridgeWasOnScreenRef = useRef(bridgeOnScreen);
  useEffect(() => {
    const left = bridgeWasOnScreenRef.current && !bridgeOnScreen;
    bridgeWasOnScreenRef.current = bridgeOnScreen;
    if (left && depositSwapRef.current.state.phase === "settled") depositSwapRef.current.reset();
  }, [bridgeOnScreen]);
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
   * Returns a fresh identity token, for the POST that completes a link. Rejects with
   * `link_failed` when Privy accepts the refresh and never publishes the token.
   *
   * `localStorage["privy:id_token"]` and the `privy-id-token` cookie are not read: Privy writes
   * both, and neither is a contract this SDK may hold Privy to.
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
   * The completion signal of a redirected link. `useLinkAccount`'s `onSuccess` is not passed
   * below: in Privy 2.25.0 the link intent it fires from is a `useRef`, which the OAuth reload
   * destroys, so it never fires after a redirect. The user Privy restores survives the reload,
   * and its `linkedAccounts` gaining a `twitter_oauth` entry is what the gate waits for.
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

  /**
   * The hop in flight, if any: a `linkX()` that has called Privy's `linkTwitter()` and waits for
   * the navigation it starts. Privy refuses a hop through `onError` below, before the page
   * leaves, and that refusal rejects the waiting call. One `linkX()` per page is assumed.
   * Registered by `linkTwitterForLinkX`.
   */
  const linkXHopWaiter = useRef<{ reject: (error: FluentAuthError) => void } | null>(null);
  const settleLinkXHop = useCallback((error: FluentAuthError) => {
    const waiting = linkXHopWaiter.current;
    if (!waiting) return false;
    linkXHopWaiter.current = null;
    waiting.reject(error);
    return true;
  }, []);

  // Signal (b): Privy refused the link. `onError` only — see `privyHasLinkedX` for why there
  // is no `onSuccess` here.
  const { linkTwitter } = useLinkAccount({
    onError: (code) => {
      const error = toLinkXPrivyError(code);
      debugWarn("[fluent widget] linking X failed", { code, fluentCode: error.code });
      // A call in flight asked for this hop, and this is its answer — not `redirecting`.
      if (settleLinkXHop(error)) return;
      // Otherwise the refusal answers a return in wait, if any; with none, no return is
      // coming, so the marker goes.
      if (!settleLinkXReturn({ status: "error", error })) {
        clearLinkXMarker(resolveSessionStorage());
      }
    },
  });

  /**
   * The connected External wallet as the core signs it in: its address as the connector spells
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
    // Every user `linkX()` signed in on this page is signed out now. A login still in flight
    // keeps its own flag.
    linkXSiweLogins.current.userIds.clear();
    // Nobody signed in answers a dialog sign-in now; if the tab still holds both marks, the next
    // render remembers whoever signs in next.
    dialogSignInUserIds.current.clear();
    const waiters = privySignedOutWaiters.current;
    if (waiters.length === 0) return;
    privySignedOutWaiters.current = [];
    for (const resolve of waiters) resolve();
  }, [privySignedOut]);

  /**
   * Privy's `logout()`, awaited to the signed-out commit, for a `linkX()` that met another
   * wallet's Privy session or signed in a user that does not own the connected wallet, and for
   * `startDirectFluentLogin`. Rejects with `link_failed` once `LINK_X_IDENTITY_TOKEN_TIMEOUT_MS`
   * has passed, counted from before Privy is asked, since Privy's `logout()` awaits its own calls
   * first; a logout completing later changes nothing. `logout` is read from `linkXInputs`.
   *
   * Only Privy is logged out: the wallet connector and the wallet's Service session are not
   * touched. Resolving also forgets `linkXSiweLogins` and `dialogSignInUserIds`, since React may
   * commit no render between a login Privy answers at once and this logout; a logout that timed
   * out or that Privy refused forgets nothing.
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
        dialogSignInUserIds.current.clear();
        resolve();
      };
      timer = setTimeout(() => {
        settle(() =>
          reject(
            new FluentAuthError("link_failed", "Privy did not sign the previous session out."),
          ),
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
   * Whoever is waiting for a render that has published a Privy user as signed in. The mirror
   * of `privySignedOutWaiters`, for the login: each waiter is asked again on every commit that
   * changes who Privy reports, and decides for itself whether that is the user it wants.
   */
  const privyUserWaiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    const waiters = privyUserWaiters.current;
    if (waiters.length === 0) return;
    privyUserWaiters.current = [];
    for (const check of waiters) check();
  }, [authenticated, user?.id]);

  /**
   * Resolves once a render has published `subject` as the signed-in Privy user — at once when
   * the latest render already has, which is every Fluent ID's call and a wallet's repeat call.
   * Refuses within the identity token's bound rather than hangs: a Privy that signed somebody
   * in and never commits a render of them is a `link_failed`, not a promise held open.
   */
  const awaitPrivyUserPublished = useCallback((subject: string): Promise<void> => {
    const published = () => {
      const live = linkXInputs.current;
      return live.authenticated && live.privyUserId === subject;
    };
    if (published()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (!published()) {
          privyUserWaiters.current = [...privyUserWaiters.current, check];
          return;
        }
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        privyUserWaiters.current = privyUserWaiters.current.filter((pending) => pending !== check);
        reject(new FluentAuthError("link_failed", privyUserNotPublished()));
      }, LINK_X_IDENTITY_TOKEN_TIMEOUT_MS);
      privyUserWaiters.current = [...privyUserWaiters.current, check];
    });
  }, []);

  /**
   * Privy's `linkTwitter()` for `subject`, as the core calls it: from a render that has
   * published that user as signed in, and followed to the navigation it requests.
   *
   * In Privy 2.25.0 every link method closes over the `authenticated` and `user` of the render
   * that made it, so one from the render `linkX()` started on, where on the wallet path nobody
   * was signed in yet, answers `onError(must_be_authenticated)` and navigates nowhere. So the
   * function is read through `linkXInputs`, once `awaitPrivyUserPublished(subject)` resolves.
   * `linkTwitter` is declared `() => void` but returns a promise that resolves once the browser
   * is asked to navigate and rejects after `onError`; that promise, or an `onError` refusal
   * through `linkXHopWaiter`, settles the call, whichever lands first. A `linkTwitter` that
   * returns nothing resolves at once.
   *
   * Rejects with `link_failed` when Privy does not reach the navigation within
   * `LINK_X_IDENTITY_TOKEN_TIMEOUT_MS`, and the core clears the marker; a late navigation then
   * resumes nothing, and the next `linkX()` reads the link off the identity token.
   */
  const linkTwitterForLinkX = useCallback(
    async (subject: string): Promise<void> => {
      await awaitPrivyUserPublished(subject);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (answer: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (linkXHopWaiter.current?.reject === rejectHop) linkXHopWaiter.current = null;
          answer();
        };
        const rejectHop = (error: FluentAuthError) => settle(() => reject(error));
        const timer = setTimeout(() => {
          rejectHop(new FluentAuthError("link_failed", linkXHopTimedOut()));
        }, LINK_X_IDENTITY_TOKEN_TIMEOUT_MS);
        linkXHopWaiter.current = { reject: rejectHop };
        let started: unknown;
        try {
          // The function of the latest render, and what it really returns.
          started = (linkXInputs.current.linkTwitter as () => unknown)();
        } catch (err) {
          settle(() => reject(err));
          return;
        }
        if (isPromiseLike(started)) {
          started.then(
            () => settle(resolve),
            (err: unknown) => settle(() => reject(err)),
          );
        } else {
          settle(resolve);
        }
      });
    },
    [awaitPrivyUserPublished],
  );

  /**
   * Everything `linkX()` hands the core, and the gate's own conditions, as of the latest render,
   * read when the core calls rather than captured when `linkX()` started. A re-entry starts
   * before Privy has restored anything: a closure taken then would carry no Privy user, no
   * account kind and the pre-link identity token. Written during render; the SIWE functions are
   * read the same way, from `linkXSiwe`.
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
   * Privy's headless SIWE, as of the latest render of a page with an External wallet connected
   * and no stored session, and `null` on every other page. Written by `LinkXSiweSource` below.
   *
   * Read at call time: in Privy 2.25.0 `loginWithSiwe` throws `User already authenticated` from
   * the `user` of the render that created it, and `generateSiweMessage` reads that render's
   * `authenticated`, so functions captured before a logout would keep refusing after it.
   *
   * A page with a stored session is a Fluent ID's, restored by Privy or not, and a `linkX()`
   * that reaches for SIWE there is refused: signing the wallet in to Privy would put a second
   * user under the Fluent ID's session.
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
   * `ready`: Privy has restored the subject with an X account, and the account the core needs is
   * back: for a Fluent ID the smart account, which arrives seconds after the Privy session; for
   * an External wallet its client, which signs the Auth token exchange, on a Privy session the
   * wallet owns (`privyOwnsWallet`).
   *
   * `foreign`: nobody on this page will finish the hop. Privy has restored somebody else, in a
   * browser two people share; or the subject's wallet session does not own the wallet connected
   * now, switched across the redirect; or, on a wallet page, Privy has restored nobody, and only
   * a new SIWE, run by a fresh `linkX()`, could bring the subject back. Privy's restored user
   * decides who is here; a stored session naming somebody else is re-issued from it.
   *
   * `waiting`: anything else, such as Privy still restoring, or the smart account, the wallet's
   * client or the X account still to come. A Fluent ID whose smart account is not back reads as
   * `eoa` beside a connected External wallet, but its session names the subject, so it waits.
   * The marker's age is not read.
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
   * Waits for the return of a hop this subject started, and settles on the first signal: until
   * one lands, no core call, no POST, no token refresh and no second `linkTwitter()` happen.
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
    // As for the effect: the conditions are read from the ref, not captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * `linkX()` for the render context. Idempotent and re-enterable: see `requestLinkX`.
   *
   * The return gate lives here, not in the core, because the restored Privy user and Privy's own
   * callback drive it. Both ways in go through it: `useLinkX()` on mount, and an App calling
   * `linkX()` on the render context.
   */
  const linkX = useCallback(async (): Promise<FluentLinkXResult> => {
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
    // The state the call decides on — the account, the session, the wallet — as of now. No
    // function is taken from it: each is read from the ref when the core calls it, because by
    // then a SIWE login and the renders it caused may have happened, and Privy's functions are
    // the render's (see `linkTwitterForLinkX`).
    const live = linkXInputs.current;
    return requestLinkX({
      accountKind: live.accountKind,
      subject: live.privyUserId,
      wallet: live.wallet,
      siwe: {
        session: live.privyUser,
        fluentSessionUserId: live.sessionUserId,
        logout: logoutPrivyForLinkX,
        // Thunks: Privy's functions of the render current at each call (see `linkXSiwe`), each
        // bounded by `LINK_X_SIWE_STEP_TIMEOUT_MS` and rejecting with `link_failed` after it.
        generateSiweMessage: (input) =>
          bounded(
            linkXSiweOrRefuse().generateSiweMessage(input),
            LINK_X_SIWE_STEP_TIMEOUT_MS,
            siweStepTimedOut("generate the sign-in message"),
          ),
        // Marked in flight before Privy is asked, and the user it signs in remembered, so their
        // renders read as a wallet's session (`walletUserPrivySession`). Both follow Privy's
        // answer, not the bound: a login completed after the timeout still signs somebody in.
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
          return bounded(
            login,
            LINK_X_SIWE_STEP_TIMEOUT_MS,
            siweStepTimedOut("sign the wallet in"),
          );
        },
      },
      publicApiUrl: resolvedConfig.publicApiUrl,
      readIdentityToken: () => linkXInputs.current.identityToken,
      getAuthToken: () => linkXInputs.current.getAuthToken(),
      getAccessToken: () => linkXInputs.current.getAccessToken(),
      getIdentityToken: () => linkXInputs.current.getIdentityToken(),
      linkTwitter: linkTwitterForLinkX,
      storage,
    });
  }, [awaitLinkXReturn, linkTwitterForLinkX, logoutPrivyForLinkX, resolvedConfig.publicApiUrl]);

  const sessionPrivyUserId = session?.user?.id;
  /**
   * Whether a Fluent ID is signed in and its smart account is not ready: while it connects or
   * restores, and while a failed initialization is retried. With an External wallet connected
   * beside it the account derives `eoa`, and the User settings subject would turn to the wallet,
   * whose settings read mints an Auth token and can open a Sign-in challenge. This holds the
   * subject on the Fluent ID until the smart account arrives or the stored session stops naming
   * a Fluent ID. Read from the stored session, which hydrates synchronously, not from Privy.
   */
  const fluentIdRebuilding =
    Boolean(sessionPrivyUserId) &&
    smartAccount.smartAccountEnabled &&
    !derivedAccount.fluentAccountReady;
  /**
   * The account kind the User settings controller and the Settings screen agree on: whose Quick
   * sign and Gas token these are, and which of the two controls the screen offers. `undefined`
   * while `fluentIdRebuilding`, where the Fluent ID would read as `eoa` and lose both controls.
   */
  const settingsAccountKind = fluentIdRebuilding ? undefined : widgetAccount.type;
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
    network: resolvedConfig.network,
    accountType: settingsAccountKind,
    defaultGasToken: resolvedConfig.gasPayment.defaultToken,
    // The stored session names the person before Privy has restored them, so the held subject
    // stays a known one.
    privyUserId: user?.id ?? sessionPrivyUserId,
    identityToken,
    walletAddress: activeWallet?.address,
    hasWalletClient: Boolean(activeWallet?.walletClient),
    // The windows in which the account is on its way in, read from the derivation rather than
    // from what the widget shows.
    settling:
      fluentIdRebuilding ||
      derivedAccount.status === "connecting" ||
      derivedAccount.status === "restoring",
    getAuthToken,
    commitQuickSign: commitSilentSigningEnabled,
    setGasPaymentToken,
  });

  // Hands the ZeroDev hook what it could not be given at construction. Only a Fluent ID ends up
  // with a token here; the resolver in `core/sponsoredClient` decides that from `accountType`
  // and from what the exchange answers.
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

  /**
   * Passkeys on the Fluent ID: one WebAuthn ceremony on the Privy user this page holds, through
   * Privy's headless `linkWithPasskey`, after which the dialog's "Continue with passkey" signs in
   * to the same user without the X round trip. Offered only where the account is a Fluent ID,
   * never on an External wallet's Privy session.
   */
  const { linkWithPasskey } = useLinkWithPasskey();
  const addPasskey = useCallback(() => linkWithPasskey(), [linkWithPasskey]);
  const removePasskey = useCallback(
    async (credentialId: string) => {
      await unlinkPasskey(credentialId);
    },
    [unlinkPasskey],
  );
  const passkeyOffered = settingsAccountKind === "smart" && authenticated && user !== null;
  /**
   * The user's passkeys as the Settings list shows them: Privy's record, which is the one a
   * removal edits. A credential the person deleted from their password manager stays here —
   * WebAuthn tells the server nothing about a local deletion — and the list with its remove
   * buttons is exactly how that orphan gets cleaned up.
   */
  const passkeys = useMemo(() => {
    const accounts = user?.linkedAccounts ?? [];
    return accounts
      .filter((account): account is PasskeyWithMetadata => account.type === "passkey")
      .map((account) => ({
        credentialId: account.credentialId,
        label:
          account.authenticatorName ||
          [account.createdWithBrowser, account.createdWithOs].filter(Boolean).join(" on ") ||
          "Passkey",
        addedOn: account.firstVerifiedAt
          ? new Date(account.firstVerifiedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : undefined,
      }));
  }, [user?.linkedAccounts]);

  // The Privy user, only while the account menu shows its account: connecting an External wallet
  // does not clear Privy's user, and an avatar or a name read off it beside a wallet address
  // would describe somebody else.
  const displayedPrivyUser = accountMenuIsExternalWallet ? undefined : user;

  const userAvatarUrl = resolvedConfig.avatar.forceDefault
    ? undefined
    : getHighResTwitterAvatar(displayedPrivyUser?.twitter?.profilePictureUrl) || undefined;
  const defaultLogoUrl = resolvedConfig.avatar.defaultLogoUrl;

  // `avatar.forceDefault` is about the picture alone and leaves the names be, so an App that
  // ships its own logo can still greet the person by name.
  const userXDisplayName = displayedPrivyUser?.twitter?.name || undefined;
  const userGoogleName = displayedPrivyUser?.google?.name || undefined;

  // The one projection the App receives: the stored session is not reachable through the API.
  const hostSession = useMemo(() => toFluentWidgetSession(session), [session]);

  // The App's operations, and an iframe child's through it, say what the widget's own flows say
  // when the Gas token cannot pay the fee: their Review is closed by then.
  const appWidgetApi = useMemo(
    () =>
      withFluentInsufficientGasTokenNotice(widgetApi, (message) => {
        toast.add({ type: "error", title: "Transaction not sent", description: message });
      }),
    [widgetApi],
  );

  const context = useMemo<FluentWidgetRenderContext>(
    () => ({
      session: hostSession,
      userAvatarUrl,
      userXDisplayName,
      userGoogleName,
      wallet: activeWallet,
      widget: appWidgetApi,
      openConnect,
      openAccount: openAccountMenu,
      disconnect: requestDisconnect,
      hasConnectedAccount,
      status,
      refreshBalances,
      getAuthToken,
      linkX,
    }),
    [
      hostSession,
      userAvatarUrl,
      userXDisplayName,
      userGoogleName,
      activeWallet,
      appWidgetApi,
      openConnect,
      openAccountMenu,
      requestDisconnect,
      hasConnectedAccount,
      status,
      refreshBalances,
      getAuthToken,
      linkX,
    ],
  );

  /**
   * The App's own content, under the App's own query client where it mounted one, so a query it
   * prefetched or hydrated is read from its cache. `ReownProvider` mounts a separate client for
   * wagmi; the widget's queries stay on it, so an option or an invalidation on one client does
   * not reach the other's entries. Without an App client, the App's content resolves against the
   * widget's.
   */
  const appPage = (() => {
    const page = mode === "page" ? renderPage?.(context) : renderHome?.(context);
    if (!appQueryClient) return page;
    return <QueryClientProvider client={appQueryClient}>{page}</QueryClientProvider>;
  })();

  const widget = (
    <FluentPortalContainerProvider>
      <FluentTopLayerBridge />
      {!session && connectedWalletAddress !== undefined ? (
        <LinkXSiweSource source={linkXSiwe} />
      ) : null}
      <Toaster>
        {/* Two scopes, with App content between them: one wrapper around everything
        would put the App inside the widget's colour scheme, and reordering to
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
            subPageDismiss={subPage?.dismiss}
            onCloseSubPage={closeSubPage}
            userAvatarUrl={userAvatarUrl}
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
                userAvatarUrl={userAvatarUrl}
                userXDisplayName={userXDisplayName}
                userGoogleName={userGoogleName}
                defaultLogoUrl={defaultLogoUrl}
              />
            }
          >
            {isReviewTab(walletMenuTab) ? (
              batchReview ? (
                <TransactionReviewScreen
                  operation={batchReview}
                  network={resolvedConfig.network}
                  appName={resolvedConfig.appName}
                  track={track}
                  onConfirm={confirmReview}
                  onCancel={cancelReview}
                />
              ) : null
            ) : isWalletMenuCardTab(walletMenuTab) ? (
              <WalletMenuActionCard
                track={track}
                session={session}
                smartAccountAddress={fluentAccountAddress}
                connectedAddress={connectedAddress}
                accountKind={settingsAccountKind}
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
                sendRetry={sendRetry ?? undefined}
                pendingTransfers={pendingTransfers}
                sentTransfer={sentTransfer ?? undefined}
                sentDeposits={sentDeposits}
                depositSwap={depositSwap}
                onMintUsdnr={mintUsdnr}
                mintUsdnrBusy={mintingUsdnr}
                onRevealAccount={() => setAccountOpen(true)}
                gasContext={gasContext}
                onAddPasskey={passkeyOffered ? addPasskey : undefined}
                onRemovePasskey={passkeyOffered ? removePasskey : undefined}
                passkeys={passkeys}
              />
            ) : (
              <BridgeScreen
                config={config}
                recipient={fluentAccountAddress as `0x${string}` | undefined}
                onSignIn={signInWithFluent}
                track={track}
                depositSwap={bridgeDepositSwap}
                onDepositSent={addSentDeposit}
                onGoHome={() => setWalletMenuTab("home")}
              />
            )}
          </FluentAccountDrawer>
        </div>

        {/* The App: context only, no styling — context needs no DOM ancestry. */}
        <FluentWidgetProvider value={context} storedSession={session}>
          {appPage}
        </FluentWidgetProvider>

        <div className={WIDGET_STYLE_SCOPE}>
          {debugLogging && mode === "home" ? (
            <DebugPanel
              session={hostSession}
              wallet={activeWallet}
              walletStatus={walletStatus}
              loginError={loginError}
            />
          ) : null}

          <InlineConnectModal
            open={connectOpen}
            onSignerCreationError={() => setConnectOpen(true)}
            onClose={() => {
              setConnectOpen(false);
              setDirectAuthRequested(false);
            }}
            onRetry={() => {
              setLoginError(null);
              void completeDirectAuthorization();
            }}
            wallet={activeWallet}
            walletUserPrivySession={walletUserPrivySession}
            signInRefusal={directLoginSignInRefusal}
            config={config}
            loginError={loginError ?? smartAccount.error?.message}
            track={track}
            onExternalWalletSelected={() => {
              externalWalletAnalytics.current.intent = true;
            }}
            onFluentLogin={() => {
              track("connect_login_started");
              // Returned, not dropped: the modal runs the chosen method once this has resolved,
              // and not at all once it has rejected. See `startDirectFluentLogin`.
              return startDirectFluentLogin();
            }}
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
 * The page's source of Privy's headless SIWE: `useLoginWithSiwe`, mounted only while an External
 * wallet is connected and no stored session exists, writing the functions of its latest render
 * to `source` during render. Renders nothing.
 *
 * A component of its own so that a Fluent ID's page does not hold the means to sign a wallet in.
 * Unmounting clears the source, so a `linkX()` still in flight when a stored session arrives is
 * refused rather than handed functions of a page that is gone.
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
