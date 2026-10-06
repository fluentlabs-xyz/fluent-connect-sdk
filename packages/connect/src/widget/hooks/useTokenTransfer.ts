import { isFluentNativeToken } from "@fluent.xyz/connect-sdk";
import { useCallback } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import { debugError } from "../../core/debugLogger";
import { toast } from "../../components/ui/toast";
import { formatAddress } from "../../utils";
import type { FluentBatchApi } from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import {
  buildFluentTransferCall,
  type FluentTokenTransferOutcome,
  type FluentTokenTransferRequest,
} from "../tokenTransfer";

/**
 * Sends one token out of the widget account. Routes through the same
 * `createBatchOp` path every host-app operation takes, so the transfer inherits
 * the review modal, the selected gas token and the balance refetch, and reports
 * its own outcome as a toast — the account drawer closes as soon as the review
 * opens, so the form that started this is usually gone by the time it settles.
 */
export function useTokenTransfer(params: {
  widget: FluentBatchApi;
  track: FluentAnalyticsTrack;
}) {
  const { widget, track } = params;

  return useCallback(
    async (request: FluentTokenTransferRequest): Promise<FluentTokenTransferOutcome> => {
      const { token, to, amount, gasSymbol } = request;
      const recipient = formatAddress(to);
      const pendingToastId = toast.add({
        type: "loading",
        title: `Sending ${token.symbol}`,
        description: `To ${recipient}`,
      });

      try {
        const operation = widget.createBatchOp({
          id: "fluent-send-token",
          reviewTitle: `Send ${token.symbol}`,
          calls: [buildFluentTransferCall({ token, to, amount })],
        });
        // Always explicit, never left to the executor's default: the form offers
        // a fee token per transfer, and "the same one as always" has to travel
        // the same way as a change — a native choice especially, which the
        // default would otherwise overwrite with the stored ERC-20 one.
        const { hash } = await operation.execute({ gasPayment: { symbol: gasSymbol } });
        toast.close(pendingToastId);
        // No success toast: the transfer is now a row in Activity, which the
        // wallet menu opens on `sent`. A toast would say the same thing in a
        // place the user cannot return to, and it vanishes while the row stays.
        // Failures keep theirs — there is no row for a transfer that never
        // settled, so a toast is the only thing left to say it.
        //
        // Never the recipient or the amount: this reports that a withdrawal
        // happened, not who was paid what.
        track("wallet_token_sent", {
          symbol: token.symbol,
          token_source: token.source,
          native: isFluentNativeToken(token),
          gas_symbol: gasSymbol,
        });
        return { status: "sent", hash };
      } catch (error) {
        toast.close(pendingToastId);
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
      }
    },
    [track, widget],
  );
}
