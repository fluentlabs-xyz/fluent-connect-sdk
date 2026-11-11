import { useCallback, useMemo } from "react";
import { createPublicClient, type Address, type Chain, type PublicClient } from "viem";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import { createFluentRpcTransport } from "../../core/rpc";
import type { FluentExternalWalletState } from "../../core/types";
import {
  createFluentBatchOp,
  type FluentBatchApi,
  type FluentBatchOperationExecuteOptions,
  type FluentBatchOperationInput,
  type FluentBatchOperationReview,
  type FluentSigningMode,
  type FluentEncodedBatchCall,
  type FluentExecuteResult,
  type FluentWidgetAccount,
  type FluentWidgetGasPayment,
} from "../batchOperation";
import { createFluentSignApi, type FluentSignatureReview } from "../signRequest";
import { sendCallsViaExternalWallet } from "../sendCallsViaExternalWallet";
import type { useFluentZeroDevAccount } from "../zerodevSession";

/** Smart-account fields the execution path uses. */
type SmartAccountForExecution = Pick<
  ReturnType<typeof useFluentZeroDevAccount>,
  "sendCalls" | "smartAccountReady" | "ensureExecutionReady" | "kernel"
>;

/**
 * Returns the Widget API (`FluentBatchApi`). `createBatchOp().execute()` sends a Batch operation
 * as one atomic user operation from the Fluent ID once its smart account is ready, and otherwise
 * as one native-gas transaction per call from a connected External wallet; `signMessage` and
 * `signTypedData` sign for the Widget account. An App does not branch on the account type.
 */
export function useWidgetExecution(params: {
  chain: Chain;
  fluentAccountReady: boolean;
  wallet: FluentExternalWalletState | null;
  smartAccount: SmartAccountForExecution;
  widgetAccount: FluentWidgetAccount;
  defaultSigningMode: FluentSigningMode;
  selectedGasPaymentToken: FluentWidgetGasPayment;
  defaultSponsorship?: "auto" | "never";
  /** Config's `quickSign.whitelistAddresses`, already lowercased by the resolver. */
  quickSignWhitelist?: readonly Address[];
  confirmBatchOperation: (operation: FluentBatchOperationReview) => Promise<void>;
  confirmSignature: (review: FluentSignatureReview) => Promise<void>;
  refreshBalances: () => void;
  track: FluentAnalyticsTrack;
}): FluentBatchApi {
  const {
    chain,
    fluentAccountReady,
    wallet,
    smartAccount,
    widgetAccount,
    defaultSigningMode,
    selectedGasPaymentToken,
    defaultSponsorship,
    quickSignWhitelist,
    confirmBatchOperation,
    confirmSignature,
    refreshBalances,
    track,
  } = params;

  // Waits for the receipts of an External wallet's transactions.
  const eoaPublicClient = useMemo<PublicClient>(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  const sendCalls = useCallback(
    async (
      calls: FluentEncodedBatchCall[],
      options: FluentBatchOperationExecuteOptions,
      readyAccount?: unknown,
    ): Promise<FluentExecuteResult> => {
      // `fluentAccountReady` is this render's value: `execute()` awaits `ensureReady` and sends
      // with the flag still `false`. `readyAccount` is the kernel that await built, so a Fluent
      // account exists whenever it is set.
      if (fluentAccountReady || readyAccount) {
        const { hash, receipt, userOpHash, sponsored, sponsorshipReason, paymaster, timing } =
          await smartAccount.sendCalls(calls, options, readyAccount);
        track("wallet_gas_sponsored", { sponsored, reason: sponsorshipReason });
        refreshBalances();
        // `timing` is carried, not recomputed: the smart-account path is the only one that can
        // see the signing boundary, and this result is rebuilt field by field — so a field left
        // out here is a field no caller ever receives.
        return {
          hash,
          receipt,
          userOpHash,
          hashes: [hash],
          atomic: true,
          sponsored,
          paymaster,
          timing,
        };
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
        defaultSigningMode,
        defaultGasPayment: selectedGasPaymentToken,
        defaultSponsorship,
        quickSignWhitelist,
        confirm: confirmBatchOperation,
        sendCalls,
      }),
    [
      widgetAccount,
      smartAccount.smartAccountReady,
      smartAccount.ensureExecutionReady,
      sendCalls,
      defaultSigningMode,
      selectedGasPaymentToken,
      confirmBatchOperation,
      defaultSponsorship,
      quickSignWhitelist,
    ],
  );

  // Signatures follow Quick sign as Batch operations do: Silent mode with no Review, else the
  // Review and Prompt mode. Only the root Signer signs for a Fluent ID (see `signRequest`).
  const signApi = useMemo(
    () =>
      createFluentSignApi({
        account: widgetAccount,
        // The page asking, for the Review to show. A server render reaches no Review, since
        // `confirm` is a person's answer to a dialog, and the first client render recomputes this.
        origin: typeof window === "undefined" ? "" : window.location.origin,
        silentSigning: defaultSigningMode === "silent",
        confirm: confirmSignature,
        ensureReady: async (options) => {
          const kernel = await smartAccount.ensureExecutionReady(options);
          return {
            signerSource: kernel.signerSource,
            account: {
              signMessage: (params) => kernel.account.signMessage(params),
              signTypedData: (typedData) => kernel.account.signTypedData(typedData),
            },
          };
        },
        wallet: wallet?.connected ? wallet : undefined,
      }),
    [
      widgetAccount,
      defaultSigningMode,
      confirmSignature,
      smartAccount.ensureExecutionReady,
      wallet,
    ],
  );

  return useMemo<FluentBatchApi>(
    () => ({
      account: widgetAccount,
      signingMode: defaultSigningMode,
      gasPayment: selectedGasPaymentToken,
      createBatchOp,
      ...signApi,
    }),
    [widgetAccount, defaultSigningMode, selectedGasPaymentToken, createBatchOp, signApi],
  );
}
