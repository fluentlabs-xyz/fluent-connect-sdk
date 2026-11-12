import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";
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
import type { FluentExternalWalletState, FluentWidgetStatus } from "../core/types";
import type { FluentLinkXResult } from "../core/linkX";
import { clearPrivyRecentLoginMethod, hasStoredWidgetSession } from "../utils";
import type { FluentTokenDefinition } from "../core/tokenDefinition";
import { ReownProvider } from "./reownAppKit";
import { FluentWidgetNetworkProvider } from "./widgetNetworkContext";
import type { FluentBatchApi } from "./batchOperation";
import { FluentWidgetContent } from "./FluentWidgetContent";
import { setDebugLogging } from "../core/debugLogger";
import type { FluentGasTokenSymbol } from "../core/gasPayment";
import type { AuthTokenState } from "./hooks/useAuthToken";
import { createUserSettingsRefValue, type UserSettingsRef } from "./hooks/useUserSettings";
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
   * @experimental May change or be removed in a minor release: an App that brings its own wallet
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
   * Renders the drawer's Swap page, where a Deposit is made, as the App's own element: in a
   * modal or a page of its own, shown when the App decides. It is the page the drawer shows, on
   * both Networks and for either account kind, and it connects the External wallet that pays by
   * itself. `onClose` is called by the "Back to Home" button of a Two-step deposit's status
   * screen, so the App can close what it opened; no other screen of the page offers a way back,
   * which the App's own element provides.
   *
   * @experimental May change or be removed in a minor release: an App that draws the Swap page
   * itself is not a 0.8.0 commitment.
   */
  renderBridge: (onClose: () => void) => ReactNode;
  /**
   * Disconnects the Widget account, the same teardown the account menu's "Disconnect" runs. The
   * Widget session and the stored identity token are cleared before it resolves, so an App can
   * await it before resetting its own state.
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
   * The connection state as one value, meaningful on every render including the first, before a
   * stored session has been restored. Branch on it rather than on `hasConnectedAccount` alone:
   * `"restoring"` and `"disconnected"` both have `hasConnectedAccount === false`, and treating
   * them alike shows a Connect button to a person who is signed in. The account's address is
   * `widget.account.address`.
   */
  status: FluentWidgetStatus;
  /**
   * Refetches the widget's on-chain balances. A Batch operation run through
   * `widget.createBatchOp` refreshes them itself, and the account drawer reads them when it opens
   * and every 10 seconds while it stays open; call this to show a transaction sent through an
   * External wallet's own client, outside the widget, before the next read.
   */
  refreshBalances: () => void;
  /**
   * Returns a short-lived (5 min) Auth token, a Fluent-signed JWT for the connected person.
   * Verify it on your backend against `<iss>/.well-known/jwks.json` (ES256), checking `iss`,
   * `aud` (= your appId) and `exp`; `sub` is stable per person per App. Reused until
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
   * Links an X account to the connected person, headless: no widget screen, no settings page,
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
  /** Whether a Widget account is connected, the render context's `hasConnectedAccount`. */
  connected: boolean;
  /** `true` while a Fluent ID is signed in and its smart account is still being prepared. */
  pending: boolean;
  /**
   * The connected account's shortened address, or `"Connected"` while the address is not known;
   * absent while no Widget account is connected.
   */
  addressLabel?: string;
  /** The Account avatar's linked X picture; absent for an External wallet or `forceDefault`. */
  userAvatarUrl?: string;
  /** The person's X display name, the render context's `userXDisplayName`. */
  userXDisplayName?: string;
  /** The person's Google name, the render context's `userGoogleName`. */
  userGoogleName?: string;
  /** What the widget's own button does on a click: toggles the drawer or opens sign-in. */
  onClick: () => void;
  /** The render context's `openConnect`. */
  openConnect: () => void;
  /** The render context's `openAccount`. */
  openAccount: () => void;
  /** The widget's own connect button, to render inside a custom one or beside it. */
  DefaultButton: () => ReactNode;
};

/** The props of `<FluentWidget>`. */
export type FluentWidgetProps = {
  /**
   * An External wallet the App connects itself, a `FluentExternalWalletState` whose inline
   * choices are `FluentWalletChoice`s; omit it to let the widget connect one.
   *
   * @experimental May change or be removed in a minor release: an App that brings its own wallet
   * connection is not a 0.6.0 commitment.
   */
  wallet?: FluentExternalWalletState | null;
  /** The widget's configuration; keep the object stable, since a new one is resolved again. */
  config: FluentWidgetConfig;
  /**
   * Optional native Privy SDK bridge, a `FluentPrivyAdapter`, for an App that runs Privy's
   * native SDK; requires Direct login.
   *
   * @experimental May change or be removed in a minor release: the one provider seam of the
   * widget, kept for Apps that run a native login SDK.
   */
  privyAdapter?: FluentPrivyAdapter;
  /**
   * Which render prop the widget renders: `"home"` (the default) renders `renderHome`, `"page"`
   * renders `renderPage`. With `debugLogging` on, `"home"` also shows the debug panel.
   */
  mode?: "home" | "page";
  /**
   * Where the widget's own connect button goes.
   * - `"fixed"` (default): floating at the top right of the page.
   * - `"inline"`: the same button without fixed positioning, for the App's layout to place.
   * - `false`: hidden; use `renderConnectButton`, `openConnect` or `openAccount`.
   */
  connectButton?: "fixed" | "inline" | false;
  /**
   * A function that draws the App's own connect button in place of the widget's; when it returns
   * `null` or `undefined`, `connectButton` applies instead.
   */
  renderConnectButton?: (context: FluentWidgetConnectButtonRenderContext) => ReactNode;
  /** The App's content in `mode="home"`, given the render context. */
  renderHome?: (context: FluentWidgetRenderContext) => ReactNode;
  /** The App's content in `mode="page"`, given the render context. */
  renderPage?: (context: FluentWidgetRenderContext) => ReactNode;
  /** Integrator tokens the widget lists beside its Default tokens; see `FluentTokenDefinition`. */
  tokens?: readonly FluentTokenDefinition[];
  /**
   * Whether the widget prints its connect, smart-account and signing diagnostics to the console
   * and shows the debug panel in `mode="home"`. Off by default; turn it on only while debugging
   * an integration.
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
 * Renders on a server: the render context there is the `restoring` status with no session and
 * no wallet, and the real state arrives after hydration — see the getting-started guide's
 * server-side rendering section.
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
   * The App's own TanStack Query client, or `undefined` when it mounted none around the widget.
   * Read here because `ReownProvider` below mounts the widget's own client, and
   * `FluentWidgetContent` puts the App's back around its content. `useContext`, not
   * `useQueryClient`, which throws where no provider is.
   */
  const appQueryClient = useContext(QueryClientContext);

  const resolvedConfig = useMemo(() => resolveFluentWidgetConfig(props.config), [props.config]);

  const [silentSigningEnabled, setSilentSigningEnabled] = useState(
    FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  );
  // What the switch shows while the debounce below has not applied the change yet.
  const [silentSigningChecked, setSilentSigningChecked] = useState(
    FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  );
  const silentSigningRemountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inlineLoginRequest, setInlineLoginRequest] = useState(0);
  // Survives a `PrivyProvider` rebuild, so a consumed request cannot reopen login.
  const handledInlineLoginRequest = useRef(0);
  // The drawer and its tab survive a `PrivyProvider` rebuild.
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletMenuTab, setWalletMenuTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] = useState<FluentGasTokenSymbol>(
    resolvedConfig.gasPayment.defaultToken,
  );
  // Held above the keyed `PrivyProvider`, like the tracker below: a Network change rebuilds
  // everything under it, and the Auth token cache and the User settings state outlive that.
  const authTokenState = useRef<AuthTokenState>({ cache: null, inFlight: null });
  const userSettings = useRef<UserSettingsRef>(createUserSettingsRefValue());
  // Above the keyed `PrivyProvider` too. `FluentWidgetContent` writes the last connected
  // snapshot into it; nothing sets its `rebuilding` half.
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

  // Analytics lives above the keyed `PrivyProvider`, so a rebuild resets neither the tracker nor
  // the tab timer. Addresses exist only after login and the session lives in the inner
  // component, so the tracker reads this ref at send time.
  const analyticsContext = useRef<FluentAnalyticsContext>({});
  // Above the keyed `PrivyProvider` like the tracker, so a connect intent survives a rebuild.
  // `connected` mirrors wagmi, so a remount below cannot report one wallet twice.
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

  // Never hand `flushTabView` to addEventListener directly: the event object would arrive as
  // the options argument, and the flush would be queued and lost.
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
    [props.config?.assets?.fluentLogo, resolvedConfig.customOAuthRedirectUrl, resolvedNetwork],
  );

  // Clears Privy's last-used login method before Privy's mount effect reads it. Keyed on the
  // Privy app, so a Network change runs it again before the rebuilt Privy reads storage.
  useIsomorphicLayoutEffect(() => {
    clearPrivyRecentLoginMethod(privyAppId);
  }, [privyAppId]);

  /**
   * The one place `silentSigningEnabled` changes. It reaches signing through the signing mode
   * each call is given, not through Privy's config, so changing it rebuilds and remounts nothing.
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
      // Debounced so the switch's thumb transition does not compete with the re-render that
      // applying the value causes.
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
      // The widget itself is unmounting, not only the keyed provider below it: a User settings
      // read or a token import still in flight must not apply to a widget that is gone.
      userSettings.current.controller?.reset();
    };
  }, []);

  return (
    <FluentWidgetNetworkProvider network={resolvedNetwork}>
      {/* Keeps the External wallet connection and the query cache above a Privy rebuild. */}
      <ReownProvider
        network={resolvedNetwork}
        disableAnalytics={resolvedConfig.disableAnalytics}
        reconnectOnMount={resolvedConfig.reconnectOnMount}
      >
        <FluentPrivyProvider
          /**
           * Keyed on the Network alone: a Network change rebuilds Privy. Quick sign is not
           * part of the key; each signing call is given its mode.
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
