import { type FluentWidgetConfig } from "../config";
import { type FluentExternalWalletState } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent, DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Separator } from "./ui/separator";
import { Icon, type IconName } from "./Icon";

export function ConnectChoiceModal({
  open,
  wallet,
  onClose,
  onFluentLogin,
  fluentAuthorizeUrl,
  fluentReady,
  config,
  hostedError,
}: {
  open: boolean;
  wallet: FluentExternalWalletState | null;
  onClose: () => void;
  onFluentLogin: () => void;
  fluentAuthorizeUrl?: string;
  fluentReady: boolean;
  config?: FluentWidgetConfig;
  hostedError?: string | null;
}) {
  const walletOptions: Array<{
    label: string;
    icon?: IconName;
    mark?: string;
  }> = [
    { label: "MetaMask", icon: "metaMask" },
    { label: "Rabby", icon: "rabby" },
    { label: "Keplr", icon: "keplr" },
    { label: "Coinbase", icon: "coinbase" },
    { label: "WalletConnect", icon: "walletConnect" },
    { label: "OKX Wallet", icon: "okx" },
  ];
  const openWallet = () => {
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
        className="dark antialiased overflow-hidden"
      >

        <div className="z-20">
          <DialogHeader className="items-center text-center pt-5 pb-3 px-5">
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription>Sign in with Fluent to access your reputation, positions, and rewards across apps.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 p-2.5">

          <div className="flex flex-col">
            <Button
              href={fluentAuthorizeUrl}
              target="fluent_connect_popup"
              rel="opener"
              aria-disabled={!fluentReady || !fluentAuthorizeUrl}
              onClick={(event) => {
                if (!fluentReady || !fluentAuthorizeUrl) {
                  event.preventDefault();
                  return;
                }
                onFluentLogin();
                onClose();
              }}
            >
              Continue with Fluent Connect
            </Button>
          </div>

          <div className="relative flex items-center gap-3 justify-center px-2 py-1">
            <div className="flex-1">
              <Separator />
            </div>
            <div className="text-xs text-white/50">OR</div>
            <div className="flex-1">
              <Separator />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {walletOptions.map((option) => (
              <Button
                key={option.label}
                variant="secondary"
                disabled={!wallet?.configured}
                onClick={openWallet}
                className="justify-start"
              >
                {option.icon ? (
                  <Icon name={option.icon} className="size-6 p-1 bg-white/5 rounded-md -ml-0.5" />
                ) : (
                  <span className="flex size-6 items-center justify-center text-xs font-semibold">
                    {option.mark}
                  </span>
                )}
                {option.label}
                <Icon name="arrow-right-s-line" className="ml-auto size-4 opacity-20"/>
              </Button>
            ))}
          </div>

          {!wallet?.configured ? (
            <p className="connect-choice-hint">
              WalletConnect bridge is unavailable.
            </p>
          ) : null}
          {hostedError ? <p className="connect-choice-hint">{hostedError}</p> : null}

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
