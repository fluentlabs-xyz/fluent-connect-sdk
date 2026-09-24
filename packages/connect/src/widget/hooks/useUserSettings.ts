import { getFluentDefaultWidgetGasTokens } from "@fluent.xyz/connect-sdk";
import { type MutableRefObject, useCallback, useEffect, useMemo, useState } from "react";

import {
  FLUENT_CONNECT_DEFAULT_SILENT_SIGNING,
  type FluentWidgetAuthMode,
} from "../../core/config";
import {
  FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
  type FluentGasTokenSymbol,
} from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { createFluentSettingsClient } from "../../core/settingsClient";
import {
  applyUserSettings,
  createUserSettingsController,
  isSettingsSubjectReady,
  resolveSettingsIdentities,
  resolveSettingsSubject,
  settingsAudienceKey,
  settlingHoldsSubject,
  type UserSettingsController,
  type UserSettingsPhase,
} from "../../core/userSettings";
import type { UserTokenStore } from "../../core/userTokens";
import { authTokenCacheKey } from "./useAuthToken";
import type { FluentAccountType } from "../batchOperation";

/**
 * The controller and the two error lines, in a box created above the
 * `PrivyProvider`. Toggling Quick sign remounts that provider, so a controller
 * created here would lose the read marker and re-read on every toggle.
 */
export type UserSettingsRef = {
  controller: UserSettingsController | null;
  preferenceError: string | null;
  tokenError: string | null;
};

export function createUserSettingsRefValue(): UserSettingsRef {
  return { controller: null, preferenceError: null, tokenError: null };
}

export function useUserSettings(params: {
  state: MutableRefObject<UserSettingsRef>;
  publicApiUrl: string;
  appId: string;
  authMode: FluentWidgetAuthMode;
  network: FluentWidgetNetwork;
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  identityToken: string | null;
  walletAddress?: string;
  hasWalletClient: boolean;
  /**
   * The account is neither confirmed nor ruled out — the widget's `connecting`
   * and `restoring` states. The subject reads as `null` through the rebuild that
   * applying Quick sign causes, and this is what tells that apart from a
   * disconnect.
   */
  settling: boolean;
  getAuthToken: () => Promise<string>;
  /** Applies Quick sign the way the account menu's toggle does, without its timer. */
  commitQuickSign: (enabled: boolean) => void;
  setGasPaymentToken: (symbol: FluentGasTokenSymbol) => void;
}) {
  const {
    state,
    publicApiUrl,
    appId,
    authMode,
    network,
    accountType,
    privyUserId,
    identityToken,
    walletAddress,
    hasWalletClient,
    settling,
    getAuthToken,
    commitQuickSign,
    setGasPaymentToken,
  } = params;

  const [, setRevision] = useState(0);
  const notify = useCallback(() => setRevision((value) => value + 1), []);

  if (!state.current.controller) {
    state.current.controller = createUserSettingsController({
      // What the widget preferred before anyone signed in, so a subject change
      // or a fallback state returns to it instead of keeping the last person's.
      defaults: { quickSign: FLUENT_CONNECT_DEFAULT_SILENT_SIGNING, gasTokenSymbol: null },
    });
  }
  const controller = state.current.controller;

  const gasTokenSymbols = useMemo(
    () => getFluentDefaultWidgetGasTokens(network).map((token) => token.symbol),
    [network],
  );

  const subject = useMemo(
    () => resolveSettingsSubject({ authMode, accountType, privyUserId, walletAddress }),
    [authMode, accountType, privyUserId, walletAddress],
  );
  const ready = useMemo(
    () =>
      isSettingsSubjectReady({ accountType, identityToken, walletAddress, hasWalletClient }),
    [accountType, hasWalletClient, identityToken, walletAddress],
  );
  // Only the presence of each input matters, and the identity token is a
  // credential: it must not end up in a React dep as a value we log or compare
  // character by character.
  const inputsKey = `${ready ? "1" : "0"}:${identityToken ? "1" : "0"}:${hasWalletClient ? "1" : "0"}`;

  const client = useMemo(() => {
    if (!subject || !publicApiUrl) return null;
    return createFluentSettingsClient({ publicApiUrl, getAuthToken });
  }, [getAuthToken, publicApiUrl, subject]);

  // Set during render, like `setDebugLogging` in `FluentWidget`: the controller
  // outlives this component, and a read completing between a remount's render
  // and its effects must reach the mount that is on screen, not the one that
  // just went away.
  controller.setHandlers({
    onChange: notify,
    onPreferenceError: (message) => {
      state.current.preferenceError = message;
      notify();
    },
    onTokenError: (message) => {
      state.current.tokenError = message;
      notify();
    },
    apply: (settings) =>
      applyUserSettings({
        settings,
        available: gasTokenSymbols,
        fallback: FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
        commitQuickSign,
        setGasTokenSymbol: setGasPaymentToken,
      }),
  });

  const subjectKey = subject ? authTokenCacheKey({ publicApiUrl, appId, subject }) : null;

  // The App and the service on their own. They are in every subject key, but a
  // render that can name nobody has no subject key at all — and a host that
  // re-renders the widget for another App while Privy is rehydrating produces
  // exactly that render. This is what the controller invalidates on then.
  const audience = useMemo(
    () => settingsAudienceKey({ publicApiUrl, appId }),
    [appId, publicApiUrl],
  );

  // Who the widget can name right now, whatever the smart account is doing.
  // Through the rebuild that applying Quick sign causes there is no subject, and
  // this is what says whose rebuild it is: the same person's, or nobody's yet,
  // or already somebody else's.
  const identities = useMemo(
    () => resolveSettingsIdentities({ authMode, privyUserId, walletAddress }),
    [authMode, privyUserId, walletAddress],
  );
  const knownSubjects = useMemo(
    () =>
      identities.map((identity) =>
        authTokenCacheKey({ publicApiUrl, appId, subject: identity }),
      ),
    [appId, identities, publicApiUrl],
  );

  useEffect(() => {
    controller.setTarget({
      subject: subjectKey,
      audience,
      client,
      ready,
      inputsKey,
      settling,
      knownSubjects,
    });
  }, [audience, client, controller, inputsKey, knownSubjects, ready, settling, subjectKey]);

  // `setTarget` runs in an effect, so for the render on which the account
  // changes the controller is still on the previous subject. Reading its phase
  // and its store then would show the person who just signed out: their token
  // list for a frame, and controls enabled over settings that are about to be
  // replaced. Until it has been told, treat a subject as loading.
  //
  // The same hold the controller applies, in what this render shows: through the
  // rebuild that applying Quick sign causes, the person is still signed in and
  // their remote token list is still the one to render. Falling back to the
  // local store for those frames would empty the menu and re-enable the
  // controls over settings that are still loading.
  const held = settlingHoldsSubject({
    next: { subject: subjectKey, settling, knownSubjects, audience },
    current: { subject: controller.getSubject(), audience: controller.getAudience() },
  });
  const synced = held || controller.getSubject() === subjectKey;
  const phase: UserSettingsPhase = synced
    ? controller.getPhase()
    : subjectKey
      ? "loading"
      : "unavailable";
  const userTokenStore: UserTokenStore = synced
    ? controller.getStore()
    : controller.getLocalStore();

  const onQuickSignChange = useCallback(
    (enabled: boolean) => {
      void controller.setQuickSign(enabled);
    },
    [controller],
  );

  const onGasTokenChange = useCallback(
    (symbol: FluentGasTokenSymbol) => {
      void controller.setGasTokenSymbol(symbol);
    },
    [controller],
  );

  return {
    userTokenStore,
    phase,
    /**
     * True while a person's settings are on their way: the Settings controls
     * and the token actions stay disabled so the answer cannot overwrite a
     * choice made while it was in flight.
     */
    settingsPending: phase === "idle" || phase === "loading",
    preferenceError: state.current.preferenceError,
    tokenError: state.current.tokenError,
    onQuickSignChange,
    onGasTokenChange,
  };
}
