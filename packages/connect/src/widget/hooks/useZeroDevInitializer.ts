import { useCallback, useEffect, useRef } from "react";

import type { FluentWidgetSession } from "../../core/config";
import { debugLog, debugWarn } from "../../core/debugLogger";
import type { FluentWidgetAccount } from "../batchOperation";
import type { useFluentZeroDevAccount } from "../zerodevSession";

/** Smart-account fields the initializer reads. */
type SmartAccountForInit = Pick<
  ReturnType<typeof useFluentZeroDevAccount>,
  | "refresh"
  | "smartAccountReady"
  | "hostedSignerAvailable"
  | "privyReady"
  | "privyAuthenticated"
  | "embeddedWalletCount"
  | "signerAddress"
  | "smartAccountAddress"
>;

/**
 * Drives ZeroDev smart-account initialization: once a signer is available and a
 * session (or direct-auth) exists, kick off `smartAccount.refresh()` exactly
 * once (guarded by an in-flight ref). Connect/disconnect paths call the returned
 * `resetInitialization` so a new sign-in re-initializes.
 *
 * The signer is either Privy's on this page (direct login, or an App on the Fluent
 * origin) or the hosted one behind the Fluent popup. Building the kernel from the
 * hosted Signer needs only its address, no popup, so a hosted session initializes
 * on load exactly like a direct one; the popup opens when a transaction is signed.
 */
export function useZeroDevInitializer(params: {
  smartAccount: SmartAccountForInit;
  directAuth: boolean;
  session: FluentWidgetSession | null;
  widgetAccount: FluentWidgetAccount;
}) {
  const { smartAccount, directAuth, session, widgetAccount } = params;
  const initRequested = useRef(false);

  const resetInitialization = useCallback(() => {
    initRequested.current = false;
  }, []);

  useEffect(() => {
    debugLog("[fluent widget] account state", {
      hasSession: Boolean(session),
      sessionUserId: session?.user?.id,
      sessionSignerAddress: session?.wallet?.signerAddress,
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
      widgetAddress: widgetAccount.address,
      widgetConnected: widgetAccount.connected,
      executionReady: widgetAccount.executionReady,
      executionStatus: widgetAccount.executionStatus,
      executionError: widgetAccount.executionError,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
      signerAddress: smartAccount.signerAddress,
      zeroDevSmartAccountAddress: smartAccount.smartAccountAddress,
      zeroDevInitRequested: initRequested.current,
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.signerAddress,
    smartAccount.smartAccountAddress,
    widgetAccount.address,
    widgetAccount.connected,
    widgetAccount.executionError,
    widgetAccount.executionReady,
    widgetAccount.executionStatus,
  ]);

  useEffect(() => {
    if (smartAccount.smartAccountReady) return;
    if (!directAuth && !session) return;
    const localSigner = smartAccount.privyAuthenticated && smartAccount.embeddedWalletCount > 0;
    // Wait for Privy to settle before going hosted, so `refresh` makes its
    // local-vs-hosted choice once and never rebuilds the kernel behind the account.
    const hostedSigner = smartAccount.hostedSignerAvailable && smartAccount.privyReady;
    if (!localSigner && !hostedSigner) {
      debugWarn("[fluent widget] ZeroDev init skipped: signer unavailable", {
        privyReady: smartAccount.privyReady,
        privyAuthenticated: smartAccount.privyAuthenticated,
        embeddedWalletCount: smartAccount.embeddedWalletCount,
        hostedSignerAvailable: smartAccount.hostedSignerAvailable,
      });
      return;
    }
    if (initRequested.current) {
      debugLog("[fluent widget] ZeroDev init skipped: request already in flight");
      return;
    }

    initRequested.current = true;
    debugLog("[fluent widget] requesting ZeroDev refresh");
    smartAccount.refresh().catch((error) => {
      initRequested.current = false;
      debugWarn("[fluent widget] ZeroDev account initialization failed", error);
    });
  }, [
    directAuth,
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.hostedSignerAvailable,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.refresh,
    smartAccount.smartAccountReady,
  ]);

  return { resetInitialization };
}
