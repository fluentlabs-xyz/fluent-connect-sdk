import { useMemo } from "react";
import { isAddress, type Address } from "viem";

import type { FluentWidgetStatus } from "../../core/types";
import type { FluentAccountType, FluentWidgetAccount } from "../batchOperation";

/** Smart-account fields the derivation reads (subset of `useFluentZeroDevAccount`). */
export type WidgetSmartAccountState = {
  smartAccountReady: boolean;
  smartAccountAddress?: Address;
  error?: Error | null;
  privyReady: boolean;
  privyAuthenticated: boolean;
  embeddedWalletCount: number;
};

/** External wallet fields the derivation reads. */
export type WidgetExternalWalletSnapshot = {
  connected: boolean;
  address?: string;
  hasWalletClient: boolean;
  reconnecting?: boolean;
};

export type DeriveWidgetAccountInput = {
  smartAccount: WidgetSmartAccountState;
  wallet: WidgetExternalWalletSnapshot | null;
  sessionSmartAccountAddress?: string;
  /**
   * The live Privy session is an External wallet's, the kind `linkX()` makes through SIWE, and
   * not a Fluent ID's. No smart account follows such a session, so it is never a login in
   * flight: with the wallet connected the account is the External wallet, and with none the
   * status is `disconnected`, never `connecting`. `FluentWidgetContent` derives it from the
   * restored Privy user and the stored session, so a reload reads the same. Defaults to `false`.
   */
  walletUserPrivySession?: boolean;
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
 * Derives the widget's account model from the smart account, the External wallet and the stored
 * session. Kept free of React so the readiness rules (`hasConnectedAccount`, `connecting`,
 * `widgetAccount`) are testable without a DOM; `useWidgetAccount` memoizes it.
 */
export function deriveWidgetAccount(input: DeriveWidgetAccountInput): DerivedWidgetAccount {
  const {
    smartAccount,
    wallet,
    sessionSmartAccountAddress,
    walletUserPrivySession = false,
  } = input;

  const fluentAccountAddress = smartAccount.smartAccountAddress ?? sessionSmartAccountAddress;
  // A connector may report connected before its account data is available, and an External
  // wallet without a valid address of its own is not an account.
  const externalAddress =
    wallet?.connected && wallet.address && isAddress(wallet.address, { strict: false })
      ? wallet.address
      : undefined;
  const externalConnected = Boolean(externalAddress);
  // Keep the Fluent ID on show when an External wallet funds a Deposit. Without a Fluent ID,
  // the validated External wallet is the displayed account.
  const connectedAddress = fluentAccountAddress ?? externalAddress;
  const accountMenuIsExternalWallet = externalConnected && !fluentAccountAddress;
  const accountMenuAddress = connectedAddress;

  const localPrivySignerReady = Boolean(
    smartAccount.privyReady &&
      smartAccount.privyAuthenticated &&
      smartAccount.embeddedWalletCount > 0,
  );
  const fluentAccountReady = Boolean(
    smartAccount.smartAccountReady &&
      smartAccount.smartAccountAddress &&
      localPrivySignerReady,
  );
  const hasConnectedAccount = Boolean(externalConnected || fluentAccountReady);
  // The window between Privy signing in and the ZeroDev smart account being ready, which the
  // button shows as pending. Not for a wallet user's Privy session: no smart account follows
  // it, so nothing would resolve that `connecting`.
  const connecting = Boolean(
    !hasConnectedAccount &&
      smartAccount.privyAuthenticated &&
      !walletUserPrivySession &&
      !smartAccount.error,
  );

  // A returning user's session, neither confirmed nor ruled out: apart from `disconnected` so an
  // App does not flash Connect at a signed-in person. Keyed on signals that resolve, not on a
  // stored session, which would pin a stale one to `restoring` once Privy settles unauthenticated.
  const restoring = Boolean(
    !hasConnectedAccount &&
      !connecting &&
      !smartAccount.error &&
      (!smartAccount.privyReady || wallet?.reconnecting),
  );

  const status: FluentWidgetStatus = hasConnectedAccount
    ? "connected"
    : connecting
      ? "connecting"
      : restoring
        ? "restoring"
        : "disconnected";

  // A Fluent ID takes precedence; otherwise a connected External wallet executes, without
  // atomic batches or Gas token fees.
  const externalReady = Boolean(externalConnected && wallet?.hasWalletClient);
  const type: FluentAccountType | undefined = fluentAccountReady
    ? "smart"
    : externalConnected
      ? "eoa"
      : undefined;
  const executionReady = fluentAccountReady || externalReady;
  const connected = Boolean(externalConnected || executionReady);

  const widgetAccount: FluentWidgetAccount = {
    address: (type === "eoa" ? externalAddress : fluentAccountAddress) as
      | Address
      | undefined,
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
 * The last connected presentation and the one to hold, kept above the keyed `PrivyProvider`, like
 * the Auth token cache and the User settings state, so it outlives the rebuild a Network change
 * makes.
 */
export type ConnectedPresentationState = {
  /** The last render on which an account really was connected. */
  connected: ConnectedPresentation | null;
  /**
   * The presentation `presentWidgetAccount` holds while the account is absent, or `null`. The
   * widget clears it on connect, on disconnect and at sign-out, and sets it nowhere, so no hold
   * engages.
   */
  rebuilding: ConnectedPresentation | null;
};

export function createConnectedPresentationState(): ConnectedPresentationState {
  return { connected: null, rebuilding: null };
}

export type PresentedWidgetAccount = DerivedWidgetAccount & {
  /** What the connect button treats as an External wallet connection. */
  walletConnected: boolean;
};

/** Returns the snapshot to remember for a render on which the account is connected. */
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
 * Returns the account as the button, the drawer and the App's render context see it: `derived`,
 * with `rebuilding` filling in a connected presentation while the account is absent. The hold
 * ends when the account arrives, the smart account fails (`failed`), or the session stops naming
 * the person `rebuilding` was taken for, as a sign-out does.
 *
 * Presentation only: `fluentAccountReady` and `widgetAccount` stay as derived, so nothing
 * executes against an account that is not there.
 */
export function presentWidgetAccount(params: {
  derived: DerivedWidgetAccount;
  walletConnected: boolean;
  /** `ConnectedPresentationState.rebuilding`. */
  rebuilding: ConnectedPresentation | null;
  sessionUserId?: string;
  sessionSmartAccountAddress?: string;
  /** The smart account failed: the account is not coming back. */
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
    // An address the account already knows wins (the session hydrates synchronously); the
    // snapshot only fills the gaps, so the button keeps its label instead of "Connected".
    fluentAccountAddress: derived.fluentAccountAddress ?? rebuilding.fluentAccountAddress,
    connectedAddress: derived.connectedAddress ?? rebuilding.connectedAddress,
    accountMenuAddress: derived.accountMenuAddress ?? rebuilding.accountMenuAddress,
    walletConnected: walletConnected || rebuilding.walletConnected,
  };
}

/** Returns {@link deriveWidgetAccount}'s result, memoized on the fields it reads. */
export function useWidgetAccount(input: DeriveWidgetAccountInput): DerivedWidgetAccount {
  const {
    smartAccount,
    wallet,
    sessionSmartAccountAddress,
    walletUserPrivySession = false,
  } = input;
  return useMemo(
    () =>
      deriveWidgetAccount({
        smartAccount,
        wallet,
        sessionSmartAccountAddress,
        walletUserPrivySession,
      }),
    [
      smartAccount.smartAccountReady,
      smartAccount.smartAccountAddress,
      smartAccount.error,
      smartAccount.privyReady,
      smartAccount.privyAuthenticated,
      smartAccount.embeddedWalletCount,
      wallet?.connected,
      wallet?.address,
      wallet?.hasWalletClient,
      wallet?.reconnecting,
      sessionSmartAccountAddress,
      walletUserPrivySession,
    ],
  );
}
