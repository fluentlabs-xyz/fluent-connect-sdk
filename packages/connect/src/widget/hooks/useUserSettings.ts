import { getFluentDefaultWidgetGasTokens } from "@fluent.xyz/connect-sdk";
import { type MutableRefObject, useCallback, useEffect, useMemo, useState } from "react";

import { FLUENT_CONNECT_DEFAULT_SILENT_SIGNING } from "../../core/config";
import { FLUENT_WIDGET_DEFAULT_GAS_TOKEN, type FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { createFluentSettingsClient } from "../../core/settingsClient";
import {
  applyUserSettings,
  createUserSettingsController,
  isSettingsSubjectReady,
  keepsSettingsPreferences,
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
 * The controller and the two error lines, in a box created above the keyed
 * `PrivyProvider`, so they outlive the rebuild a Network change causes.
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
  network: FluentWidgetNetwork;
  defaultGasToken?: FluentGasTokenSymbol;
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  identityToken: string | null;
  walletAddress?: string;
  hasWalletClient: boolean;
  /**
   * The account is neither confirmed nor ruled out — the widget's `connecting`
   * and `restoring` states, and a Fluent ID whose smart account is not ready
   * yet, as on page load or while a failed initialization is retried. The
   * subject reads as `null` through such a window, and this is what tells it
   * apart from a disconnect.
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
    network,
    defaultGasToken = FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
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
    () => resolveSettingsSubject({ accountType, privyUserId, walletAddress }),
    [accountType, privyUserId, walletAddress],
  );
  const ready = useMemo(
    () => isSettingsSubjectReady({ accountType, identityToken, walletAddress, hasWalletClient }),
    [accountType, hasWalletClient, identityToken, walletAddress],
  );
  // From the same `accountType` the subject itself is resolved from, so the two
  // can never disagree about whose preferences a generation is holding.
  const keepsPreferences = keepsSettingsPreferences({ accountType });
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
  // and its effects must reach the mount on screen, not the one that went away.
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
        fallback: defaultGasToken,
        commitQuickSign,
        setGasTokenSymbol: setGasPaymentToken,
      }),
  });

  const subjectKey = subject ? authTokenCacheKey({ publicApiUrl, appId, subject }) : null;

  // The App and the service on their own: they are in every subject key, but a
  // render that names nobody, as while Privy rehydrates, has none, and the
  // controller invalidates on this then.
  const audience = useMemo(
    () => settingsAudienceKey({ publicApiUrl, appId }),
    [appId, publicApiUrl],
  );

  // Who the widget can name right now, whatever the smart account is doing. In
  // the `settling` window there is no subject, and this says whose window it is:
  // the same person's, nobody's yet, or already somebody else's.
  const identities = useMemo(
    () => resolveSettingsIdentities({ privyUserId, walletAddress }),
    [privyUserId, walletAddress],
  );
  const knownSubjects = useMemo(
    () =>
      identities.map((identity) => authTokenCacheKey({ publicApiUrl, appId, subject: identity })),
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
      keepsPreferences,
    });
  }, [
    audience,
    client,
    controller,
    inputsKey,
    keepsPreferences,
    knownSubjects,
    ready,
    settling,
    subjectKey,
  ]);

  // `setTarget` runs in an effect, so on the render where the account changes
  // the controller still holds the previous person's phase and store. Until it
  // has been told, a subject reads as loading.
  //
  // Through the `settling` window the controller's hold applies here too, so the
  // menu keeps the person's remote token list and the controller's phase.
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
