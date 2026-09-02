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
import { PrivyProvider } from "@privy-io/react-auth";
import {
  FLUENT_CONNECT_DEFAULT_ASSETS,
  FLUENT_CONNECT_PRIVY_APP_ID,
  createFluentConnectPrivyConfig,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../core/config";
import {
  createTracker,
  trackWidgetLoadedOnce,
  type FluentAnalyticsContext,
  type FluentAnalyticsSendOptions,
  type FluentAnalyticsTrack,
} from "../core/analytics";
import { type FluentExternalWalletState, type FluentWidgetStatus } from "../core/types";
import { hasStoredWidgetSession } from "../utils/hasStoredWidgetSession";
import {
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { ReownProvider } from "./reownAppKit";
import { FluentWidgetNetworkProvider } from "./widgetNetworkContext";
import { type FluentBatchApi } from "./batchOperation";
import { FluentWidgetContent } from "./FluentWidgetContent";
import { clearPrivyRecentLoginMethod } from "../utils/clearPrivyRecentLoginMethod";
import { setDebugLogging } from "../core/debugLogger";
import type { FluentGasPaymentSymbol } from "../core/gasPayment";

const SILENT_SIGNING_REMOUNT_MS = 220;

export type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
  openAccount: () => void;
  /**
   * Tear down the current session without going through the widget's account
   * menu — the same teardown that menu's "Disconnect" runs, for both hosted and
   * direct auth. Resolves once the session, the stored identity token and any
   * external wallet connection are cleared, so a host can await it before
   * resetting its own state.
   */
  disconnect: () => Promise<void>;
  hasConnectedAccount: boolean;
  /**
   * Connection state as a single value that is meaningful on every render —
   * including the first, before a stored session has been reconciled. Branch on
   * this rather than on `hasConnectedAccount` alone: `"restoring"` and
   * `"disconnected"` both have `hasConnectedAccount === false`, and treating
   * them alike shows a Connect button to users who are already signed in.
   */
  status: FluentWidgetStatus;
  /**
   * True while a direct-auth smart account is being prepared after sign-in.
   * Equivalent to `status === "connecting"`; prefer `status`, which also covers
   * the restore-in-progress case this flag cannot express.
   */
  connecting: boolean;
  /**
   * Refetch the widget's on-chain balances. Transactions run through
   * `widget.createBatchOp` refresh automatically; call this after a tx sent via
   * an external wallet client (outside the widget's execution path).
   */
  refreshBalances: () => void;
  /**
   * A short-lived (5 min) Fluent-signed JWT for the connected user. Verify it on your backend
   * against `<iss>/.well-known/jwks.json` (ES256), checking `iss`, `aud` (= your partnerId) and
   * `exp`; `sub` is stable per user per app. Reused until `authTokenRenewalOffsetSeconds`
   * before `exp`. Direct auth only; throws `FluentAuthError`
   * (`code: "hosted_not_supported"`) in hosted mode. External wallets: EOAs and deployed
   * smart-contract wallets sign in; a not-yet-deployed smart account cannot (no ERC-6492).
   */
  getAuthToken: () => Promise<string>;
};

export type FluentWidgetConnectButtonRenderContext = {
  connected: boolean;
  /** True while a direct-auth smart account is being prepared after sign-in. */
  pending: boolean;
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
  /**
   * Print the widget's internal connect / smart-account / signing diagnostics to
   * the console. Off by default; turn on only while debugging an integration.
   */
  debugLogging?: boolean;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
};

export function FluentWidget(props: FluentWidgetProps) {
  // Set synchronously during render so the module-level flag is live before any
  // descendant (or non-React module) logs on this render pass.
  setDebugLogging(props.debugLogging ?? false);

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
  const resolvedConfig = useMemo(
    () => resolveFluentWidgetConfig(props.config),
    [props.config],
  );
  const resolvedNetwork = resolvedConfig.network;
  // The partner's allowed origins live on its Privy app client — without it Privy falls
  // back to the default client and rejects third-party origins with `invalid_origin`.
  const privyClientId = resolvedConfig.privyClientId;

  // Analytics lives above the keyed PrivyProvider so remounts do not reset the
  // instance or the tab timer. Addresses only exist after login and the session
  // lives in the inner component, so the tracker reads this ref at send time.
  const analyticsContext = useRef<FluentAnalyticsContext>({});
  // Above the keyed PrivyProvider for the same reason as the tracker: toggling silent
  // signing remounts the subtree mid-flow, and a connect intent recorded below it would
  // be thrown away. `connected` mirrors wagmi so a remount cannot re-report one wallet.
  const externalWallet = useRef({ intent: false, connected: false });
  const track = useMemo(
    () => createTracker(resolvedConfig, () => analyticsContext.current),
    [resolvedConfig],
  );

  const reportAnalyticsSession = useCallback((session: FluentWidgetSession | null) => {
    analyticsContext.current = session
      ? {
          smart_account_address: session.wallet.smartAccountAddress,
          embedded_wallet_address: session.wallet.signerAddress,
        }
      : {};
  }, []);

  // `open` guards against reporting a tab nobody ever looked at. `elapsed` + `hidden`
  // keep dwell time measuring attention: the clock stops while the page is in the
  // background instead of closing the view, because opening an outbound link is not
  // the same as leaving the tab.
  const tabEntry = useRef({
    tab: "home",
    at: Date.now(),
    elapsed: 0,
    open: false,
    hidden: false,
  });

  const startTabView = useCallback((tab: string) => {
    tabEntry.current = { tab, at: Date.now(), elapsed: 0, open: true, hidden: false };
  }, []);

  const pauseTabView = useCallback(() => {
    const entry = tabEntry.current;
    if (!entry.open || entry.hidden) return;
    entry.elapsed += Date.now() - entry.at;
    entry.hidden = true;
  }, []);

  const resumeTabView = useCallback(() => {
    const entry = tabEntry.current;
    if (!entry.open || !entry.hidden) return;
    entry.at = Date.now();
    entry.hidden = false;
  }, []);

  const flushTabView = useCallback(
    (options?: FluentAnalyticsSendOptions) => {
      const entry = tabEntry.current;
      if (!entry.open) return;
      const dwellMs = entry.elapsed + (entry.hidden ? 0 : Date.now() - entry.at);
      track("wallet_tab_viewed", { tab: entry.tab, dwell_ms: dwellMs }, options);
      tabEntry.current = { ...entry, at: Date.now(), elapsed: 0 };
    },
    [track],
  );

  // Never hand this to addEventListener directly: the event object would arrive as the
  // options argument, and the flush would go back to being queued and lost.
  const flushTabViewOnUnload = useCallback(() => flushTabView({ unload: true }), [flushTabView]);

  const handleTabChange = useCallback(
    (next: string) => {
      if (next !== tabEntry.current.tab) {
        const wasOpen = tabEntry.current.open;
        flushTabView();
        tabEntry.current = {
          tab: next,
          at: Date.now(),
          elapsed: 0,
          open: wasOpen,
          hidden: false,
        };
      }
      setWalletMenuTab(next);
    },
    [flushTabView],
  );

  // Observed as a transition rather than done inside the setAccountOpen updater:
  // React requires updaters to be pure and double-invokes them under StrictMode,
  // which would emit the view twice.
  const wasAccountOpen = useRef(accountOpen);
  useEffect(() => {
    if (wasAccountOpen.current === accountOpen) return;
    wasAccountOpen.current = accountOpen;

    if (accountOpen) {
      startTabView(walletMenuTab);
      return;
    }
    flushTabView();
    tabEntry.current = { ...tabEntry.current, open: false };
  }, [accountOpen, flushTabView, startTabView, walletMenuTab]);

  useEffect(() => {
    trackWidgetLoadedOnce(track, { has_stored_session: hasStoredWidgetSession() });
  }, [track]);

  useEffect(() => {
    // Backgrounding the page pauses the clock; only a real teardown closes the view.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseTabView();
      else resumeTabView();
    };

    addEventListener("pagehide", flushTabViewOnUnload);
    addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      removeEventListener("pagehide", flushTabViewOnUnload);
      removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushTabViewOnUnload, pauseTabView, resumeTabView]);
  const privyConfig = useMemo(
    () =>
      createFluentConnectPrivyConfig({
        network: resolvedNetwork,
        showWalletUIs: !silentSigningEnabled,
        logo: props.config?.assets?.fluentLogo ?? FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
      }),
    [props.config?.assets?.fluentLogo, resolvedNetwork, silentSigningEnabled],
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
    <FluentWidgetNetworkProvider network={resolvedNetwork}>
      <PrivyProvider
        key={`${resolvedNetwork}:${silentSigningEnabled ? "silent-signing" : "prompt-signing"}-${privyEpoch}`}
        appId={FLUENT_CONNECT_PRIVY_APP_ID}
        clientId={privyClientId}
        config={privyConfig}
      >
        <ReownProvider
          network={resolvedNetwork}
          disableAnalytics={resolvedConfig.disableAnalytics}
        >
          <FluentWidgetContent
          {...props}
          track={track}
          reportAnalyticsSession={reportAnalyticsSession}
          externalWalletAnalytics={externalWallet}
          accountOpen={accountOpen}
          setAccountOpen={setAccountOpen}
          walletMenuTab={walletMenuTab}
          setWalletMenuTab={handleTabChange}
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
    </FluentWidgetNetworkProvider>
  );
}
