import { resolveFluentWidgetConfig, type FluentWidgetConfig } from "../config";
import { type FluentExternalWalletState } from "../types";

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
  if (!open) return null;
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
    <div
      className="connect-choice-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="connect-choice" role="dialog" aria-modal="true" aria-label="Connect">
        <div className="connect-choice-header">
          <div>
            <h2>Connect</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
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
      </section>
    </div>
  );
}
