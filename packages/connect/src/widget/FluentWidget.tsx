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
  createFluentConnectPrivyConfig,
  getFluentPrivyAppId,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentStoredSession,
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
import type { FluentTokenDefinition } from "../core/tokenDefinition";
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

/**
 * What the widget hands an App's own content: the Widget session, the Widget API, the External
 * wallet, and the calls that open the widget's screens, disconnect, mint an Auth token and link
 * X. `renderHome` and `renderPage` receive it, and `useFluentWidget()` returns it.
 */
export type FluentWidgetRenderContext = {
  /**
   * Who is signed in, or `null`: a `FluentWidgetSession`. Once `onSessionChange` has fired on
   * this page, equal to (not the same object as) the last value it received; a session restored
   * from storage is here before any callback. Connecting an External wallet neither writes nor
   * clears it; read the connected account from `widget.account`.
   */
  session: FluentWidgetSession | null;
  /** The Account avatar's linked X picture; absent for an External wallet or `forceDefault`. */
  userAvatarUrl?: string;
  /**
   * The display name of the person's linked X account, the name X shows above the handle, not
   * the handle. Absent when no X account is linked or X reports no name for it, and while an
   * External wallet is connected without a Fluent ID. `avatar.forceDefault` does not hide it.
   */
  userXDisplayName?: string;
  /**
   * The name on the Google account linked to the person's Direct login. Absent when none is
   * linked or Google reports no name for it, and while an External wallet is connected without a
   * Fluent ID. `avatar.forceDefault` does not hide it.
   */
  userGoogleName?: string;
  /**
   * The External wallet as the widget sees it, a `FluentExternalWalletState` whose inline
   * choices are `FluentWalletChoice`s, or `null`.
   *
   * @experimental May change or be removed in a minor release: a host that brings its own wallet
   * connection is not a 0.6.0 commitment.
   */
  wallet: FluentExternalWalletState | null;
  /** The Widget API: the account, Batch operations, signatures and the current Gas payment. */
  widget: FluentBatchApi;
  /**
   * Opens the sign-in dialog, the same one the connect button opens. A click event passed to it
   * is ignored, so it can be handed straight to `onClick`.
   */
  openConnect: () => void;
  /** Opens the account drawer, as the connect button does once a Widget account is connected. */
  openAccount: () => void;
  /**
   * Tear down the current session without going through the widget's account
   * menu — the same teardown that menu's "Disconnect" runs. The session and the
   * stored identity token are cleared before this resolves, so a host can await
   * it before resetting its own state.
   *
   * It also asks the service to revoke the Service session, and any Service session that a
   * `getAuthToken()` still out at the disconnect opens later, and resolves once those requests
   * have been answered or have failed, so it can take as long as that `getAuthToken()` does. A
   * failed revocation is not retried: the promise resolving does not prove the service ended
   * the Service session.
   */
  disconnect: () => Promise<void>;
  /**
   * Whether a Widget account, a Fluent ID or an External wallet, is connected now. `false`
   * while a stored session is still being restored: branch on `status` to tell that apart.
   */
  hasConnectedAccount: boolean;
  /**
   * Connection state as a single value that is meaningful on every render —
   * including the first, before a stored session has been reconciled. Branch on
   * this rather than on `hasConnectedAccount` alone: `"restoring"` and
   * `"disconnected"` both have `hasConnectedAccount === false`, and treating
   * them alike shows a Connect button to users who are already signed in. The
   * account's address is `widget.account.address`.
   */
  status: FluentWidgetStatus;
  /**
   * Refetch the widget's on-chain balances. Transactions run through
   * `widget.createBatchOp` refresh automatically; call this after a tx sent via
   * an External wallet client (outside the widget's execution path).
   */
  refreshBalances: () => void;
  /**
   * A short-lived (5 min) Auth token, a Fluent-signed JWT for the connected person. Verify it on
   * your backend against `<iss>/.well-known/jwks.json` (ES256), checking `iss`, `aud` (= your
   * appId) and `exp`; `sub` is stable per person per App. Reused until
   * `authTokenRenewalOffsetSeconds` before `exp`, then renewed; a renewal the service accepts
   * asks the wallet for nothing. When the wallet is asked to sign:
   * [guides/backend-auth.md](guides/backend-auth.md#renewal). External wallets: EOAs and deployed
   * smart-contract wallets sign in; a not-yet-deployed smart account cannot (no ERC-6492).
   *
   * @throws `FluentAuthError`, its `code` one of:
   * - `not_connected`: no Widget account is connected, or an External wallet has no client
   *   when the call has to sign the Sign-in challenge;
   * - `login_credential_missing`: a Fluent ID's login left no credential in the page;
   * - `origin_mismatch`: the Sign-in challenge names an origin other than the page's;
   * - `request_failed`: the request did not reach the service, its answer carried no code or no
   *   token, or the External wallet refused to sign the Sign-in challenge;
   * - `service_refused`: the service refused with a code this SDK does not name;
   * - a code the service answered with: `unknown_app`, `app_not_auth_enabled`,
   *   `origin_not_allowed`, `origin_missing`, `bad_request`, `challenge_unknown`,
   *   `challenge_used`, `challenge_expired`, `app_mismatch`, `invalid_signature`,
   *   `signature_prefix_rejected`, `address_already_linked`, `invalid_login_credential`,
   *   `no_signer`, `rate_limited` or `internal`.
   *
   * A refused refresh credential is not among them: the call forgets it and signs in again
   * within the same call, which can prompt the External wallet. Keep a `default` branch.
   */
  getAuthToken: () => Promise<string>;
  /**
   * Link an X account to the connected person, headless: no widget screen, no settings page,
   * one call. Idempotent and re-enterable, because linking X needs an OAuth round trip that
   * leaves the page.
   *
   * A person who already has X resolves `{ status: "linked", x }` without leaving the page. A
   * person who has none resolves `{ status: "redirecting" }` once the navigation to X has
   * started: the page is unloading, so nothing on it may wait for the link to finish. When the
   * browser comes back, `useLinkX()` calls `linkX()` again on mount, and it resolves `linked`;
   * nothing public tells a page that calls `linkX()` itself that it is a return from X.
   *
   * A link somebody else started in this tab, or a stale record of one, is discarded rather
   * than resumed: the call does no work and rejects with `link_failed`; call again to start one
   * for the signed-in person.
   *
   * An External wallet can be asked to sign before either result:
   * [guides/link-x.md](guides/link-x.md) says when.
   *
   * @throws `FluentAuthError`, whose codes today are `user_rejected`,
   * `linked_to_another_user`, `not_authenticated`, `bad_request` and `link_failed`; keep a
   * `default` branch for any code a later release adds.
   */
  linkX: () => Promise<FluentLinkXResult>;
};

/** What `renderConnectButton` receives to draw its own connect button. */
export type FluentWidgetConnectButtonRenderContext = {
  connected: boolean;
  /** True while a Fluent ID's smart account is being prepared after sign-in. */
  pending: boolean;
  addressLabel?: string;
  /** The Account avatar's linked X picture; absent for an External wallet or `forceDefault`. */
  userAvatarUrl?: string;
  /** The person's X display name, the render context's `userXDisplayName`. */
  userXDisplayName?: string;
  /** The person's Google name, the render context's `userGoogleName`. */
  userGoogleName?: string;
  onClick: () => void;
  openConnect: () => void;
  openAccount: () => void;
  DefaultButton: () => ReactNode;
};

/** The props of `<FluentWidget>`. */
export type FluentWidgetProps = {
  /**
   * An External wallet the host connects itself, a `FluentExternalWalletState` whose inline
   * choices are `FluentWalletChoice`s; omit it to let the widget connect one.
   *
   * @experimental May change or be removed in a minor release: a host that brings its own wallet
   * connection is not a 0.6.0 commitment.
   */
  wallet?: FluentExternalWalletState | null;
  config: FluentWidgetConfig;
  /**
   * Optional native Privy SDK bridge, a `FluentPrivyAdapter`, for a host that runs Privy's
   * native SDK; requires Direct login.
   *
   * @experimental May change or be removed in a minor release: the one provider seam of the
   * widget, kept for hosts that run a native login SDK.
   */
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
  /** Integrator tokens the widget lists beside its Default tokens; see `FluentTokenDefinition`. */
  tokens?: readonly FluentTokenDefinition[];
  /**
   * Print the widget's internal connect / smart-account / signing diagnostics to
   * the console, and show the debug panel in `mode="home"`. Off by default; turn
   * on only while debugging an integration.
   */
  debugLogging?: boolean;
  /**
   * Called each time the widget writes its stored session: with the new `FluentWidgetSession`
   * when a Fluent ID signs in by Direct login, and with `null` on a disconnect through the
   * widget. It is not called for a session restored from storage on mount, nor when an External
   * wallet connects; read the render context's `session` and `widget.account` for those.
   */
  onSessionChange?: (session: FluentWidgetSession | null) => void;
};

/**
 * The Fluent Connect widget: the connect button, the sign-in dialog, the account drawer and the
 * Widget API, provided to the App's own content rendered through `renderHome` or `renderPage`.
 *
 * @throws `FluentWidgetConfigError` from a render when `config` cannot be used, its `code`
 * `missing_option`, `invalid_option` or `removed_option` with the option named in its message,
 * or, for the experimental `execution`, `invalid_fee_source`, `invalid_receipt_source` or
 * `invalid_chain_check_before_sign`. The config is resolved again on every render that passes
 * a new `config` object, so such a render can throw too; keep `config` stable (a module
 * constant or a memo) to resolve it once.
 *
 * @example
 * ```tsx
 * import { FluentWidget, type FluentWidgetConfig } from "@fluent.xyz/connect";
 *
 * // The App's id, its login client and the Network: see the configuration guide.
 * declare const config: FluentWidgetConfig;
 *
 * export function App() {
 *   return <FluentWidget config={config} mode="page" renderPage={() => <main>Your App</main>} />;
 * }
 * ```
 */
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
  // The service of each network verifies a Privy token against its own Privy app, so the app
  // follows the network the way the client follows the App.
  const privyAppId = getFluentPrivyAppId(resolvedNetwork);

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

  const reportAnalyticsSession = useCallback((session: FluentStoredSession | null) => {
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

  // Drop last-used promotion before Privy's mount effect reads storage. Keyed on the app so
  // a network change runs it again before the Privy that `key={resolvedNetwork}` rebuilds
  // reads storage.
  useLayoutEffect(() => {
    clearPrivyRecentLoginMethod(privyAppId);
  }, [privyAppId]);

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
    clearPrivyRecentLoginMethod(privyAppId);
    setInlineLoginRequest((value) => value + 1);
  }, [privyAppId]);

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
          appId={privyAppId}
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
