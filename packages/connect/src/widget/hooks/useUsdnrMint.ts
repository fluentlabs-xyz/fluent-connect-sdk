import { useCallback, useRef, useState } from "react";
import type { Address } from "viem";

import { toast } from "../../components/ui/toast";
import type { FluentAnalyticsTrack } from "../../core/analytics";
import { debugError } from "../../core/debugLogger";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentWidgetNetwork } from "../../core/network";
import { explorerTransaction, formatAddress } from "../../utils";
import type { FluentBatchApi } from "../batchOperation";
import { describeFluentExecutionFailure } from "../gasTokenFee";
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
 * Opens `url` in a new tab with no handle back to this one: a page opened through `window.open`
 * can otherwise reach this one through `window.opener`.
 */
function openExplorerTab(url: string) {
  const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
  }
}

/**
 * Returns `mintUsdnr`, which mints testnet USDnr to a recipient through the same `createBatchOp`
 * path a Send takes, and `mintingUsdnr`. The receipt is a toast, not a row in Activity as for a
 * Send: the mint arrives as an incoming transfer the next history refetch lists on its own, and
 * the toast stays visible after the Review closed the drawer.
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
  // Guards a second press in the same tick: `minting` disables the button only once React
  // renders, and a ref is written and read synchronously.
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
        // Always explicit: the executor drops its default for native ETH when the App sets no
        // sponsorship policy, and this operation pays with the choice in User settings, ETH too.
        const { hash } = await operation.execute({ gasPayment: { symbol: gasSymbol } });
        // The Review closed the drawer, so the wallet menu may be off screen; the toast carries
        // the hash the person cannot look up for themselves.
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
        const message = describeFluentExecutionFailure(error, gasSymbol, "The mint was not sent.");
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
