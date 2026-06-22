import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { type CSSProperties } from "react";

export type FluentConnectWalletOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
  onSelect?: () => void | Promise<void>;
};

export type FluentConnectModalProps = {
  open: boolean;
  walletOptions?: FluentConnectWalletOption[];
  onClose: () => void;
  title?: string;
  description?: string;
};

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(3, 2, 19, 0.72)",
    backdropFilter: "blur(10px)",
  } satisfies CSSProperties,
  dialog: {
    width: "min(100%, 760px)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 16,
    background: "#23222a",
    color: "#f4f7fb",
    boxShadow: "0 30px 100px rgba(0, 0, 0, 0.48)",
    overflow: "hidden",
  } satisfies CSSProperties,
  layout: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
    minHeight: 400,
  } satisfies CSSProperties,
  walletPanel: {
    padding: "30px",
    background: "#24232b",
  } satisfies CSSProperties,
  fluentPanel: {
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 20,
    padding: "32px 30px",
    background: "linear-gradient(145deg, #39364f 0%, #302d45 100%)",
    textAlign: "center",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontFamily: 'Bossa, Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: 20,
    fontWeight: 800,
    lineHeight: "26px",
  } satisfies CSSProperties,
  description: {
    margin: "14px 0 26px",
    color: "rgba(255, 255, 255, 0.68)",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "18px",
  } satisfies CSSProperties,
  close: {
    width: 34,
    height: 34,
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 11,
    background: "rgba(255, 255, 255, 0.04)",
    color: "#f4f7fb",
    cursor: "pointer",
  } satisfies CSSProperties,
  list: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    columnGap: 18,
    rowGap: 24,
  } satisfies CSSProperties,
  option: {
    width: "100%",
    display: "grid",
    justifyItems: "center",
    gap: 8,
    border: 0,
    borderRadius: 14,
    padding: 0,
    background: "transparent",
    color: "#f4f7fb",
    cursor: "pointer",
    textAlign: "center",
  } satisfies CSSProperties,
  icon: {
    display: "grid",
    placeItems: "center",
    width: 46,
    height: 46,
    borderRadius: 10,
    background: "rgba(255, 255, 255, 0.085)",
    fontSize: 13,
    fontWeight: 800,
  } satisfies CSSProperties,
  optionTitle: {
    display: "block",
    minHeight: 30,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: "14px",
  } satisfies CSSProperties,
  status: {
    minHeight: 18,
    margin: "18px 0 0",
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: "18px",
  } satisfies CSSProperties,
  optionDescription: {
    display: "block",
    marginTop: 2,
    color: "rgba(255, 255, 255, 0.58)",
    fontSize: 12,
    lineHeight: "16px",
  } satisfies CSSProperties,
  fluentTitle: {
    margin: 0,
    color: "#c39cff",
    fontSize: 20,
    fontWeight: 800,
    lineHeight: "24px",
  } satisfies CSSProperties,
  fluentArt: {
    display: "grid",
    placeItems: "center",
    width: 136,
    height: 104,
    borderRadius: 24,
    background: "linear-gradient(135deg, #49EDED 0%, #FF8FDA 100%)",
    color: "#030213",
    fontSize: 44,
    fontWeight: 900,
    boxShadow: "0 24px 50px rgba(0, 0, 0, 0.22)",
  } satisfies CSSProperties,
  fluentButton: {
    border: 0,
    borderRadius: 12,
    minHeight: 44,
    padding: "12px 20px",
    background: "#c9b8ee",
    color: "#242033",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  } satisfies CSSProperties,
};

export function FluentConnectModal({
  open,
  walletOptions = [],
  onClose,
  title = "Connect Wallet",
  description = "Start by connecting with one of the wallets below. Be sure to store your private keys or seed phrase securely.",
}: FluentConnectModalProps) {
  const { login, ready } = usePrivy();
  const [pendingOption, setPendingOption] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label={title} style={styles.dialog}>
        <div style={styles.layout}>
          <div style={styles.walletPanel}>
            <div style={styles.header}>
              <div>
                <h2 style={styles.title}>{title}</h2>
                <p style={styles.description}>{description}</p>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} style={styles.close}>
                x
              </button>
            </div>

            <div style={styles.list}>
              {walletOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled || Boolean(pendingOption)}
                  aria-disabled={option.disabled}
                  title={option.disabled ? option.description : `Connect with ${option.label}`}
                  onClick={async () => {
                    if (option.disabled || !option.onSelect) return;
                    setPendingOption(option.id);
                    setStatus(`Opening ${option.label}`);
                    try {
                      await option.onSelect();
                      setStatus(null);
                      onClose();
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "Wallet connection failed");
                    } finally {
                      setPendingOption(null);
                    }
                  }}
                  style={{
                    ...styles.option,
                    cursor: option.disabled ? "default" : "pointer",
                    opacity: option.disabled || pendingOption ? 0.54 : 1,
                  }}
                >
                  <span style={styles.icon}>{option.icon ?? option.label.slice(0, 1)}</span>
                  <span>
                    <span style={styles.optionTitle}>{option.label}</span>
                    {option.description ? (
                      <span style={styles.optionDescription}>{option.description}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <p aria-live="polite" style={styles.status}>
              {status}
            </p>
          </div>

          <div style={styles.fluentPanel}>
            <h3 style={styles.fluentTitle}>Fluent Connect ID</h3>
            <div style={styles.fluentArt}>F</div>
            <p style={{ ...styles.description, maxWidth: 280, margin: 0 }}>
              Continue with Fluent ID, an embedded wallet, and BLEND onboarding.
            </p>
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                void login();
                onClose();
              }}
              style={{ ...styles.fluentButton, opacity: ready ? 1 : 0.68 }}
            >
              Connect with Fluent
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
