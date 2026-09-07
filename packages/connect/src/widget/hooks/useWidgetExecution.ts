import { useCallback, useMemo } from "react";
import { createPublicClient, type Chain, type PublicClient } from "viem";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import { createFluentRpcTransport } from "../../core/rpc";
import type { FluentExternalWalletState } from "../../core/types";
import {
  createFluentBatchOp,
  type FluentBatchApi,
  type FluentBatchConfirmationMode,
  type FluentBatchOperationExecuteOptions,
  type FluentBatchOperationInput,
  type FluentBatchOperationReview,
  type FluentEncodedBatchCall,
  type FluentExecuteResult,
  type FluentWidgetAccount,
  type FluentWidgetGasPayment,
} from "../batchOperation";
import { createFluentPermissionApi } from "../permissionSession";
import { sendCallsViaExternalWallet } from "../sendCallsViaExternalWallet";
import type { useFluentZeroDevAccount } from "../zerodevSession";

/** Smart-account fields the execution path uses. */
type SmartAccountForExecution = Pick<
  ReturnType<typeof useFluentZeroDevAccount>,
  "sendCalls" | "smartAccountReady" | "ensureExecutionReady" | "kernel"
>;

/**
 * Assembles the public `widget` API (`FluentBatchApi`): unified execution that
 * routes to the Fluent smart account (one atomic UserOp) when ready, otherwise
 * to a connected external EOA (sequential native-gas txs), plus `createBatchOp`
 * and the permission-session builders. Hosts call `createBatchOp().execute()`
 * once and never branch on account type.
 */
export function useWidgetExecution(params: {
  chain: Chain;
  fluentAccountReady: boolean;
  wallet: FluentExternalWalletState | null;
  smartAccount: SmartAccountForExecution;
  widgetAccount: FluentWidgetAccount;
  defaultConfirmationMode: FluentBatchConfirmationMode;
  selectedGasPaymentToken: FluentWidgetGasPayment;
  confirmBatchOperation: (operation: FluentBatchOperationReview) => Promise<void>;
  refreshBalances: () => void;
  track: FluentAnalyticsTrack;
}): FluentBatchApi {
  const {
    chain,
    fluentAccountReady,
    wallet,
    smartAccount,
    widgetAccount,
    defaultConfirmationMode,
    selectedGasPaymentToken,
    confirmBatchOperation,
    refreshBalances,
    track,
  } = params;

  // Public client for waiting on external-wallet (EOA) transaction receipts.
  const eoaPublicClient = useMemo<PublicClient>(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  const sendCalls = useCallback(
    async (
      calls: FluentEncodedBatchCall[],
      options: FluentBatchOperationExecuteOptions,
    ): Promise<FluentExecuteResult> => {
      if (fluentAccountReady) {
        const { hash, sponsored, sponsorshipReason, paymaster } =
          await smartAccount.sendCalls(calls, options);
        track("wallet_gas_sponsored", { sponsored, reason: sponsorshipReason });
        refreshBalances();
        return { hash, hashes: [hash], atomic: true, sponsored, paymaster };
      }
      if (wallet?.connected && wallet.walletClient) {
        const result = await sendCallsViaExternalWallet(calls, wallet, chain, eoaPublicClient);
        refreshBalances();
        return result;
      }
      throw new Error("No Fluent account is available to execute this operation");
    },
    [
      wallet,
      chain,
      eoaPublicClient,
      fluentAccountReady,
      refreshBalances,
      smartAccount.sendCalls,
      track,
    ],
  );

  const createBatchOp = useCallback(
    (input: FluentBatchOperationInput) =>
      createFluentBatchOp(input, {
        account: widgetAccount,
        smartAccountReady: smartAccount.smartAccountReady,
        ensureReady: smartAccount.ensureExecutionReady,
        defaultConfirmation: defaultConfirmationMode,
        defaultGasPayment: selectedGasPaymentToken,
        confirm: confirmBatchOperation,
        sendCalls,
      }),
    [
      widgetAccount,
      smartAccount.smartAccountReady,
      smartAccount.ensureExecutionReady,
      sendCalls,
      defaultConfirmationMode,
      selectedGasPaymentToken,
      confirmBatchOperation,
    ],
  );

  // ZeroDev permission sessions are bound to the active Kernel account so apps
  // can later request scoped session policies instead of raw key delegation.
  const permissionApi = useMemo(
    () =>
      createFluentPermissionApi({
        kernel: smartAccount.kernel,
        smartAccountReady: smartAccount.smartAccountReady,
      }),
    [smartAccount.kernel, smartAccount.smartAccountReady],
  );

  return useMemo<FluentBatchApi>(
    () => ({
      account: widgetAccount,
      confirmationMode: defaultConfirmationMode,
      gasPayment: selectedGasPaymentToken,
      createBatchOp,
      ...permissionApi,
    }),
    [widgetAccount, defaultConfirmationMode, selectedGasPaymentToken, createBatchOp, permissionApi],
  );
}
