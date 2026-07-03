import { FluentFamilies, createFluentFamiliesClient } from "@fluent/connect-sdk";
import { openSwapperModal } from '@swapper-finance/deposit-sdk';
import { useState, useMemo, useEffect } from "react";
import { FluentWidgetSession, FLUENT_PUBLIC_API_URL, FLUENT_LOGO, FLUENT_PORTAL_BRIDGE_URL, FAMILY_LABELS } from "../const";
import { explorerAddress } from "../utils/explorerAddress";
import { PermissionDemo } from "./PermissionDemo";
import { WalletMenuBalances } from "./WalletMenuBalances";

export function WalletMenuActionCard({
  session,
  connectedAddress,
  faucetBusy,
  onFaucet,
}: {
  session: FluentWidgetSession | null;
  connectedAddress: string | undefined;
  faucetBusy: boolean;
  onFaucet: () => void;
}) {
  const [result, setResult] = useState<FluentFamilies | null>(null);
  const [status, setStatus] = useState("Connect with Fluent ID to load families");
  const [cardMode, setCardMode] = useState<"actions" | "permissions" | "reputation">("actions");
  const client = useMemo(() => {
    if (!session?.wallet.signerAddress) return null;
    return createFluentFamiliesClient({
      baseUrl: FLUENT_PUBLIC_API_URL,
    });
  }, [session]);

  useEffect(() => {
    if (!client) {
      setResult(null);
      setStatus("Connect with Fluent ID to load families");
      return;
    }

    let active = true;
    setStatus("Loading Fluent families");
    client
      .getFamilies(session?.wallet.signerAddress ?? "")
      .then((families) => {
        if (!active) return;
        setResult(families);
        setStatus("Families loaded from Fluent Connect");
      })
      .catch((error) => {
        if (!active) return;
        setResult(null);
        setStatus(error instanceof Error ? error.message : "Could not load families");
      });
    return () => {
      active = false;
    };
  }, [client]);
  const flipped = cardMode !== "actions";
  const toggleMode = (mode: "permissions" | "reputation") => {
    setCardMode((current) => (current === mode ? "actions" : mode));
  };

  return (
    <div className={`wallet-menu-action-card ${flipped ? "wallet-menu-action-card-flipped" : ""}`}>
      <button
        className="wallet-menu-reputation-trigger"
        type="button"
        aria-pressed={cardMode === "permissions"}
        onClick={() => toggleMode("permissions")}
      >
        <span className="wallet-menu-reputation-title">
          <img src={FLUENT_LOGO} alt="" aria-hidden="true" />
          <span>Permissions</span>
        </span>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <button
        className="wallet-menu-reputation-trigger"
        type="button"
        aria-pressed={cardMode === "reputation"}
        onClick={() => toggleMode("reputation")}
      >
        <span className="wallet-menu-reputation-title">
          <img src={FLUENT_LOGO} alt="" aria-hidden="true" />
          <span>Reputation</span>
        </span>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <section className="wallet-menu-flip-card" aria-label="Fluent account actions and reputation">
        <div className="wallet-menu-flip-card-inner">
          <div className="wallet-menu-flip-face wallet-menu-flip-front">
            <div className="wallet-menu-smart">
              <button type="button" disabled={faucetBusy || !session} onClick={onFaucet}>
                <strong>{faucetBusy ? "Requesting faucet" : "Faucet"}</strong>
                <span>{session ? "Claim testnet BLEND" : "Connect Fluent ID first"}</span>
              </button>
              <button
                type="button"
                onClick={() => open(FLUENT_PORTAL_BRIDGE_URL, "_blank", "noopener,noreferrer")}
              >
                <strong>Bridge</strong>
                <span>Move assets to Fluent</span>
              </button>
              <button
                type="button"
                disabled={!connectedAddress}
                onClick={() => {
                  if (connectedAddress) open(explorerAddress(connectedAddress), "_blank", "noopener,noreferrer");
                }}
              >
                <strong>Explorer</strong>
                <span>View connected account</span>
              </button>
              <button
                type="button"
                disabled={!connectedAddress}
                onClick={() => {
                  if (connectedAddress) {
                    openSwapperModal({
                      integratorId: 'a5ece18d4332815e6480',
                      dstChainId: '25363',
                      dstTokenAddr: '0xD48e565561416dE59DA1050ED70b8d75e8eF28f9',
                      depositWalletAddress: connectedAddress,
                      styles: {
                        themeMode: 'dark',
                        componentStyles: {
                          primaryColor: '#FF8FDA',
                          accentColor: '#FECCEF',
                          // primaryTextColor: '#FFFFFF',
                          sphereColor: '#FF8FDA',
                        },
                      },
                    });
                  }
                }}
              >
                <strong>USDnr on-ramp</strong>
              </button>
              <WalletMenuBalances
                accountAddress={connectedAddress as `0x${string}` | undefined}
              />
            </div>
          </div>
          <div className="wallet-menu-flip-face wallet-menu-flip-back">
            {cardMode === "permissions" ? (
              <PermissionDemo session={session} compact />
            ) : (
              <>
                <div className="wallet-family-grid">
                  {result
                    ? Object.entries(result.families).map(([name, family]) => (
                        <div
                          className={`wallet-family-card wallet-family-tier-${family.tier.toLowerCase()}`}
                          key={name}
                        >
                          <strong className="wallet-family-name">{name}</strong>
                          <strong>Tier {family.tier}</strong>
                          <small>{FAMILY_LABELS[name]?.[family.tier] ?? "Reputation signal"}</small>
                        </div>
                      ))
                    : null}
                </div>
                <p>{status}</p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
