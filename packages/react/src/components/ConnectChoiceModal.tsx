import { resolveFluentWidgetConfig, type FluentWidgetConfig } from "../config";
import { type FluentExternalWalletState } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "./ui/dialog";
import { X } from "lucide-react";

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
  const { assets } = resolveFluentWidgetConfig(config);
  const walletOptions = [
    { label: "MetaMask", icon: assets.metamaskIcon },
    { label: "Rabby", mark: "R" },
    { label: "Keplr", mark: "K" },
    { label: "Coinbase", icon: assets.coinbaseIcon },
    { label: "WalletConnect", icon: assets.walletConnectIcon },
    { label: "OKX Wallet", mark: "OKX" },
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
        showCloseButton={false}
        aria-describedby={undefined}
        className="dark"
      >
        <div className="connect-choice-header">
          <div>
            <DialogTitle render={<h2 />}>Connect</DialogTitle>
          </div>
          <DialogClose
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Close"
              />
            }
          >
            <X />
          </DialogClose>
        </div>

        <div className="connect-choice-grid">
          <div className="connect-wallet-panel">
            <h3>Connect Wallet</h3>
            <p>Choose a wallet through WalletConnect.</p>
            <div className="wallet-option-grid">
              {walletOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="wallet-option"
                  disabled={!wallet?.configured}
                  onClick={openWallet}
                >
                  <span className="wallet-option-mark">
                    {option.icon ? <img src={option.icon} alt="" /> : option.mark}
                  </span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            {!wallet?.configured ? (
              <p className="connect-choice-hint">
                WalletConnect bridge is unavailable.
              </p>
            ) : null}
          </div>

          <a
            className="connect-fluent-panel"
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
            <span className="connect-choice-mark connect-choice-mark-logo">
              <img src={assets.fluentLogo} alt="" />
            </span>
            <strong>Fluent Connect ID</strong>
            <span>Fluent account, permissions, BLEND onboarding</span>
          </a>
        </div>
        {hostedError ? <p className="connect-choice-hint">{hostedError}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
