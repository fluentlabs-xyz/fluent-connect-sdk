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
import { Button } from "./ui/button";
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
    <div className="flex flex-col gap-2">
      {renderPermissions ? (
        <Button
          variant="secondary"
          className="h-auto w-full justify-between px-3 py-2.5"
          aria-pressed={cardMode === "permissions"}
          onClick={() => toggleMode("permissions")}
        >
          <span className="inline-flex items-center gap-2">
            <img src={resolvedConfig.assets.fluentLogo} alt="" aria-hidden="true" className="size-4" />
            Permissions
          </span>
          <span aria-hidden="true" className={cardMode === "permissions" ? "rotate-90" : ""}>
            ›
          </span>
        </Button>
      ) : null}

      <Button
        variant="secondary"
        className="h-auto w-full justify-between px-3 py-2.5"
        aria-pressed={cardMode === "reputation"}
        onClick={() => toggleMode("reputation")}
      >
        <span className="inline-flex items-center gap-2">
          <img src={resolvedConfig.assets.fluentLogo} alt="" aria-hidden="true" className="size-4" />
          Reputation
        </span>
        <span aria-hidden="true" className={cardMode === "reputation" ? "rotate-90" : ""}>
          ›
        </span>
      </Button>

      <section aria-label="Fluent account actions and reputation">
        {cardMode === "actions" ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5 whitespace-normal"
              disabled={faucetBusy || !session}
              onClick={onFaucet}
            >
              <span className="text-sm font-medium leading-none">
                {faucetBusy ? "Requesting faucet" : "Faucet"}
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {session ? "Claim testnet BLEND" : "Connect Fluent ID first"}
              </span>
            </Button>
            <Button
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5 whitespace-normal"
              onClick={handleBridge}
            >
              <span className="text-sm font-medium leading-none">Bridge</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Move assets to Fluent
              </span>
            </Button>
            <Button
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5 whitespace-normal"
              disabled={!actionAddress || !swapperReady}
              onClick={handleSwapper}
            >
              <span className="text-sm font-medium leading-none">USDnr on-ramp</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {actionAddress
                  ? swapperReady
                    ? "Open Swapper Finance"
                    : "On-ramp not configured"
                  : "Kernel wallet preparing"}
              </span>
            </Button>
            <Button
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5 whitespace-normal"
              disabled={!actionAddress}
              onClick={handleExplorer}
            >
              <span className="text-sm font-medium leading-none">Explorer</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                View Kernel smart wallet
              </span>
            </Button>
            {actionStatus ? (
              <p className="text-xs text-muted-foreground">{actionStatus}</p>
            ) : null}
            <WalletMenuBalances
              accountAddress={actionAddress as `0x${string}` | undefined}
              tokens={tokens}
            />
          </div>
        ) : cardMode === "permissions" ? (
          renderPermissions?.({ session, compact: true })
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              {result
                ? Object.entries(result.families).map(([name, family]) => (
                    <div
                      className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 p-2.5"
                      key={name}
                    >
                      <strong className="text-xs font-medium capitalize">{name}</strong>
                      <strong className="text-sm leading-none">Tier {family.tier}</strong>
                      <small className="text-[10px] text-muted-foreground">
                        {FLUENT_FAMILY_LABELS[name]?.[family.tier] ?? "Reputation signal"}
                      </small>
                    </div>
                  ))
                : null}
            </div>
            <p className="text-xs text-muted-foreground">{status}</p>
          </div>
        )}
      </section>
    </div>
  );
}
