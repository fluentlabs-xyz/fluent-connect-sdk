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
    if (!smartAccount.privyAuthenticated || smartAccount.embeddedWalletCount === 0) {
      debugWarn("[fluent widget] ZeroDev init skipped: signer unavailable", {
        privyReady: smartAccount.privyReady,
        privyAuthenticated: smartAccount.privyAuthenticated,
        embeddedWalletCount: smartAccount.embeddedWalletCount,
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
    smartAccount.privyAuthenticated,
    smartAccount.refresh,
    smartAccount.smartAccountReady,
  ]);

  return { resetInitialization };
}
