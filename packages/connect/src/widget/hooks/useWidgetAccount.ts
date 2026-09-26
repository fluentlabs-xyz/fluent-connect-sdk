import { useMemo } from "react";
import type { Address } from "viem";

import type { FluentWidgetStatus } from "../../core/types";
import type { FluentAccountType, FluentWidgetAccount } from "../batchOperation";

/** Smart-account fields the derivation reads (subset of `useFluentZeroDevAccount`). */
export type WidgetSmartAccountState = {
  smartAccountReady: boolean;
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
  hasConnectedAccount: boolean;
  connecting: boolean;
  status: FluentWidgetStatus;
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

  // Smart account (Fluent ID) takes precedence; otherwise a connected external
  // EOA (MetaMask) can also execute — just without AA perks.
  const externalReady = Boolean(wallet?.connected && wallet.hasWalletClient);
  const type: FluentAccountType | undefined = fluentAccountReady
    ? "smart"
    : wallet?.connected
      ? "eoa"
      : undefined;
  const executionReady = fluentAccountReady || externalReady;
  const connected = Boolean(wallet?.connected || executionReady);

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
    executionError: smartAccount.error?.message,
  };

  return {
    widgetAccount,
    fluentAccountAddress,
    connectedAddress,
    accountMenuAddress,
    accountMenuIsExternalWallet,
    fluentAccountReady,
    hasConnectedAccount,
    connecting,
    status,
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
