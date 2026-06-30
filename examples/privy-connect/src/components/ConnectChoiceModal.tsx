import { METAMASK_ICON, COINBASE_ICON, WALLETCONNECT_ICON, FLUENT_LOGO } from "../const";
import { ReownWalletState } from "../reown-appkit";

export function ConnectChoiceModal({
  open,
  wallet,
  onClose,
  onFluentLogin,
  fluentReady,
}: {
  open: boolean;
  wallet: ReownWalletState | null;
  onClose: () => void;
  onFluentLogin: () => void;
  fluentReady: boolean;
}) {
  if (!open) return null;
  const walletOptions = [
    { label: "MetaMask", icon: METAMASK_ICON },
    { label: "Rabby", mark: "R" },
    { label: "Keplr", mark: "K" },
    { label: "Coinbase", icon: COINBASE_ICON },
    { label: "WalletConnect", icon: WALLETCONNECT_ICON },
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
                Set VITE_REOWN_PROJECT_ID or VITE_WALLETCONNECT_PROJECT_ID.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="connect-fluent-panel"
            disabled={!fluentReady}
            onClick={() => {
              onFluentLogin();
              onClose();
            }}
          >
            <span className="connect-choice-mark connect-choice-mark-logo">
              <img src={FLUENT_LOGO} alt="" />
            </span>
            <strong>Fluent Connect ID</strong>
            <span>Privy ID, embedded wallet, BLEND onboarding</span>
          </button>
        </div>
      </section>
    </div>
  );
}
