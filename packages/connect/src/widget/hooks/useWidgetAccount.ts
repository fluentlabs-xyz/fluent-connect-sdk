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
