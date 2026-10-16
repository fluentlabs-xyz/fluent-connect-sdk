import { useCallback, useRef, useState } from "react";
import type { Address } from "viem";

import { toast } from "../../components/ui/toast";
import type { FluentAnalyticsTrack } from "../../core/analytics";
import { debugError } from "../../core/debugLogger";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { explorerTransaction, formatAddress } from "../../utils";
import type { FluentBatchApi } from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import {
  buildFluentUsdnrMintCall,
  FLUENT_USDNR_MINT_AMOUNT,
  FLUENT_USDNR_MINT_OP_ID,
  FLUENT_USDNR_MINT_REVIEW_TITLE,
  getFluentUsdnrMintToken,
  type FluentUsdnrMintOutcome,
} from "../usdnrMint";

/**
 * The explorer page for a hash, in a new tab with no handle back to this one.
 * The same precaution the wallet menu's own outbound links take: a page opened
 * through `window.open` can otherwise reach this one through `window.opener`.
 */
function openExplorerTab(url: string) {
  const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
  }
}

/**
 * Mints testnet USDnr into the Widget account. Routes through the same
 * `createBatchOp` path a Send takes, so the mint inherits the review modal, the
 * selected gas token and the balance refetch that follows a settled operation.
 *
 * It reports itself as a toast rather than as a row in Activity, which is where
 * `useTokenTransfer` puts a Send. A Send is the widget's own record of money
 * leaving, and nothing but the widget knows about it until FluentScan catches
 * up; a mint arrives as an ordinary incoming transfer that the next history
 * refetch lists on its own, so a stand-in row would only duplicate it. What a
 * mint does need is the thing a row cannot give: a receipt that stays visible
 * after the review modal closed the drawer behind it.
 */
export function useUsdnrMint(params: {
  widget: FluentBatchApi;
  /** Which explorer the receipt links to. */
  network: FluentWidgetNetwork;
  /** The Gas token from User settings, as it stands at the press. */
  gasSymbol: FluentGasTokenSymbol;
  track: FluentAnalyticsTrack;
}) {
  const { widget, network, gasSymbol, track } = params;
  const [minting, setMinting] = useState(false);
  // Guards the second of two presses. `minting` disables the button, but that
  // is a state update and the press that follows it in the same tick has not
  // seen it yet; a ref is written and read in the tick itself, so exactly one
  // operation is ever created.
  const inFlight = useRef(false);

  const mintUsdnr = useCallback(
    async (recipient: Address): Promise<FluentUsdnrMintOutcome> => {
      if (inFlight.current) return { status: "skipped" };
      inFlight.current = true;
      setMinting(true);

      const token = getFluentUsdnrMintToken();
      try {
        const operation = widget.createBatchOp({
          id: FLUENT_USDNR_MINT_OP_ID,
          reviewTitle: FLUENT_USDNR_MINT_REVIEW_TITLE,
          calls: [buildFluentUsdnrMintCall(recipient)],
        });
        // Always explicit, never left to the executor's default: the default is
        // dropped for a native selection that no App sponsors, and this
        // operation is the user's own — the token they chose in User settings is
        // the answer whichever one it is.
        const { hash } = await operation.execute({ gasPayment: { symbol: gasSymbol } });
        // The receipt. The review modal closed the drawer on its way in, so the
        // wallet menu may well not be on screen by now; a toast is, and it
        // carries the one thing the person cannot look up for themselves.
        toast.add({
          type: "success",
          title: `Minted ${FLUENT_USDNR_MINT_AMOUNT} ${token.symbol}`,
          description: `Transaction ${formatAddress(hash)}`,
          actionProps: {
            children: "View",
            onClick: () => openExplorerTab(explorerTransaction(hash, network)),
          },
        });
        track("wallet_usdnr_minted", { gas_symbol: gasSymbol });
        return { status: "minted", hash };
      } catch (error) {
        if (error instanceof FluentReviewRejectedError) {
          // A refused review is a decision, not a failure: nothing happened,
          // and the person is the one who decided that.
          track("wallet_usdnr_mint_failed", { reason: "rejected" });
          return { status: "rejected" };
        }
        debugError("[FluentWidget] USDnr mint failed", error);
        const message = error instanceof Error ? error.message : "The mint was not sent.";
        toast.add({
          type: "error",
          title: `Could not get ${token.symbol}`,
          description: message,
        });
        track("wallet_usdnr_mint_failed", { reason: "execution_failed" });
        return { status: "failed", message };
      } finally {
        inFlight.current = false;
        setMinting(false);
      }
    },
    [gasSymbol, network, track, widget],
  );

  return { mintUsdnr, mintingUsdnr: minting };
}
