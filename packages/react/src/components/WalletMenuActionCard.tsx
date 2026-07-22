import { createFluentFamiliesClient, type FluentFamilies, type FluentTokenDefinition } from "@fluent/connect-sdk";
import { openSwapperModal } from "@swapper-finance/deposit-sdk";
import { type ReactNode, useState, useMemo, useEffect } from "react";
import {
  FLUENT_FAMILY_LABELS,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../config";
import { isFaucetNetwork } from "../network";
import { explorerAddress } from "../utils/explorerAddress";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { WalletMenuGasPayment } from "./WalletMenuGasPayment";

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
  const [signupRequired, setSignupRequired] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const client = useMemo(() => {
    if (!session?.user.id) return null;
    return createFluentFamiliesClient({
      baseUrl: resolvedConfig.publicApiUrl,
    });
  }, [resolvedConfig.publicApiUrl, session?.user.id]);

  useEffect(() => {
    if (!client) {
      setResult(null);
      setSignupRequired(false);
      setStatus("Connect with Fluent ID to load families");
      return;
    }

    let active = true;
    setSignupRequired(false);
    setStatus("Loading Fluent families");
    client
      .getFamilies(session?.user.id ?? "")
      .then((families) => {
        if (!active) return;
        setResult(families);
        setSignupRequired(false);
        setStatus("Families loaded from Fluent Connect");
      })
      .catch((error) => {
        if (!active) return;
        setResult(null);
        const message = error instanceof Error ? error.message : "Could not load families";
        setSignupRequired(message.toLowerCase().includes("user not found"));
        setStatus(message);
      });
    return () => {
      active = false;
    };
  }, [client, session?.user.id]);

  const actionAddress = smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const faucetAvailable = isFaucetNetwork(resolvedConfig.network);
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
    <Tabs defaultValue="balances" className="w-full flex flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="reputation">Reputation</TabsTrigger>
        <TabsTrigger value="balances">Balances</TabsTrigger>
        <TabsTrigger value="other">Other</TabsTrigger>
      </TabsList>

      <TabsContent value="reputation" className="flex flex-col gap-2 pt-2">
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
        {signupRequired ? (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <strong className="text-sm font-medium">Complete your Fluent Connect profile</strong>
            <span className="text-xs text-muted-foreground">
              Finish signup to unlock your reputation and family tiers.
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              onClick={() => openExternalUrl(resolvedConfig.reputationSignupUrl)}
            >
              Complete signup
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{status}</p>
        )}
      </TabsContent>

      <TabsContent value="balances" className="pt-2">
        <WalletMenuGasPayment
          accountAddress={actionAddress as `0x${string}` | undefined}
          bridgeUrl={resolvedConfig.bridgeUrl}
          ethValueByToken={resolvedConfig.gasPayment.ethValueByToken}
          tokens={tokens}
        />
      </TabsContent>

      <TabsContent value="other" className="flex flex-col gap-2 pt-2">
        {faucetAvailable ? (
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
        ) : null}
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
        {renderPermissions ? (
          <div className="pt-1">{renderPermissions({ session, compact: true })}</div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
