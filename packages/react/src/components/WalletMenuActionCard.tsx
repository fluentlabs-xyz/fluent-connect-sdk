import { createFluentFamiliesClient, type FluentFamilies, type FluentTokenDefinition } from "@fluent/connect-sdk";
import { openSwapperModal } from "@swapper-finance/deposit-sdk";
import { type ReactNode, useState, useMemo, useEffect } from "react";
import {
  FLUENT_FAMILY_LABELS,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../config";
import { explorerAddress } from "../utils/explorerAddress";
import { WalletMenuBalances } from "./WalletMenuBalances";

function openExternalUrl(url: string) {
  const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
  }
}

export function WalletMenuActionCard({
  session,
  smartAccountAddress,
  faucetBusy,
  onFaucet,
  config,
  renderPermissions,
  tokens,
}: {
  session: FluentWidgetSession | null;
  smartAccountAddress?: string;
  faucetBusy: boolean;
  onFaucet: () => void;
  config?: FluentWidgetConfig;
  renderPermissions?: (context: { session: FluentWidgetSession | null; compact: boolean }) => ReactNode;
  tokens?: readonly FluentTokenDefinition[];
}) {
  const resolvedConfig = resolveFluentWidgetConfig(config);
  const [result, setResult] = useState<FluentFamilies | null>(null);
  const [status, setStatus] = useState("Connect with Fluent ID to load families");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [cardMode, setCardMode] = useState<"actions" | "permissions" | "reputation">("actions");
  const client = useMemo(() => {
    if (!session?.wallet.signerAddress) return null;
    return createFluentFamiliesClient({
      baseUrl: resolvedConfig.publicApiUrl,
    });
  }, [resolvedConfig.publicApiUrl, session]);

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
  }, [client, session]);
  useEffect(() => {
    if (!renderPermissions && cardMode === "permissions") {
      setCardMode("actions");
    }
  }, [cardMode, renderPermissions]);
  const flipped = cardMode !== "actions";
  const toggleMode = (mode: "permissions" | "reputation") => {
    setCardMode((current) => (current === mode ? "actions" : mode));
  };
  const actionAddress = smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const swapperReady =
    resolvedConfig.swapper.enabled &&
    Boolean(resolvedConfig.swapper.integratorId) &&
    Boolean(resolvedConfig.swapper.dstChainId) &&
    Boolean(resolvedConfig.swapper.dstTokenAddress);
  const handleBridge = () => {
    setActionStatus(null);
    openExternalUrl(resolvedConfig.bridgeUrl);
  };
  const handleSwapper = () => {
    setActionStatus(null);
    if (!actionAddress) {
      setActionStatus("Kernel smart wallet is still preparing");
      return;
    }
    if (!swapperReady) {
      setActionStatus("USDnr on-ramp is not configured for this app");
      return;
    }

    try {
      openSwapperModal({
        integratorId: resolvedConfig.swapper.integratorId,
        dstChainId: resolvedConfig.swapper.dstChainId,
        dstTokenAddr: resolvedConfig.swapper.dstTokenAddress,
        depositWalletAddress: actionAddress,
        styles: {
          themeMode: "dark",
          componentStyles: {
            primaryColor: "#FF8FDA",
            accentColor: "#FECCEF",
            sphereColor: "#FF8FDA",
          },
        },
      });
    } catch (error) {
      console.error("[FluentWidget] Failed to open Swapper Finance on-ramp", error);
      setActionStatus(error instanceof Error ? error.message : "Could not open USDnr on-ramp");
    }
  };
  const handleExplorer = () => {
    setActionStatus(null);
    if (!actionAddress) {
      setActionStatus("Kernel smart wallet is still preparing");
      return;
    }
    openExternalUrl(explorerAddress(actionAddress));
  };

  return (
    <div className={`wallet-menu-action-card ${flipped ? "wallet-menu-action-card-flipped" : ""}`}>
      {renderPermissions ? (
        <button
          className="wallet-menu-reputation-trigger"
          type="button"
          aria-pressed={cardMode === "permissions"}
          onClick={() => toggleMode("permissions")}
        >
          <span className="wallet-menu-reputation-title">
            <img src={resolvedConfig.assets.fluentLogo} alt="" aria-hidden="true" />
            <span>Permissions</span>
          </span>
          <span className="wallet-menu-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      ) : null}

      <button
        className="wallet-menu-reputation-trigger"
        type="button"
        aria-pressed={cardMode === "reputation"}
        onClick={() => toggleMode("reputation")}
      >
        <span className="wallet-menu-reputation-title">
          <img src={resolvedConfig.assets.fluentLogo} alt="" aria-hidden="true" />
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
              <button type="button" onClick={handleBridge}>
                <strong>Bridge</strong>
                <span>Move assets to Fluent</span>
              </button>
              <button
                type="button"
                disabled={!actionAddress || !swapperReady}
                onClick={handleSwapper}
              >
                <strong>USDnr on-ramp</strong>
                <span>
                  {actionAddress
                    ? swapperReady
                      ? "Open Swapper Finance"
                      : "On-ramp not configured"
                    : "Kernel wallet preparing"}
                </span>
              </button>
              <button type="button" disabled={!actionAddress} onClick={handleExplorer}>
                <strong>Explorer</strong>
                <span>View Kernel smart wallet</span>
              </button>
              {actionStatus ? <p className="wallet-menu-action-status">{actionStatus}</p> : null}
              <WalletMenuBalances
                accountAddress={actionAddress as `0x${string}` | undefined}
                tokens={tokens}
              />
            </div>
          </div>
          <div className="wallet-menu-flip-face wallet-menu-flip-back">
            {cardMode === "permissions" ? (
              renderPermissions?.({ session, compact: true })
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
                          <small>{FLUENT_FAMILY_LABELS[name]?.[family.tier] ?? "Reputation signal"}</small>
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
