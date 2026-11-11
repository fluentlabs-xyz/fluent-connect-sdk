import type { StorageLike } from "@fluent.xyz/connect-sdk";

import { FluentAuthError } from "./authToken";
import type { FluentAccountType } from "../widget/batchOperation";
import {
  FluentSettingsError,
  type FluentSettingsClient,
  type FluentUserSettings,
  type FluentUserSettingsPatch,
} from "./settingsClient";
import {
  createFluentUserTokenStore,
  resolveUserTokenStorage,
  type UserTokenStore,
} from "./userTokens";
import { createFluentBackendUserTokenStore, type BackendUserTokenStore } from "./userTokensBackend";
import { importLocalUserTokensOnce } from "./userTokensImport";

/**
 * The state of a person's User settings read.
 *
 * `idle` — a person is signed in but their auth inputs are not ready yet, or a
 * read failed for want of them and is retried when they arrive.
 * `loading` — a read is in flight; the Settings controls and the token actions
 * stay disabled so an initial answer cannot overwrite a later choice.
 * `ready` — the service's values are applied and its token list is the store.
 * `unavailable` — no Auth token can exist for this state, or the read failed
 * for a reason waiting cannot fix: the localStorage token store and whatever
 * preferences are already on screen stand. A read that fails this way changes
 * no preference and reports itself on the Settings card, unless the service has
 * no settings routes. The controls stay enabled under it, and a preference
 * changed from there is written back like any other — the service is the only
 * place it can be kept.
 */
export type UserSettingsPhase = "idle" | "loading" | "ready" | "unavailable";

/**
 * Returns the key of who an Auth token is minted for, whoever presents it: one
 * App, at one service. `authTokenCacheKey` is this key followed by the subject,
 * so a subject key and its audience agree by construction.
 *
 * Both fields come from the widget's configuration alone, so the audience is
 * known on every render, and a change to it can invalidate a read in flight
 * while the widget cannot yet name a single person.
 */
export function settingsAudienceKey(params: { publicApiUrl: string; appId: string }): string {
  return `${params.publicApiUrl}|${params.appId}`;
}

/**
 * Returns the name the widget caches this person's settings under, from the
 * same facts `requestAuthToken` branches on, or `null` where no Auth token can
 * exist and `getAuthToken()` cannot resolve: the not-connected state.
 */
export function resolveSettingsSubject(params: {
  accountType: FluentAccountType | undefined;
  privyUserId?: string;
  walletAddress?: string;
}): string | null {
  const { accountType, privyUserId, walletAddress } = params;
  if (accountType === "smart" && privyUserId) return `privy:${privyUserId}`;
  if (accountType === "eoa" && walletAddress) return `wallet:${walletAddress.toLowerCase()}`;
  return null;
}

/**
 * Returns every subject the person the widget can already name might resolve
 * to, once the smart account settles one way or the other.
 *
 * `resolveSettingsSubject` needs `accountType`, which exists only once the smart
 * account is ready; until then the subject is `null` for everyone alike. This
 * needs only the Privy user id and the wallet address, so it tells "this
 * person's account is coming back" from "this is somebody else". An empty list
 * means the widget cannot name anyone yet, not that nobody is there.
 */
export function resolveSettingsIdentities(params: {
  privyUserId?: string;
  walletAddress?: string;
}): string[] {
  const { privyUserId, walletAddress } = params;
  const identities: string[] = [];
  if (privyUserId) identities.push(`privy:${privyUserId}`);
  if (walletAddress) identities.push(`wallet:${walletAddress.toLowerCase()}`);
  return identities;
}

/**
 * Reports whether a `null` subject means "not yet" for the person whose
 * settings are already held, rather than "gone".
 *
 * While a known person's account is on its way in (the `connecting` and
 * `restoring` states, or a Fluent ID whose smart account initialization is
 * retried), there is no ready account and so no subject. Holding that person's
 * snapshot across the window keeps the widget from reading again. The grace is
 * theirs alone: as soon as the widget can name somebody, and that name is not
 * the held one, the account has changed and the held work — a pending read, its
 * apply, its import — belongs to nobody.
 *
 * The audience ends the grace too, and earlier than any name can. A read in
 * flight carries a token minted for one App at one service; under another App
 * or another service it describes somebody else's row, whatever Privy settles
 * on. That is the only thing the widget still knows while the identity list is
 * empty, so it is checked before the empty list is read as "not yet".
 */
export function settlingHoldsSubject(params: {
  next: Pick<UserSettingsTarget, "subject" | "settling" | "knownSubjects" | "audience">;
  /** The subject, and the audience, the controller is holding settings for. */
  current: { subject: string | null; audience: string | null };
}): boolean {
  const { next, current } = params;
  if (next.subject || !next.settling || !current.subject) return false;
  if (next.audience !== current.audience) return false;
  const known = next.knownSubjects;
  if (!known || known.length === 0) return true;
  return known.includes(current.subject);
}

/**
 * Reports whether the inputs `requestAuthToken` needs for this subject are in
 * hand. A read fired before them costs the user a pointless failure — and, for
 * an External wallet, would ask for a signature the wallet cannot yet give.
 */
export function isSettingsSubjectReady(params: {
  accountType: FluentAccountType | undefined;
  identityToken?: string | null;
  walletAddress?: string;
  hasWalletClient?: boolean;
}): boolean {
  if (params.accountType === "smart") return Boolean(params.identityToken);
  if (params.accountType === "eoa") {
    return Boolean(params.walletAddress) && Boolean(params.hasWalletClient);
  }
  return false;
}

/**
 * Reports whether Quick sign and the Gas token are this account's to keep.
 *
 * Both describe a Fluent ID and nothing else: Quick sign decides whether the
 * widget shows its Review, and the Gas token decides what the paymaster is
 * charged. An External wallet confirms every call in the wallet itself and
 * pays the chain's own currency (`sendCallsViaExternalWallet`), so a stored
 * value for either one describes nothing it does — applying one would move a
 * control that changes nothing, and writing one would overwrite the value the
 * same person's Fluent ID keeps, since the service resolves both sessions to
 * one person and cannot tell them apart.
 *
 * Their User tokens are untouched by this: that list is the account's own, it
 * rides on the same `GET /me/settings`, and it is loaded and written for every
 * account kind. An account the widget cannot yet name keeps the preferences; with no
 * subject there is nothing to apply them to or to write them for anyway.
 */
export function keepsSettingsPreferences(params: {
  accountType: FluentAccountType | undefined;
}): boolean {
  return params.accountType !== "eoa";
}

/**
 * Returns the Gas token to use for a stored symbol: `fallback` when the person
 * never chose one. A symbol outside this network's closed Gas token set falls
 * back the same way: Gas tokens are Default tokens (ADR 0001), and a symbol from
 * another network, or a stale one, must not reach a Batch operation.
 */
export function resolveGasTokenSymbol(params: {
  stored: string | null | undefined;
  available: readonly string[];
  fallback: string;
}): string {
  const { stored, available, fallback } = params;
  if (typeof stored !== "string" || stored.length === 0) return fallback;
  // Case-insensitive to agree with `getFluentGasTokenAddress`, which uppercases
  // before matching; the canonical spelling comes from the set, not the row.
  const wanted = stored.toUpperCase();
  return available.find((symbol) => symbol.toUpperCase() === wanted) ?? fallback;
}

/**
 * Applies a person's stored Quick sign and Gas token through two callbacks.
 *
 * The callbacks are the whole write surface: the session, its storage key and
 * the identity token are not reachable from here, so applying a stored
 * `quickSign: false` after sign-in looks like the user flicking the switch
 * themselves, not like a second login.
 */
export function applyUserSettings(params: {
  settings: { quickSign: boolean; gasTokenSymbol: string | null };
  /** This network's Gas token symbols, closed (`getFluentDefaultWidgetGasTokens`). */
  available: readonly string[];
  fallback: string;
  commitQuickSign: (enabled: boolean) => void;
  setGasTokenSymbol: (symbol: string) => void;
}): void {
  params.commitQuickSign(params.settings.quickSign);
  params.setGasTokenSymbol(
    resolveGasTokenSymbol({
      stored: params.settings.gasTokenSymbol,
      available: params.available,
      fallback: params.fallback,
    }),
  );
}

export type UserSettingsHandlers = {
  /** The two preferences, applied through the widget's existing paths. */
  apply(settings: { quickSign: boolean; gasTokenSymbol: string | null }): void;
  /** The Settings card's status line; `null` clears a stale message. */
  onPreferenceError(message: string | null): void;
  /** The token list's error line; `null` clears a stale message. */
  onTokenError(message: string | null): void;
  /** Something the React wrapper renders changed. */
  onChange(): void;
};

export type UserSettingsTarget = {
  /**
   * `(publicApiUrl, appId, subject)` — the same tuple `useAuthToken` caches a
   * token under, so an App or a service change invalidates this too. `null`
   * where no Auth token can exist.
   */
  subject: string | null;
  /**
   * `(publicApiUrl, appId)` from `settingsAudienceKey` — the prefix `subject`
   * itself carries. It is known from the configuration alone, never from Privy
   * or from a ready smart account, so it is on every target, including the ones
   * with no subject at all; a change to it invalidates the generation even
   * while the widget can name nobody.
   */
  audience: string;
  client: FluentSettingsClient | null;
  ready: boolean;
  /**
   * The account is neither confirmed nor ruled out: the `connecting` and
   * `restoring` states, or a Fluent ID whose smart account is not ready yet, as
   * on page load or while a failed initialization is retried. A `null` subject
   * then means "not yet", not "gone", and the controller holds this
   * person's snapshot, loaded token list and read marker across it instead of
   * reading again.
   */
  settling?: boolean;
  /**
   * Every subject the identity the widget can already name could resolve to,
   * keyed exactly like `subject`, from `resolveSettingsIdentities`. It is known
   * while the smart account is not ready, when `subject` is not, so `settling`
   * only holds the current person's work while nothing here contradicts it.
   * Empty means the widget cannot name anybody yet.
   */
  knownSubjects?: readonly string[];
  /**
   * A fingerprint of the auth inputs. A read that failed for want of them is
   * retried when it changes, without waiting for a different subject.
   */
  inputsKey: string;
  /**
   * Whether this subject's Quick sign and Gas token are the widget's to apply
   * and to write, from `keepsSettingsPreferences`. An External wallet's are
   * not: its read still brings its token list, and that list is still written,
   * but neither preference is applied from the answer or sent in a `PATCH`.
   * Absent means they are, for a caller that names no account kind.
   */
  keepsPreferences?: boolean;
};

export type UserSettingsController = {
  getPhase(): UserSettingsPhase;
  getSubject(): string | null;
  /** The App and the service the current generation belongs to. */
  getAudience(): string | null;
  /** The backend store once the read landed, the localStorage one otherwise. */
  getStore(): UserTokenStore;
  /**
   * The localStorage store on its own. A caller whose subject the controller
   * has not been told about yet must not be handed the previous subject's
   * backend store, which still holds that person's list.
   */
  getLocalStore(): UserTokenStore;
  /** The settings the service last answered with, for tests and diagnostics. */
  getSettings(): FluentUserSettings | null;
  setHandlers(handlers: Partial<UserSettingsHandlers>): void;
  setTarget(target: UserSettingsTarget): void;
  setQuickSign(enabled: boolean): Promise<void>;
  setGasTokenSymbol(symbol: string): Promise<void>;
  reset(): void;
};

/** Failures that only say "not yet": retried when the inputs arrive. */
function isPendingInputFailure(err: unknown) {
  return (
    err instanceof FluentAuthError &&
    (err.code === "not_connected" || err.code === "login_credential_missing")
  );
}

/**
 * Reports whether the service this widget points at has no settings routes: a
 * `404` with no service code behind it, which is what a route the deployment
 * never had answers. Not a failure of anything the person did or can wait for.
 */
function isUnsupportedByService(err: unknown) {
  return (
    (err instanceof FluentSettingsError || err instanceof FluentAuthError) &&
    err.code === "request_failed" &&
    err.status === 404
  );
}

function messageOf(err: unknown) {
  if (err instanceof FluentSettingsError || err instanceof FluentAuthError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach Fluent Connect.";
}

/**
 * Reads the person's settings once per subject, applies them, carries this
 * browser's local token list over once, and writes every later change back.
 *
 * No React: the widget keeps it in a ref above the keyed `PrivyProvider`, so it
 * outlives the rebuild a Network change causes, and holds the read marker, the
 * snapshot, the phase and the backend store's loaded list across the `settling`
 * window. Every completion is bound to the generation it started in, so an
 * answer for a disconnected account applies nothing.
 */
export function createUserSettingsController(options?: {
  /** `null` disables the local token store's persistence entirely. */
  storage?: StorageLike | null;
  storageKey?: string;
  importMarkerKey?: string;
  createLocalStore?: () => UserTokenStore;
  handlers?: Partial<UserSettingsHandlers>;
  /**
   * What the widget preferred before any person signed in. Applied whenever the
   * subject changes, so one person's Quick sign and Gas token never carry into
   * the next person's session or into the localStorage fallback. A read that
   * fails afterwards does not re-apply them: by then the only values they could
   * overwrite are this person's own choices.
   */
  defaults?: { quickSign: boolean; gasTokenSymbol: string | null };
}): UserSettingsController {
  const noop = () => {};
  let handlers: UserSettingsHandlers = {
    apply: noop,
    onPreferenceError: noop,
    onTokenError: noop,
    onChange: noop,
    ...options?.handlers,
  };

  const defaults = options?.defaults ?? { quickSign: true, gasTokenSymbol: null };
  const storage = options?.storage !== undefined ? options.storage : resolveUserTokenStorage();
  const localStore =
    options?.createLocalStore?.() ??
    createFluentUserTokenStore(storage ? { storage, key: options?.storageKey } : undefined);

  let generation = 0;
  let subject: string | null = null;
  let audience: string | null = null;
  let client: FluentSettingsClient | null = null;
  let ready = false;
  let inputsKey = "";
  /** Whether the current subject's two preferences are applied and written. */
  let keepsPreferences = true;
  let attemptedInputsKey: string | null = null;
  let phase: UserSettingsPhase = "unavailable";
  let backend: BackendUserTokenStore | null = null;
  let settings: FluentUserSettings | null = null;

  /** The latest value the user chose for each preference, not yet acknowledged. */
  let desired: FluentUserSettingsPatch = {};
  let flushing: Promise<void> | null = null;

  const startRead = () => {
    const activeClient = client;
    if (!activeClient || !subject) return;
    const gen = generation;
    attemptedInputsKey = inputsKey;
    phase = "loading";
    handlers.onChange();

    void (async () => {
      let answer: FluentUserSettings;
      try {
        answer = await activeClient.read();
      } catch (err) {
        if (gen !== generation) return;
        // Nothing is thrown to the host. A failure that only says "not yet"
        // stays silent: the read is retried when the inputs arrive, and what the
        // widget already shows is still the right thing to show.
        if (isPendingInputFailure(err)) {
          phase = "idle";
          handlers.onChange();
          return;
        }
        // A service without the routes: the defaults and the localStorage store
        // are the whole story there, and "Request failed with 404" would name a
        // problem no action of the person's can clear.
        if (isUnsupportedByService(err)) {
          phase = "unavailable";
          handlers.onPreferenceError(null);
          handlers.onChange();
          return;
        }
        // A failure waiting cannot fix: the localStorage store takes over and the
        // person is told, but no preference moves. The defaults were applied when
        // this subject arrived; applying them again could only undo a later choice.
        phase = "unavailable";
        handlers.onPreferenceError(messageOf(err));
        handlers.onChange();
        return;
      }
      if (gen !== generation) return;

      settings = answer;
      const store = createFluentBackendUserTokenStore({
        client: activeClient,
        load: async () => answer.tokens,
        onRemoveError: (message) => {
          if (gen === generation) handlers.onTokenError(message);
        },
      });
      store.prime(answer.tokens);
      backend = store;

      handlers.onPreferenceError(null);
      handlers.onTokenError(null);
      // The row may hold the Quick sign and Gas token of this person's Fluent ID,
      // which describe nothing an External wallet does. The token list in the
      // same answer is its own, and is taken either way.
      if (keepsPreferences) {
        handlers.apply({ quickSign: answer.quickSign, gasTokenSymbol: answer.gasTokenSymbol });
      }

      // Before `ready`, so the list the menu first shows already holds whatever
      // this browser carried over, and the user cannot add to a store that is
      // about to be replaced underneath them.
      await importLocalUserTokensOnce({
        storage,
        key: options?.storageKey,
        markerKey: options?.importMarkerKey,
        backend: store,
        owner: subject,
        remoteTokens: answer.tokens,
        shouldContinue: () => gen === generation,
      });
      if (gen !== generation) return;

      phase = "ready";
      handlers.onChange();
    })();
  };

  const queuePatch = (patch: FluentUserSettingsPatch): Promise<void> => {
    const activeClient = client;
    if (!activeClient || !subject) return Promise.resolve();
    // Both callers are a preference, so an External wallet sends no
    // `PATCH /me/settings` from any path, the `unavailable` phase included.
    if (!keepsPreferences) return Promise.resolve();
    // Only a read still on its way silences a write: its answer would overwrite
    // the choice. Under `unavailable` the controls are enabled, and a change made
    // there is the person's own and kept nowhere else, so it is written.
    if (phase === "idle" || phase === "loading") return Promise.resolve();
    const gen = generation;
    desired = { ...desired, ...patch };
    handlers.onPreferenceError(null);
    if (flushing) return flushing;

    flushing = (async () => {
      try {
        // One request at a time, always carrying the latest choice: two toggles
        // in a row must not race, and the value that lands last must be the one
        // the user picked last.
        while (Object.keys(desired).length > 0) {
          if (gen !== generation) return;
          const next = desired;
          desired = {};
          try {
            const answer = await activeClient.patch(next);
            // The answer describes the person this run started for. Publishing
            // it after a subject change would show one person's preferences
            // under another's name.
            if (gen !== generation) return;
            settings = answer;
          } catch (err) {
            if (gen !== generation) return;
            handlers.onPreferenceError(messageOf(err));
          }
        }
      } finally {
        // Only the current generation's run owns the guard. An older run
        // clearing it would let the new subject start a second concurrent
        // PATCH, and then the later choice could land before the earlier one.
        if (gen === generation) flushing = null;
      }
    })();
    return flushing;
  };

  const invalidate = () => {
    generation += 1;
    backend = null;
    settings = null;
    desired = {};
    flushing = null;
    attemptedInputsKey = null;
  };

  return {
    getPhase: () => phase,
    getSubject: () => subject,
    getAudience: () => audience,
    getSettings: () => settings,
    getStore: () => (phase === "ready" && backend ? backend : localStore),
    getLocalStore: () => localStore,

    setHandlers(next) {
      handlers = { ...handlers, ...next };
    },

    setTarget(next) {
      // The account is on its way back, not gone: keep this person's state while
      // nobody else is named and the audience stays; otherwise this generation
      // ends here, before its read can complete into the new person's session.
      if (settlingHoldsSubject({ next, current: { subject, audience } })) return;

      // Carried alongside the subject, and on every path: a target that names
      // nobody still says which App and which service this widget is for.
      audience = next.audience;
      // On every path too, and never from inside the settling hold above: the
      // settling window reports no account kind, and the generation it holds
      // belongs to the account kind that started it.
      keepsPreferences = next.keepsPreferences ?? true;

      if (next.subject !== subject) {
        invalidate();
        subject = next.subject;
        client = next.client;
        ready = next.ready;
        inputsKey = next.inputsKey;
        phase = subject ? "idle" : "unavailable";
        // Another person, or nobody: back to what the widget preferred before
        // anyone signed in. The read that follows overwrites these with this
        // person's own, and a read that never lands leaves them standing.
        handlers.apply(defaults);
        handlers.onPreferenceError(null);
        handlers.onTokenError(null);
        handlers.onChange();
        if (subject && ready && client) startRead();
        return;
      }

      client = next.client;
      ready = next.ready;
      const inputsChanged = next.inputsKey !== inputsKey;
      inputsKey = next.inputsKey;
      if (phase !== "idle" || !ready || !client) return;
      if (attemptedInputsKey !== null && !inputsChanged) return;
      startRead();
    },

    setQuickSign(enabled) {
      return queuePatch({ quickSign: enabled });
    },

    setGasTokenSymbol(symbol) {
      return queuePatch({ gasTokenSymbol: symbol });
    },

    reset() {
      invalidate();
      subject = null;
      audience = null;
      client = null;
      ready = false;
      inputsKey = "";
      keepsPreferences = true;
      phase = "unavailable";
      // No `apply` here: `reset` is teardown, and there is nothing left to apply
      // the defaults to. A widget that is still on screen returns to them
      // through `setTarget`, which is where a subject changes.
      handlers.onPreferenceError(null);
      handlers.onTokenError(null);
      handlers.onChange();
    },
  };
}
