import { useEffect, useState } from "react";
import type { SwapperConfig } from "@swapper-finance/deposit-sdk";

import { debugError } from "../core/debugLogger";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

/**
 * The Swapper Finance on-ramp, hosted in the widget's own dialog.
 *
 * `openSwapperModal` would put its overlay on `document.body` with a z-index,
 * and the account drawer it opens from sits in the top-layer `<dialog>` that
 * `FluentTopLayerSlot` holds open: nothing outside the top layer paints above
 * it, and a modal dialog makes the rest of the document inert, so that overlay
 * showed behind the drawer and took no clicks. Mounting `SwapperIframe` into a
 * `Dialog` keeps the on-ramp in the same top layer, nested under the drawer.
 *
 * `config` is the on-ramp to show, `null` while it is closed.
 */
export function SwapperOnRampDialog({
  config,
  onClose,
}: {
  config: SwapperConfig | null;
  onClose: () => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!config || !container) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    // Loaded here, not at the top of the file: `deposit-sdk@0.2.14`'s dist
    // imports its own files without extensions, which Node's ESM resolver
    // rejects — a static import would make the package entry unimportable in
    // plain Node and Jest (FLU-1559).
    import("@swapper-finance/deposit-sdk")
      .then(({ SwapperIframe }) => {
        // Closed, or reopened for another account, while the module loaded.
        if (disposed) return;
        const iframe = new SwapperIframe({
          ...config,
          container,
          // The iframe draws its own close button and asks to be closed with
          // `close_request`, as it does inside `openSwapperModal`.
          closable: true,
          iframeAttributes: { width: "100%", height: "100%" },
        });
        iframe.on("close_request", onClose);
        destroy = () => iframe.destroy();
      })
      .catch((error: unknown) => {
        debugError("[FluentWidget] Failed to open Swapper Finance on-ramp", error);
        if (!disposed) onClose();
      });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [config, container, onClose]);

  return (
    <Dialog
      open={config !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="block h-[min(560px,calc(100dvh-2rem))] w-[450px] gap-0 overflow-hidden rounded-[30px] bg-[#111111] p-0 ring-0 sm:max-w-[450px]"
      >
        <DialogTitle className="sr-only">Get USDnr</DialogTitle>
        <div ref={setContainer} className="size-full" />
      </DialogContent>
    </Dialog>
  );
}
