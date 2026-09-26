import { useMemo } from "react";
import type { Address } from "viem";

import type { FluentWidgetStatus } from "../../core/types";
import type { FluentAccountType, FluentWidgetAccount } from "../batchOperation";

/**
 * Why a hosted session cannot send from this page. Hosted login leaves the Privy
 * credentials on the Fluent origin, and the widget reaches them through the Fluent
 * popup — but only for a session that names its Signer. One that does not (an
 * authorize page that predates the field, or a hand-built session) has nothing to
 * ask, and the initializer skips it as `signer unavailable`.
 */
export const HOSTED_SIGNER_MISSING_MESSAGE =
  "This Fluent session names no signer, so it cannot send from this page. Reconnect with Fluent ID, or use a connected external wallet.";

/** Smart-account fields the derivation reads (subset of `useFluentZeroDevAccount`). */
export type WidgetSmartAccountState = {
  smartAccountReady: boolean;
  /** A Signer in the Fluent popup can sign for the session's Fluent ID (hosted login). */
  hostedSignerAvailable: boolean;
  smartAccountAddress?: Address;
  signerAddress?: Address;
  error?: Error | null;
  privyReady: boolean;
  privyAuthenticated: boolean;
  embeddedWalletCount: number;
};

/** External wallet (EOA) fields the derivation reads. */
export type WidgetExternalWalletSnapshot = {
  connected: boolean;
  address?: string;
  hasWalletClient: boolean;
  reconnecting?: boolean;
};

export type DeriveWidgetAccountInput = {
  smartAccount: WidgetSmartAccountState;
  wallet: WidgetExternalWalletSnapshot | null;
  sessionUserId?: string;
  sessionSmartAccountAddress?: string;
  /** Direct auth (in-app Privy) vs hosted popup — changes readiness rules. */
  directAuth: boolean;
};

export type DerivedWidgetAccount = {
  widgetAccount: FluentWidgetAccount;
  fluentAccountAddress?: string;
  connectedAddress?: string;
  accountMenuAddress?: string;
  /**
   * `accountMenuAddress` is the External wallet's, not the Fluent ID's. Anything
   * else the menu shows about "this account" — the avatar above all — has to
   * follow the same account, or the header names one account and pictures
   * another.
   */
  accountMenuIsExternalWallet: boolean;
  fluentAccountReady: boolean;
  /**
   * The Fluent ID can execute: its kernel is built, or a hosted Signer will build it
   * on demand. What execution routes on — `fluentAccountReady` alone would send a
   * hosted session down the External-wallet path.
   */
  fluentExecutionReady: boolean;
  hasConnectedAccount: boolean;
  connecting: boolean;
  status: FluentWidgetStatus;
  /** A hosted session with no Signer to ask — see {@link HOSTED_SIGNER_MISSING_MESSAGE}. */
  hostedSignerMissing: boolean;
};

/**
 * Pure derivation of the widget's account model from the smart account, the
 * external wallet, and the stored session. Kept free of React so the readiness
 * rules (`hasConnectedAccount` / `connecting` / `widgetAccount`) are unit-testable
 * without a DOM. `useWidgetAccount` is the memoized hook wrapper.
 */
export function deriveWidgetAccount(input: DeriveWidgetAccountInput): DerivedWidgetAccount {
  const { smartAccount, wallet, sessionUserId, sessionSmartAccountAddress, directAuth } = input;

  const fluentAccountAddress = smartAccount.smartAccountAddress ?? sessionSmartAccountAddress;
  const connectedAddress =
    wallet?.connected && wallet.address ? wallet.address : fluentAccountAddress;
  const accountMenuIsExternalWallet = Boolean(wallet?.connected);
  const accountMenuAddress = accountMenuIsExternalWallet
    ? connectedAddress
    : fluentAccountAddress;

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
    wallet?.connected ||
      (directAuth ? fluentAccountReady : sessionUserId || sessionSmartAccountAddress),
  );
  // Direct auth: Privy signs in fast, but the ZeroDev smart account takes a few
  // seconds to become ready. Surface that window so the button can show pending.
  const connecting = Boolean(
    !hasConnectedAccount && directAuth && smartAccount.privyAuthenticated && !smartAccount.error,
  );

  // The window where a returning user's session is neither confirmed nor ruled
  // out. Hosts that collapse this into "disconnected" flash a Connect button at
  // signed-in users, which is the whole reason this is reported separately.
  //
  // Deliberately keyed on signals that always resolve, never on "a stored session
  // exists": a stale session with Privy settled and unauthenticated would pin the
  // status to "restoring" forever. Once `privyReady` is true and the user is not
  // authenticated, there is no direct-auth session to wait for, whatever
  // localStorage still holds. Hosted auth needs no window at all — its session is
  // hydrated synchronously, so it is already `hasConnectedAccount` on first render.
  const restoring = Boolean(
    !hasConnectedAccount &&
      !connecting &&
      !smartAccount.error &&
      ((directAuth && !smartAccount.privyReady) || wallet?.reconnecting),
  );

  const status: FluentWidgetStatus = hasConnectedAccount
    ? "connected"
    : connecting
      ? "connecting"
      : restoring
        ? "restoring"
        : "disconnected";

  // Hosted login: the Signer sits behind the Fluent popup, and building the kernel
  // needs only its address, so the session can send as soon as it names the signer.
  // The initializer builds the kernel on load and `sendCalls` on demand; neither is
  // something the host should have to wait for. Not behind `smartAccountReady` for
  // that reason, but behind a real error, which is the better explanation.
  const hostedSignerReady = Boolean(
    !directAuth &&
      smartAccount.hostedSignerAvailable &&
      fluentAccountAddress &&
      !smartAccount.error,
  );
  const fluentExecutionReady = fluentAccountReady || hostedSignerReady;

  // Smart account (Fluent ID) takes precedence; otherwise a connected external
  // EOA (MetaMask) can also execute — just without AA perks.
  const externalReady = Boolean(wallet?.connected && wallet.hasWalletClient);
  const type: FluentAccountType | undefined = fluentExecutionReady
    ? "smart"
    : wallet?.connected
      ? "eoa"
      : undefined;
  const executionReady = fluentExecutionReady || externalReady;
  // `connected` answers "is a user signed in", `executionStatus` answers "can it
  // send". A hosted session is where the two differ, and deriving `connected`
  // from execution reported "disconnected" for an account `status` called connected.
  const connected = hasConnectedAccount;

  // A hosted session with no Signer anywhere: none in the popup (the session names
  // no signer address) and none on this page (Privy is not signed in here, which it
  // only is for an App on the Fluent origin). Name the reason on the account:
  // without it a host sees "unavailable" and nothing else. Held back while Privy is
  // still settling and while a local Signer initializes the Fluent ID, both of which
  // resolve on their own, and behind a real error, which is the better explanation.
  const hostedSignerMissing = Boolean(
    !directAuth &&
      hasConnectedAccount &&
      !wallet?.connected &&
      !fluentExecutionReady &&
      smartAccount.privyReady &&
      !localPrivySignerReady &&
      !smartAccount.error,
  );

  const widgetAccount: FluentWidgetAccount = {
    address: (smartAccount.smartAccountAddress ?? fluentAccountAddress ?? connectedAddress) as
      | Address
      | undefined,
    signerAddress: smartAccount.signerAddress,
    connected,
    executionReady,
    type,
    capabilities: {
      atomicBatch: type === "smart",
      erc20Gas: type === "smart",
    },
    executionStatus: executionReady
      ? "ready"
      : !connected
        ? "disconnected"
        : smartAccount.error
          ? "error"
          : "unavailable",
    executionError:
      smartAccount.error?.message ??
      (hostedSignerMissing ? HOSTED_SIGNER_MISSING_MESSAGE : undefined),
  };

  return {
    widgetAccount,
    fluentAccountAddress,
    connectedAddress,
    accountMenuAddress,
    accountMenuIsExternalWallet,
    fluentAccountReady,
    fluentExecutionReady,
    hasConnectedAccount,
    connecting,
    status,
    hostedSignerMissing,
  };
}

/**
 * What the widget shows a connected person, kept apart from the account model
 * itself: addresses to label the button and the drawer header with, and the
 * session that says who they are.
 */
export type ConnectedPresentation = {
  sessionUserId?: string;
  sessionSmartAccountAddress?: string;
  fluentAccountAddress?: string;
  connectedAddress?: string;
  accountMenuAddress?: string;
  walletConnected: boolean;
};

/**
 * Lives above the `PrivyProvider`, like the auth token cache and the settings
 * controller, because the window it exists for is that provider's own remount.
 */
export type ConnectedPresentationState = {
  /** The last render on which an account really was connected. */
  connected: ConnectedPresentation | null;
  /**
   * Who the Quick sign reconstruction now in flight started for, or `null` when
   * none is. Set when `silentSigningEnabled` changes — which changes the
   * provider key — and cleared as soon as the rebuilt subtree has an account of
   * its own again, or the person is gone.
   */
  rebuilding: ConnectedPresentation | null;
};

export function createConnectedPresentationState(): ConnectedPresentationState {
  return { connected: null, rebuilding: null };
}

export type PresentedWidgetAccount = DerivedWidgetAccount & {
  /** What the connect button treats as an external wallet connection. */
  walletConnected: boolean;
};

/** The snapshot to remember for a render on which the account is connected. */
export function captureConnectedPresentation(params: {
  derived: DerivedWidgetAccount;
  walletConnected: boolean;
  sessionUserId?: string;
  sessionSmartAccountAddress?: string;
}): ConnectedPresentation {
  const { derived, walletConnected, sessionUserId, sessionSmartAccountAddress } = params;
  return {
    sessionUserId,
    sessionSmartAccountAddress,
    fluentAccountAddress: derived.fluentAccountAddress,
    connectedAddress: derived.connectedAddress,
    accountMenuAddress: derived.accountMenuAddress,
    walletConnected,
  };
}

/**
 * The account as the button, the drawer and the host's render context see it.
 *
 * Applying a stored Quick sign preference changes the `PrivyProvider` key, and
 * the rebuilt subtree starts with no ready smart account and no reconnected
 * wallet: `deriveWidgetAccount` rightly reports `connecting` or `restoring`,
 * and the default button would turn into a disabled "Connecting…" while the
 * drawer emptied itself — a second login, seen by a person who never logged out
 * and never asked for any of it. Through that window this keeps the
 * presentation they already had.
 *
 * Presentation only: `fluentAccountReady` and `widgetAccount` are left exactly
 * as derived, so nothing executes against an account that is not there yet. The
 * hold ends the moment the rebuilt account arrives, the smart account fails, or
 * the session stops naming the same person — a sign-out during a rebuild clears
 * the session, and that mismatch is what releases it.
 */
export function presentWidgetAccount(params: {
  derived: DerivedWidgetAccount;
  walletConnected: boolean;
  /** `ConnectedPresentationState.rebuilding`. */
  rebuilding: ConnectedPresentation | null;
  sessionUserId?: string;
  sessionSmartAccountAddress?: string;
  /** The smart account failed: the rebuild is not coming back. */
  failed?: boolean;
}): PresentedWidgetAccount {
  const {
    derived,
    walletConnected,
    rebuilding,
    sessionUserId,
    sessionSmartAccountAddress,
    failed,
  } = params;

  const held =
    rebuilding !== null &&
    !derived.hasConnectedAccount &&
    !failed &&
    rebuilding.sessionUserId === sessionUserId &&
    rebuilding.sessionSmartAccountAddress === sessionSmartAccountAddress;
  if (!held) return { ...derived, walletConnected };

  return {
    ...derived,
    hasConnectedAccount: true,
    connecting: false,
    status: "connected",
    // The rebuilt subtree may already know an address — the session hydrates
    // synchronously — and what it knows wins; the snapshot only fills the gaps,
    // so the button keeps its label instead of falling back to "Connected".
    fluentAccountAddress: derived.fluentAccountAddress ?? rebuilding.fluentAccountAddress,
    connectedAddress: derived.connectedAddress ?? rebuilding.connectedAddress,
    accountMenuAddress: derived.accountMenuAddress ?? rebuilding.accountMenuAddress,
    walletConnected: walletConnected || rebuilding.walletConnected,
  };
}

/** Memoized wrapper over {@link deriveWidgetAccount}. */
export function useWidgetAccount(input: DeriveWidgetAccountInput): DerivedWidgetAccount {
  const { smartAccount, wallet, sessionUserId, sessionSmartAccountAddress, directAuth } = input;
  return useMemo(
    () =>
      deriveWidgetAccount({
        smartAccount,
        wallet,
        sessionUserId,
        sessionSmartAccountAddress,
        directAuth,
      }),
    [
      smartAccount.smartAccountReady,
      smartAccount.hostedSignerAvailable,
      smartAccount.smartAccountAddress,
      smartAccount.signerAddress,
      smartAccount.error,
      smartAccount.privyReady,
      smartAccount.privyAuthenticated,
      smartAccount.embeddedWalletCount,
      wallet?.connected,
      wallet?.address,
      wallet?.hasWalletClient,
      wallet?.reconnecting,
      sessionUserId,
      sessionSmartAccountAddress,
      directAuth,
    ],
  );
}
