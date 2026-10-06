import { isFluentNativeToken } from "@fluent.xyz/connect-sdk";
import { useCallback } from "react";
import { formatUnits, type Hash } from "viem";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import { debugError } from "../../core/debugLogger";
import { toast } from "../../components/ui/toast";
import type { FluentBatchApi } from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import {
  buildFluentTransferCall,
  FLUENT_SEND_TOKEN_OP_ID,
  type FluentPendingTransfer,
  type FluentTokenTransferOutcome,
  type FluentTokenTransferRequest,
} from "../tokenTransfer";

/**
 * Sends one token out of the widget account. Routes through the same
 * `createBatchOp` path every host-app operation takes, so the transfer inherits
 * the review modal, the selected gas token and the balance refetch.
 *
 * It reports itself as a row in Activity rather than as a toast: the row is in
 * the place the user will look for the transfer afterwards, it outlives the
 * drawer closing for a review, and the mined transfer takes it over in place.
 * Only a failure still toasts — nothing is coming to fill a row for it.
 */
export function useTokenTransfer(params: {
  widget: FluentBatchApi;
  track: FluentAnalyticsTrack;
  /** Lists the transfer as pending and returns the id that ends it. */
  beginTransfer: (transfer: Omit<FluentPendingTransfer, "id" | "hash">) => string;
  /** Mined: keep the row until the history lists this hash. */
  settleTransfer: (id: string, hash: Hash) => void;
  /** Never reached the chain: drop the row now. */
  endTransfer: (id: string) => void;
}) {
  const { widget, track, beginTransfer, settleTransfer, endTransfer } = params;

  return useCallback(
    async (request: FluentTokenTransferRequest): Promise<FluentTokenTransferOutcome> => {
      const { token, to, amount, gasSymbol } = request;
      // A row in Activity rather than a toast: it is the same row the mined
      // transfer becomes, in the place the user will look for it afterwards,
      // and it survives the drawer closing for a review.
      const pendingId = beginTransfer({
        symbol: token.symbol,
        amount: formatUnits(amount, token.decimals),
        to,
        startedAt: Date.now(),
      });
      let settled = false;

      try {
        const operation = widget.createBatchOp({
          id: FLUENT_SEND_TOKEN_OP_ID,
          reviewTitle: `Send ${token.symbol}`,
          calls: [buildFluentTransferCall({ token, to, amount })],
        });
        // Always explicit, never left to the executor's default: the form offers
        // a fee token per transfer, and "the same one as always" has to travel
        // the same way as a change — a native choice especially, which the
        // default would otherwise overwrite with the stored ERC-20 one.
        const { hash } = await operation.execute({ gasPayment: { symbol: gasSymbol } });
        // Never the recipient or the amount: this reports that a withdrawal
        // happened, not who was paid what.
        track("wallet_token_sent", {
          symbol: token.symbol,
          token_source: token.source,
          native: isFluentNativeToken(token),
          gas_symbol: gasSymbol,
        });
        // Settled, not gone: the row holds its place until the history lists
        // this hash. `endTransfer` in the `finally` below only ever fires for a
        // transfer that never got one.
        settleTransfer(pendingId, hash);
        settled = true;
        return { status: "sent", hash };
      } catch (error) {
        if (error instanceof FluentReviewRejectedError) {
          track("wallet_token_send_failed", { reason: "rejected" });
          return { status: "rejected" };
        }
        debugError("[FluentWidget] Token transfer failed", error);
        const message = error instanceof Error ? error.message : "The transfer was not sent.";
        toast.add({
          type: "error",
          title: `Could not send ${token.symbol}`,
          description: message,
        });
        track("wallet_token_send_failed", { reason: "execution_failed" });
        return { status: "failed", message };
      } finally {
        // A transfer that never reached the chain has no row coming to replace
        // its stand-in — a refused review above all — so drop it here.
        if (!settled) endTransfer(pendingId);
      }
    },
    [beginTransfer, settleTransfer, endTransfer, track, widget],
  );
}
