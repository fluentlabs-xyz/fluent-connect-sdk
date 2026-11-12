import { useCallback, useEffect, useRef } from "react";

import type { FluentStoredSession } from "../../core/config";
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
  | "smartAccountAddress"
>;

/**
 * Starts the ZeroDev smart-account initialization: once the Signer is available it calls
 * `smartAccount.refresh()` once, guarded by a ref that a failed call clears. Disconnect and a
 * completed login call the returned `resetInitialization`, so the next login initializes again.
 */
export function useZeroDevInitializer(params: {
  smartAccount: SmartAccountForInit;
  session: FluentStoredSession | null;
  widgetAccount: FluentWidgetAccount;
}) {
  const { smartAccount, session, widgetAccount } = params;
  const initRequested = useRef(false);

  const resetInitialization = useCallback(() => {
    initRequested.current = false;
  }, []);

  useEffect(() => {
    debugLog("[fluent widget] account state", {
      hasSession: Boolean(session),
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
      widgetAddress: widgetAccount.address,
      widgetConnected: widgetAccount.connected,
      executionReady: widgetAccount.executionReady,
      executionStatus: widgetAccount.executionStatus,
      executionError: widgetAccount.executionError,
      privyReady: smartAccount.privyReady,
      privyAuthenticated: smartAccount.privyAuthenticated,
      embeddedWalletCount: smartAccount.embeddedWalletCount,
      zeroDevSmartAccountAddress: smartAccount.smartAccountAddress,
      zeroDevInitRequested: initRequested.current,
    });
  }, [
    session,
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.smartAccountAddress,
    widgetAccount.address,
    widgetAccount.connected,
    widgetAccount.executionError,
    widgetAccount.executionReady,
    widgetAccount.executionStatus,
  ]);

  useEffect(() => {
    if (smartAccount.smartAccountReady) return;
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
    smartAccount.embeddedWalletCount,
    smartAccount.privyAuthenticated,
    smartAccount.privyReady,
    smartAccount.refresh,
    smartAccount.smartAccountReady,
  ]);

  return { resetInitialization };
}
