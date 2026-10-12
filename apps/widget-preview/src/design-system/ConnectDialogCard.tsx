import {
  ConnectDialogBackdrop,
  ConnectDialogViewport,
} from "@fluent.xyz/connect/internal/components/ConnectDialog";
import { Dialog } from "@fluent.xyz/connect/internal/ui/dialog";
import type { ReactNode } from "react";

/**
 * The connect dialog's popup, laid flat on the page. The real `DialogContent`
 * portals to the widget's top layer and makes the page inert, so the surface is
 * mirrored here from `ui/dialog.tsx`'s popup classes. The closed `Dialog` root
 * renders nothing itself; it only gives `DialogTitle` and `DialogDescription`
 * the context they need.
 */
export function ConnectDialogCard({ children }: { children: ReactNode }) {
  return (
    <Dialog open={false}>
      <div className="dark relative mx-auto flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-popover p-4 text-sm text-white ring-1 ring-foreground/10 antialiased">
        <ConnectDialogViewport>{children}</ConnectDialogViewport>
        <ConnectDialogBackdrop />
      </div>
    </Dialog>
  );
}
