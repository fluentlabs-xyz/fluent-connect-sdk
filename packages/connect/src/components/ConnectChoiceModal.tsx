import { type FluentAnalyticsTrack } from "../core/analytics";
import { type FluentWidgetConfig } from "../core/config";
import { type FluentExternalWalletState } from "../core/types";
import { Wallet } from "lucide-react";
import { Icon } from "./Icon";
import { InlineConnectModal } from "./InlineConnectModal";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type ConnectChoiceModalProps = {
  track: FluentAnalyticsTrack;
  /** The user committed to the external-wallet branch — the connect funnel's other arm. */
  onExternalWalletSelected: () => void;
  open: boolean;
  wallet: FluentExternalWalletState | null;
  onClose: () => void;
  /**
   * The user chose the Fluent branch. A promise answers with work the host has to finish
   * before any Fluent sign-in method may run — the widget signs a wallet user's Privy session
   * out first — and the inline modal runs no method until it resolves; its rejection runs none
   * and is shown as the dialog's error. A host with nothing to wait for returns nothing.
   */
  onFluentLogin: () => void | Promise<void>;
  fluentAuthorizeUrl?: string;
  fluentReady: boolean;
  authMode?: "hosted" | "direct";
  /** A SIWE session must never acquire an embedded wallet through the connect modal. */
  walletUserPrivySession?: boolean;
  config?: FluentWidgetConfig;
  hostedError?: string | null;
  onRetry?: () => void;
};

export function ConnectChoiceModal(props: ConnectChoiceModalProps) {
  return props.authMode === "direct" ? (
    <InlineConnectModal {...props} />
  ) : (
    <HostedConnectChoiceModal {...props} />
  );
}

function HostedConnectChoiceModal({
  track,
  onExternalWalletSelected,
  open,
  wallet,
  onClose,
  onFluentLogin,
  fluentAuthorizeUrl,
  fluentReady,
  authMode = "hosted",
  config,
  hostedError,
}: ConnectChoiceModalProps) {
  const directAuth = authMode === "direct";
  const fluentActionReady =
    fluentReady && (directAuth || Boolean(fluentAuthorizeUrl));
  // Straight to Reown, which owns the wallet list. Naming the wallets here too
  // only ever produced a second picker: Reown's `open()` takes a view, never a
  // wallet, so a choice made on this screen could not be carried into it.
  const openWallet = () => {
    track("connect_method_selected", { method: "external" });
    onExternalWalletSelected();
    wallet?.open();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="dark text-white antialiased overflow-hidden"
      >
        <div className="z-20">
          <DialogHeader className="items-center text-center pt-5 pb-3 px-4">
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription>
              Sign in with Fluent Connect to access your reputation, positions,
              and rewards across apps.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col p-2.5">
            <div className="flex flex-col">
              <Button
                href={directAuth ? undefined : fluentAuthorizeUrl}
                target={directAuth ? undefined : "fluent_connect_popup"}
                rel={directAuth ? undefined : "opener"}
                aria-disabled={!fluentActionReady}
                onClick={(event) => {
                  if (!fluentActionReady) {
                    event.preventDefault();
                    return;
                  }
                  track("connect_method_selected", { method: "fluent" });
                  onFluentLogin();
                  onClose();
                }}
              >
                <Icon name="fluent" className="size-5 shrink-0" aria-hidden />
                Continue with Fluent Connect
              </Button>
            </div>

            <div className="flex justify-center">
              <Button
                variant="link"
                disabled={!wallet?.configured}
                onClick={openWallet}
                className="text-white/50 hover:text-white/80"
              >
                <Wallet className="size-4 shrink-0" aria-hidden />
                Other wallets
              </Button>
            </div>

            {!wallet?.configured ? (
              <p className="px-2.5 text-xs text-[#ff8fda]">
                WalletConnect bridge is unavailable.
              </p>
            ) : null}
            {hostedError ? (
              <p className="px-2.5 text-xs text-[#ff8fda]">{hostedError}</p>
            ) : null}
          </div>
        </div>

        <div
          className="absolute z-[1] inset-1.5 rounded-[18px]"
          style={{
            background:
              "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
            backgroundSize: "150% auto",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
