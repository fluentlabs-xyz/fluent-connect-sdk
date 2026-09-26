import { useCallback, useMemo } from "react";
import { createPublicClient, type Chain, type PublicClient } from "viem";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import type { FluentWidgetAuthMode } from "../../core/config";
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
import { createFluentSignApi, type FluentSignatureReview } from "../signRequest";
import { sendCallsViaExternalWallet } from "../sendCallsViaExternalWallet";
import { withFluentSignaturePrompt, type useFluentZeroDevAccount } from "../zerodevSession";

/** Smart-account fields the execution path uses. */
type SmartAccountForExecution = Pick<
  ReturnType<typeof useFluentZeroDevAccount>,
  "sendCalls" | "smartAccountReady" | "ensureExecutionReady" | "kernel"
>;

/**
 * Assembles the public `widget` API (`FluentBatchApi`): unified execution that
 * routes to the Fluent smart account (one atomic UserOp) when ready, otherwise
 * to a connected external EOA (sequential native-gas txs), plus `createBatchOp`
 * and the permission-session builders, plus `signMessage` / `signTypedData`
 * with the same routing. Hosts call `createBatchOp().execute()` once and never
 * branch on account type.
 */
export function useWidgetExecution(params: {
  chain: Chain;
  /**
   * Route to the Fluent ID (`useWidgetAccount`): its kernel is built, or a hosted
   * Signer builds it inside `smartAccount.sendCalls` — which also opens the Fluent
   * popup that signs.
   */
  fluentExecutionReady: boolean;
  /** A hosted session with no Signer to ask (`useWidgetAccount`). */
  hostedSignerMissing: boolean;
  wallet: FluentExternalWalletState | null;
  smartAccount: SmartAccountForExecution;
  widgetAccount: FluentWidgetAccount;
  defaultConfirmationMode: FluentBatchConfirmationMode;
  selectedGasPaymentToken: FluentWidgetGasPayment;
  confirmBatchOperation: (operation: FluentBatchOperationReview) => Promise<void>;
  authMode: FluentWidgetAuthMode;
  confirmSignature: (review: FluentSignatureReview) => Promise<void>;
  refreshBalances: () => void;
  track: FluentAnalyticsTrack;
}): FluentBatchApi {
  const {
    chain,
    fluentExecutionReady,
    hostedSignerMissing,
    wallet,
    smartAccount,
    widgetAccount,
    defaultConfirmationMode,
    selectedGasPaymentToken,
    confirmBatchOperation,
    authMode,
    confirmSignature,
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
      if (fluentExecutionReady) {
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
      fluentExecutionReady,
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
        // A hosted session with no Signer to ask has nothing to prepare, so `execute()`
        // rejects with the account's `executionError` instead of asking Privy to log
        // in on an origin it is not registered for, and `canExecute` reports false.
        ensureReady: hostedSignerMissing ? undefined : smartAccount.ensureExecutionReady,
        defaultConfirmation: defaultConfirmationMode,
        defaultGasPayment: selectedGasPaymentToken,
        confirm: confirmBatchOperation,
        sendCalls,
      }),
    [
      widgetAccount,
      smartAccount.smartAccountReady,
      smartAccount.ensureExecutionReady,
      hostedSignerMissing,
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

  // Signatures never take the silent path: the review is always shown, and the kernel
  // asked for is the prompt one, so the root Privy signer signs and a permission
  // session never does.
  const signApi = useMemo(
    () =>
      createFluentSignApi({
        authMode,
        account: widgetAccount,
        origin: window.location.origin,
        confirm: confirmSignature,
        ensureReady: async (options) => {
          const kernel = await smartAccount.ensureExecutionReady(options);
          return {
            signerSource: kernel.signerSource,
            account: {
              signMessage: (params) =>
                withFluentSignaturePrompt(() => kernel.account.signMessage(params)),
              signTypedData: (typedData) =>
                withFluentSignaturePrompt(() => kernel.account.signTypedData(typedData)),
            },
          };
        },
        wallet: wallet?.connected ? wallet : undefined,
      }),
    [authMode, widgetAccount, confirmSignature, smartAccount.ensureExecutionReady, wallet],
  );

  return useMemo<FluentBatchApi>(
    () => ({
      account: widgetAccount,
      confirmationMode: defaultConfirmationMode,
      gasPayment: selectedGasPaymentToken,
      createBatchOp,
      ...permissionApi,
      ...signApi,
    }),
    [
      widgetAccount,
      defaultConfirmationMode,
      selectedGasPaymentToken,
      createBatchOp,
      permissionApi,
      signApi,
    ],
  );
}
