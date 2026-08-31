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
  const accountMenuAddress = wallet?.connected ? connectedAddress : fluentAccountAddress;

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
    fluentAccountReady,
    hasConnectedAccount,
    connecting,
    status,
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
