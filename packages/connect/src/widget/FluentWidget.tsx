import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { FluentPrivyProvider, type FluentPrivyAdapter } from "./privyAdapter";
import {
  FLUENT_CONNECT_DEFAULT_ASSETS,
  FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
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
import { type FluentLinkXResult } from "../core/linkX";
import { 
  clearPrivyRecentLoginMethod,
  hasStoredWidgetSession,
} from "../utils";
import {
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { ReownProvider } from "./reownAppKit";
import { FluentWidgetNetworkProvider } from "./widgetNetworkContext";
import { type FluentBatchApi } from "./batchOperation";
import { FluentWidgetContent } from "./FluentWidgetContent";
import { setDebugLogging } from "../core/debugLogger";
import { type FluentGasTokenSymbol } from "../core/gasPayment";
import type { AuthTokenState } from "./hooks/useAuthToken";
import {
  createUserSettingsRefValue,
  type UserSettingsRef,
} from "./hooks/useUserSettings";
import {
  createConnectedPresentationState,
  type ConnectedPresentationState,
} from "./hooks/useWidgetAccount";

const SILENT_SIGNING_REMOUNT_MS = 220;

export type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  /** Privy's X avatar used by the account tile; absent for an External wallet or `forceDefault`. */
  userAvatarUrl?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
  openAccount: () => void;
  /**
   * Tear down the current session without going through the widget's account
   * menu — the same teardown that menu's "Disconnect" runs. The session, the
   * stored identity token and any external wallet connection are cleared before
   * this resolves, so a host can await it before resetting its own state.
   *
   * It also covers ending the Fluent session at the service — revoking the refresh
   * family so the 30 days stop here — including for a `getAuthToken()` that was still
   * out when the user disconnected: a wallet signature answered late opens a session
   * of its own, and this promise does not resolve while one of those could still be
   * live. It can therefore take as long as that request does. It never rejects, and
   * the widget's own teardown does not wait for it.
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
   * against `<iss>/.well-known/jwks.json` (ES256), checking `iss`, `aud` (= your appId) and
   * `exp`; `sub` is stable per user per app. Reused until `authTokenRenewalOffsetSeconds`
   * before `exp`, and renewed silently after that — for a Fluent ID and for an external wallet
   * alike. The wallet signs once, when the session opens; the renewals that follow ask it for
   * nothing. A new signature is needed only when the session's 30-day refresh family expires,
   * when the service rejects the refresh credential, or when it was never stored (the user
   * disconnected, cleared site data, or opened another browser).
   * External wallets: EOAs and deployed smart-contract wallets sign in; a not-yet-deployed
   * smart account cannot (no ERC-6492).
   */
  getAuthToken: () => Promise<string>;
  /**
   * Link an X account to the connected Fluent ID, headless: no widget screen, no settings page,
   * one call. Idempotent and re-enterable, because linking X needs an OAuth round trip that
   * leaves the page and Privy offers no other primitive for it.
   *
   * A user who already has X resolves `{ status: "linked", x }` with no dialog and without
   * leaving: the SDK sends the one `POST /api/v1/me/identity/privy` the service needs and
   * returns the account from its answer. A user who has none resolves `{ status: "redirecting" }`
   * once the navigation to X has been started: the code after the `await` does run, briefly —
   * enough to show a "taking you to X" state — but the page is unloading, so nothing on it may
   * wait for the link to finish. When the browser comes back, call `linkX()` again — `useLinkX()`
   * does it for you on mount — and it resolves `linked`, having waited for Privy to restore the
   * user and seen the X account on it. Calling it again when the user already has X costs one
   * request and changes nothing, which is what makes it safe to call on every mount.
   *
   * A link somebody else started in this tab, or a stale record of one, is discarded rather
   * than resumed: the call does no work and rejects with `link_failed`; call again to start one
   * for the signed-in user.
   *
   * An external wallet is first signed in to Privy with SIWE — one signature prompt, never a
   * transaction — and then takes the same path; a repeat call with that session live signs
   * nothing again. The connected account, its kind and the wallet's Fluent token are unchanged
   * by it.
   *
   * Rejects with `FluentAuthError`: `user_rejected` (the user said no at X, or declined the
   * SIWE signature), `linked_to_another_user` (that X account belongs to another Fluent user),
   * `not_authenticated` (no Fluent ID or external wallet connected), `bad_request` and
   * `link_failed` (everything else). No other code reaches the caller: a refusal from under
   * the call keeps its message under `link_failed`.
   */
  linkX: () => Promise<FluentLinkXResult>;
};

export type FluentWidgetConnectButtonRenderContext = {
  connected: boolean;
  /** True while a direct-auth smart account is being prepared after sign-in. */
  pending: boolean;
  addressLabel?: string;
  /** Privy's X avatar used by the account tile; absent for an External wallet or `forceDefault`. */
  userAvatarUrl?: string;
  onClick: () => void;
  openConnect: () => void;
  openAccount: () => void;
  DefaultButton: () => ReactNode;
};

export type FluentWidgetProps = {
  wallet?: FluentExternalWalletState | null;
  config: FluentWidgetConfig;
  /** Optional native Privy SDK bridge; requires direct auth. */
  privyAdapter?: FluentPrivyAdapter;
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

  /**
   * The App's own TanStack Query client, when it mounted one around this widget;
   * `undefined` when it did not, which is the ordinary case.
   *
   * Read here, above `ReownProvider`, because that provider mounts a query client
   * of the widget's own: from anywhere below it this context answers with ours.
   * `FluentWidgetContent` puts this one back around the App's `renderPage` /
   * `renderHome` output, so a query the App prefetched or hydrated from its own
   * server render is read from its cache instead of fetched a second time.
   *
   * `useContext` rather than `useQueryClient`, which throws where no provider is.
   */
  const appQueryClient = useContext(QueryClientContext);

  const resolvedConfig = useMemo(
    () => resolveFluentWidgetConfig(props.config),
    [props.config],
  );

  const [silentSigningEnabled, setSilentSigningEnabled] = useState(
    FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  );
  // What the switch shows while the debounce below has not applied the change yet.
  const [silentSigningChecked, setSilentSigningChecked] = useState(
    FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  );
  const silentSigningRemountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inlineLoginRequest, setInlineLoginRequest] = useState(0);
  // Survives a `PrivyProvider` restart so a consumed request cannot reopen login.
  const handledInlineLoginRequest = useRef(0);
  // Keep drawer + active tab across a `PrivyProvider` restart.
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletMenuTab, setWalletMenuTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] = useState<FluentGasTokenSymbol>(
    resolvedConfig.gasPayment.defaultToken,
  );
  // Both live above the keyed PrivyProvider, for the reason the tracker does:
  // toggling Quick sign remounts everything below it. The Fluent token the
  // settings read just obtained, and the read itself, must not be paid for
  // twice because of a preference the widget applied on the user's behalf.
  const authTokenState = useRef<AuthTokenState>({ cache: null, inFlight: null });
  const userSettings = useRef<UserSettingsRef>(createUserSettingsRefValue());
  // And for the same reason again: through a `PrivyProvider` restart the person
  // stays signed in, so what the button, the drawer and the host's status show
  // them must not fall back to a connecting state. `FluentWidgetContent` keeps
  // this current. Quick sign no longer restarts anything, so it no longer arms
  // the `rebuilding` half of this.
  const connectedPresentation = useRef<ConnectedPresentationState>(
    createConnectedPresentationState(),
  );
  const resolvedNetwork = resolvedConfig.network;
  // The App's allowed origins live on its Privy app client — without it Privy falls
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
    () => ({
      // The in-page sign-in dialog owns its captcha. Privy still owns MFA, recovery
      // and signing UI.
      headless: true,
      ...createFluentConnectPrivyConfig({
        network: resolvedNetwork,
        logo: props.config?.assets?.fluentLogo ?? FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo,
        customOAuthRedirectUrl: resolvedConfig.customOAuthRedirectUrl,
      }),
    }),
    [
      props.config?.assets?.fluentLogo,
      resolvedConfig.customOAuthRedirectUrl,
      resolvedNetwork,
    ],
  );

  // Drop last-used promotion before Privy's mount effect reads storage.
  useLayoutEffect(() => {
    clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
  }, []);

  /**
   * The one place `silentSigningEnabled` changes. It reaches signing through the
   * confirmation mode each call is given, not through anything Privy is
   * configured with, so changing it rebuilds nothing and the account below is
   * never interrupted.
   */
  const applySilentSigningEnabled = useCallback((enabled: boolean) => {
    setSilentSigningEnabled(enabled);
  }, []);

  const commitSilentSigningEnabled = useCallback(
    (enabled: boolean) => {
      if (silentSigningRemountTimer.current) {
        clearTimeout(silentSigningRemountTimer.current);
        silentSigningRemountTimer.current = null;
      }
      setSilentSigningChecked(enabled);
      applySilentSigningEnabled(enabled);
    },
    [applySilentSigningEnabled],
  );

  const handleSilentSigningChange = useCallback(
    (enabled: boolean) => {
      setSilentSigningChecked(enabled);
      if (silentSigningRemountTimer.current) {
        clearTimeout(silentSigningRemountTimer.current);
      }
      // Debounced only so the switch thumb transition is not competing with the
      // re-render that applying it causes. Nothing is torn down any more, so the
      // delay could go — collapsing `silentSigningChecked` into the real value.
      silentSigningRemountTimer.current = setTimeout(() => {
        applySilentSigningEnabled(enabled);
        silentSigningRemountTimer.current = null;
      }, SILENT_SIGNING_REMOUNT_MS);
    },
    [applySilentSigningEnabled],
  );

  const requestPrivyLogin = useCallback(() => {
    clearPrivyRecentLoginMethod(FLUENT_CONNECT_PRIVY_APP_ID);
    setInlineLoginRequest((value) => value + 1);
  }, []);

  useEffect(() => {
    return () => {
      if (silentSigningRemountTimer.current) {
        clearTimeout(silentSigningRemountTimer.current);
      }
      // The widget itself is going, not just the keyed provider below it. A
      // settings read or an import still in flight would otherwise come back to
      // a widget that no longer exists, apply preferences, PUT tokens and clear
      // this browser's local key. This cleanup runs on real unmount only, which
      // is exactly the line between the two lifetimes.
      userSettings.current.controller?.reset();
    };
  }, []);

  return (
    <FluentWidgetNetworkProvider network={resolvedNetwork}>
      {/*
        Keep the external-wallet connection and query cache above a Privy
        restart. Quick sign changes rebuild neither provider.
      */}
      <ReownProvider
        network={resolvedNetwork}
        disableAnalytics={resolvedConfig.disableAnalytics}
        reconnectOnMount={resolvedConfig.reconnectOnMount}
      >
        <FluentPrivyProvider
          /**
           * Quick sign is deliberately absent. It used to be here because Privy
           * resolves `embeddedWallets.showWalletUIs` once per mount, so the only
           * way to change it was to build a new Privy — which tore down the
           * account, the settings in flight and the wallet connection with it.
           * The signers now name that flag per call, and this key is left with
           * what genuinely cannot change under one Privy: the chain.
           */
          key={resolvedNetwork}
          adapter={props.privyAdapter}
          appId={FLUENT_CONNECT_PRIVY_APP_ID}
          clientId={privyClientId}
          config={privyConfig}
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
          inlineLoginRequest={inlineLoginRequest}
          handledInlineLoginRequest={handledInlineLoginRequest}
          authTokenState={authTokenState}
          userSettingsRef={userSettings}
          connectedPresentation={connectedPresentation}
          appQueryClient={appQueryClient}
        />
        </FluentPrivyProvider>
      </ReownProvider>
    </FluentWidgetNetworkProvider>
  );
}
