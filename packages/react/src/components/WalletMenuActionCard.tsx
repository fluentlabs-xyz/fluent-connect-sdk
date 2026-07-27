import { createFluentFamiliesClient, type FluentFamilies, type FluentTokenDefinition } from "@fluent/connect-sdk";
import { openSwapperModal } from "@swapper-finance/deposit-sdk";
import { type ReactNode, useState, useMemo, useEffect } from "react";
import {
  FLUENT_FAMILY_LABELS,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../config";
import {
  FLUENT_GAS_PAYMENT_PRIORITY,
  type FluentGasPaymentSymbol,
} from "../gasPayment";
import { isFaucetNetwork } from "../network";
import { explorerAddress } from "../utils/explorerAddress";
import { Button } from "./ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "./ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Icon } from "./Icon";
import { WalletMenuGasPayment } from "./WalletMenuGasPayment";

function openExternalUrl(url: string) {
  const popup = globalThis.window?.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    popup.opener = null;
  }
}

function SettingsActionField({
  title,
  description,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      onClick={onClick}
      className="h-auto w-full justify-between gap-3 whitespace-normal py-3"
    >
      <Field orientation="horizontal" className="min-w-0 flex-1">
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
      </Field>
      <Icon name="arrow-right-s-line" />
    </Button>
  );
}

export function WalletMenuActionCard({
  session,
  smartAccountAddress,
  faucetBusy,
  onFaucet,
  config,
  renderPermissions,
  tokens,
  silentSigningEnabled,
  onSilentSigningChange,
  onDisconnect,
  tab,
  onTabChange,
}: {
  session: FluentWidgetSession | null;
  smartAccountAddress?: string;
  faucetBusy: boolean;
  onFaucet: () => void;
  config?: FluentWidgetConfig;
  renderPermissions?: (context: { session: FluentWidgetSession | null; compact: boolean }) => ReactNode;
  tokens?: readonly FluentTokenDefinition[];
  silentSigningEnabled: boolean;
  onSilentSigningChange: (enabled: boolean) => void;
  onDisconnect: () => void;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const resolvedConfig = resolveFluentWidgetConfig(config);
  const [result, setResult] = useState<FluentFamilies | null>(null);
  const [status, setStatus] = useState("Connect with Fluent ID to load families");
  const [signupRequired, setSignupRequired] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [gasPaymentToken, setGasPaymentToken] = useState<FluentGasPaymentSymbol>("BLEND");
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
    <Tabs value={tab} onValueChange={onTabChange} className="w-full flex flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="home">Home</TabsTrigger>
        <TabsTrigger value="reputation">Reputation</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="home" className="flex flex-col gap-4 pt-2">

        <div className="relative overflow-hidden rounded-xl px-4 py-8 bg-white/10">
          <div className="relative z-10 flex flex-col items-center gap-1">
            <div className="tracking-[.05em]">
              <span className="mr-1 text-3xl font-semibold">$</span>
              <span className="text-3xl font-semibold">17.083</span>
              <span className="text-lg font-semibold opacity-50">,75</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span className="inline-flex items-center gap-0.5">$ +48,30</span>
              <span className="inline-flex items-center text-green-400">
                <Icon name="arrow-up-s-fill" className="size-3.5" />
                <span>2,45%</span>
              </span>
            </div>
          </div>
          {/*<div*/}
          {/*  className="absolute inset-0 z-[1] h-[200%] opacity-25"*/}
          {/*  style={{*/}
          {/*    background:*/}
          {/*      "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",*/}
          {/*    backgroundSize: "150% auto",*/}
          {/*    backgroundPosition: "center center",*/}
          {/*    backgroundRepeat: "no-repeat",*/}
          {/*  }}*/}
          {/*/>*/}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="h-16"
            disabled={!actionAddress || !swapperReady}
            onClick={handleSwapper}
          >
            <div className="flex flex-col items-center gap-1">
              <Icon name="plus" className="size-4" />
              <span>Get USDnr</span>
            </div>
          </Button>
          <Button variant="secondary" className="h-16" onClick={handleBridge}>
            <div className="flex flex-col items-center gap-1">
              <Icon name="arrow-left-right-line" className="size-4" />
              <span>Bridge</span>
            </div>
          </Button>
        </div>

        <WalletMenuGasPayment
          accountAddress={actionAddress as `0x${string}` | undefined}
          bridgeUrl={resolvedConfig.bridgeUrl}
          ethValueByToken={resolvedConfig.gasPayment.ethValueByToken}
          tokens={tokens}
        />
      </TabsContent>

      <TabsContent value="reputation" className="flex flex-col gap-2 pt-2">
        {result ? (
          <FieldGroup className="w-full gap-2">
            {Object.entries(result.families).map(([name, family]) => (
              <FieldLabel key={name}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle className="capitalize">{name}</FieldTitle>
                    <FieldDescription>
                      {FLUENT_FAMILY_LABELS[name]?.[family.tier] ?? "Reputation signal"}
                    </FieldDescription>
                  </FieldContent>
                  <span className="shrink-0 text-sm font-medium">Tier {family.tier}</span>
                </Field>
              </FieldLabel>
            ))}
          </FieldGroup>
        ) : null}
      </TabsContent>

      <TabsContent value="settings" className="flex flex-col gap-6 pt-2">

        <div className="flex flex-col gap-2">

          <span className="text-xs font-medium opacity-50 uppercase">Other</span>
          <FieldGroup className="w-full gap-2">
            {faucetAvailable ? (
              <SettingsActionField
                title={faucetBusy ? "Requesting faucet" : "Faucet"}
                description={session ? "Claim testnet BLEND" : "Connect Fluent ID first"}
                disabled={faucetBusy || !session}
                onClick={onFaucet}
              />
            ) : null}
            <SettingsActionField
              title="Explorer"
              description="View Kernel smart wallet"
              disabled={!actionAddress}
              onClick={handleExplorer}
            />
          </FieldGroup>

        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-50 uppercase">Settings</span>
          <FieldGroup className="w-full gap-2">
            <FieldLabel htmlFor="silent-signing">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Quick sign</FieldTitle>
                  <FieldDescription>
                    Sign transactions without a confirmation popup.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="silent-signing"
                  checked={silentSigningEnabled}
                  onCheckedChange={onSilentSigningChange}
                />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="gas-payment">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Gas payment</FieldTitle>
                  <FieldDescription>
                    Token used to pay for network fees.
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={gasPaymentToken}
                  onValueChange={(value) => {
                    if (value) setGasPaymentToken(value as FluentGasPaymentSymbol);
                  }}
                >
                  <SelectTrigger
                    id="gas-payment"
                    size="sm"
                    className="shrink-0 border-0 bg-transparent px-0 shadow-none dark:bg-transparent dark:hover:bg-transparent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false}>
                    {FLUENT_GAS_PAYMENT_PRIORITY.map((symbol) => (
                      <SelectItem key={symbol} value={symbol}>
                        {symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldLabel>
          </FieldGroup>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-50 uppercase">Account</span>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="justify-between" onClick={onDisconnect}>
              <span>Disconnect</span>
              <Icon name="arrow-right-s-line" />
            </Button>
          </div>
        </div>

      </TabsContent>
    </Tabs>
  );
}
