import { type FluentAnalyticsTrack } from "../core/analytics";
import {
  createFluentFamiliesClient,
  type FluentFamilies,
  type FluentFamilyType,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { openSwapperModal } from "@swapper-finance/deposit-sdk";
import { type ReactNode, useState, useMemo, useEffect } from "react";
import {
  FLUENT_FAMILY_ACCENTS,
  FLUENT_FAMILY_DISPLAY_NAMES,
  FLUENT_FAMILY_FALLBACK_ACCENT,
  FLUENT_FAMILY_LABELS,
  FLUENT_FAMILY_ORDER,
  FLUENT_FAMILY_TIER_PROGRESS,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "../core/config";
import {
  FLUENT_GAS_PAYMENT_PRIORITY,
  type FluentGasPaymentSymbol,
} from "../core/gasPayment";
import { isFaucetNetwork } from "../core/network";
import { buildFluentBridgeUrl } from "../utils/buildFluentBridgeUrl";
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
import {
  formatFluentPortfolioPnlAbsolute,
  formatFluentPortfolioPnlPercent,
  formatFluentPortfolioTotal,
  getFluentPortfolioPnl,
  sumFluentTokenBalancesUsd,
  useFluentTokenBalances,
} from "../hooks/useFluentTokenBalances";
import { useFluentTokenUsdPrices } from "../hooks/useFluentTokenUsdPrices";
import { Icon, type IconName } from "./Icon";
import { WalletMenuGasPayment } from "./WalletMenuGasPayment";

function openExternalUrl(url: string, label: string, track: FluentAnalyticsTrack) {
  track("outbound_link_clicked", {
    label,
    destination_domain: new URL(url, location.href).hostname,
    surface: "wallet_menu",
  });
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

type ReputationState =
  | { phase: "disconnected" }
  | { phase: "loading" }
  | { phase: "ready"; families: FluentFamilies }
  | { phase: "signup" }
  | { phase: "error"; message: string };

function orderedFamilyKeys(families: Record<string, unknown>): string[] {
  const keys = Object.keys(families);
  const known = FLUENT_FAMILY_ORDER.filter((key) => keys.includes(key)) as string[];
  const rest = keys.filter((key) => !known.includes(key)).sort();
  return [...known, ...rest];
}

function ReputationFamilyCard({ family, tier }: { family: string; tier: string }) {
  const accent = FLUENT_FAMILY_ACCENTS[family] ?? FLUENT_FAMILY_FALLBACK_ACCENT;
  const labels = FLUENT_FAMILY_LABELS[family];
  const progress = FLUENT_FAMILY_TIER_PROGRESS[tier] ?? 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-white/15 bg-black/40 p-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-white/60">
        {FLUENT_FAMILY_DISPLAY_NAMES[family] ?? family}
      </span>

      <div
        className="flex w-fit max-w-full items-center rounded-full border-[0.5px] border-white/20 px-2.5 py-0.5"
        style={{ backgroundImage: `linear-gradient(90deg, ${accent.from}28, ${accent.to}28)` }}
      >
        <span className="truncate text-[12px] font-medium uppercase leading-5 text-white/85">
          {labels?.[tier] ?? "Reputation signal"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {labels ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[9px] font-medium uppercase tracking-[0.06em] text-white/40">
              {labels.D}
            </span>
            <span className="truncate text-[9px] font-medium uppercase tracking-[0.06em] text-white/70">
              {labels.A}
            </span>
          </div>
        ) : null}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              backgroundImage: `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
              boxShadow: `0 0 8px ${accent.from}61`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ReputationNotice({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; icon?: IconName };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 px-4 py-8 text-center">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs opacity-50">{description}</span>
      </div>
      {action ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

interface WalletMenuActionCardProps {
  track: FluentAnalyticsTrack;
  session: FluentWidgetSession | null;
  smartAccountAddress?: string;
  faucetBusy: boolean;
  onFaucet: () => void;
  config: FluentWidgetConfig;
  tokens?: readonly FluentTokenDefinition[];
  gasPaymentToken: FluentGasPaymentSymbol;
  onGasPaymentTokenChange: (token: FluentGasPaymentSymbol) => void;
  silentSigningEnabled: boolean;
  onSilentSigningChange: (enabled: boolean) => void;
  onDisconnect: () => void;
  onConnectWithX: () => void;
  tab: string;
  onTabChange: (tab: string) => void;
  /** The connected account address shown in the header (external EOA or Fluent smart account). */
  connectedAddress?: string;
  /** Bumped after a confirmed widget transaction so balances refetch. */
  balanceRevisionCounter?: number;
}

export function WalletMenuActionCard({
  track,
  session,
  smartAccountAddress,
  faucetBusy,
  onFaucet,
  config,
  tokens,
  gasPaymentToken,
  onGasPaymentTokenChange,
  silentSigningEnabled,
  onSilentSigningChange,
  onDisconnect,
  onConnectWithX,
  tab,
  onTabChange,
  connectedAddress,
  balanceRevisionCounter,
}: WalletMenuActionCardProps) {
  const resolvedConfig = resolveFluentWidgetConfig(config);
  const [reputation, setReputation] = useState<ReputationState>({ phase: "disconnected" });
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const client = useMemo(() => {
    if (!session?.user.id) return null;
    return createFluentFamiliesClient({
      baseUrl: resolvedConfig.publicApiUrl,
    });
  }, [resolvedConfig.publicApiUrl, session?.user.id]);

  useEffect(() => {
    if (!client) {
      setReputation({ phase: "disconnected" });
      return;
    }

    let active = true;
    setReputation({ phase: "loading" });
    client
      .getFamilies(session?.user.id ?? "")
      .then((families) => {
        if (!active) return;
        // A session can exist before the reputation profile does, in which case
        // the API answers 200 with nothing to show.
        setReputation(
          Object.keys(families.families ?? {}).length > 0
            ? { phase: "ready", families }
            : { phase: "signup" },
        );
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not load families";
        setReputation(
          message.toLowerCase().includes("user not found")
            ? { phase: "signup" }
            : { phase: "error", message },
        );
      });
    return () => {
      active = false;
    };
  }, [client, session?.user.id]);

  const actionAddress = smartAccountAddress ?? session?.wallet.smartAccountAddress;
  const bridgeRecipientAddress = connectedAddress ?? actionAddress;
  const faucetAvailable = isFaucetNetwork(resolvedConfig.network);
  const swapperReady =
    resolvedConfig.swapper.enabled &&
    Boolean(resolvedConfig.swapper.integratorId) &&
    Boolean(resolvedConfig.swapper.dstChainId) &&
    Boolean(resolvedConfig.swapper.dstTokenAddress);
  const handleBridge = () => {
    setActionStatus(null);
    if (!bridgeRecipientAddress) {
      setActionStatus("Wallet address is still preparing");
      return;
    }
    openExternalUrl(
      buildFluentBridgeUrl(resolvedConfig.bridgeUrl, bridgeRecipientAddress),
      "bridge",
      track,
    );
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
    openExternalUrl(explorerAddress(actionAddress, resolvedConfig.network), "explorer", track);
  };

  // Balances/portfolio track the account shown in the header: the connected
  // external EOA (MetaMask) when present, otherwise the Fluent smart account.
  // `actionAddress` (smart-account-only) still drives faucet / on-ramp actions.
  const accountAddress = (connectedAddress ?? actionAddress) as `0x${string}` | undefined;
  const { balances, busy: balancesBusy, gasTokens } = useFluentTokenBalances({
    accountAddress,
    tokens,
    revisionCounter: balanceRevisionCounter,
  });
  const priceSymbols = useMemo(() => gasTokens.map((token) => token.symbol), [gasTokens]);
  const { prices, pricesYesterday, busy: pricesBusy } = useFluentTokenUsdPrices(priceSymbols);
  const portfolioTotal = useMemo(
    () => sumFluentTokenBalancesUsd(balances, prices),
    [balances, prices],
  );
  const portfolioTotalYesterday = useMemo(
    () => sumFluentTokenBalancesUsd(balances, pricesYesterday),
    [balances, pricesYesterday],
  );
  const portfolioPnl = useMemo(
    () =>
      getFluentPortfolioPnl({
        currentTotal: portfolioTotal,
        previousTotal: portfolioTotalYesterday,
      }),
    [portfolioTotal, portfolioTotalYesterday],
  );
  const portfolioDisplay =
    portfolioTotal === null ? null : formatFluentPortfolioTotal(portfolioTotal);
  const portfolioLoading = Boolean(accountAddress) && (balancesBusy || pricesBusy);
  const hasReadyBalances = balances.some(
    (balance) => balance.status === "ready" && balance.raw !== null && balance.raw > 0n,
  );
  const portfolioUnavailable =
    Boolean(accountAddress) && !portfolioLoading && hasReadyBalances && portfolioTotal === null;

  return (
    <Tabs value={tab} onValueChange={onTabChange} className="w-full flex flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="home">Home</TabsTrigger>
        <TabsTrigger value="reputation">Reputation</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="home" className="flex flex-col gap-4 pt-2">

        <div className="flex flex-col gap-2">
          <div className="relative overflow-hidden rounded-xl px-4 py-8 bg-white/5">
            <div className="relative z-10 flex flex-col items-center gap-1">
              <div className="tracking-[.05em]">
                {portfolioDisplay ? (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">{portfolioDisplay.whole}</span>
                    <span className="text-lg font-semibold opacity-50">,{portfolioDisplay.fraction}</span>
                  </>
                ) : portfolioLoading ? (
                  <span
                    className="inline-block h-9 w-28 animate-pulse rounded-md bg-white/10"
                    aria-label="Loading portfolio total"
                  />
                ) : portfolioUnavailable ? (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">—</span>
                  </>
                ) : (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">0</span>
                    <span className="text-lg font-semibold opacity-50">,00</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium">
                {portfolioPnl ? (
                  <>
                    <span className="inline-flex items-center gap-0.5">
                      {formatFluentPortfolioPnlAbsolute(portfolioPnl.delta)}
                    </span>
                    {portfolioPnl.percent !== null ? (
                      <span
                        className={`inline-flex items-center ${
                          portfolioPnl.delta >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        <Icon
                          name={portfolioPnl.delta >= 0 ? "arrow-up-s-fill" : "arrow-down-s-fill"}
                          className="size-3.5"
                        />
                        <span>{formatFluentPortfolioPnlPercent(portfolioPnl.percent)}</span>
                      </span>
                    ) : null}
                  </>
                ) : portfolioLoading ? (
                  <span
                    className="inline-block h-4 w-24 animate-pulse rounded-md bg-white/10"
                    aria-label="Loading portfolio pnl"
                  />
                ) : (
                  <>
                    <span className="inline-flex items-center gap-0.5">$ +0,00</span>
                    <span className="inline-flex items-center text-green-400">
                      <Icon name="arrow-up-s-fill" className="size-3.5" />
                      <span>0,00%</span>
                    </span>
                  </>
                )}
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
        </div>

        <WalletMenuGasPayment
          accountAddress={accountAddress}
          balances={balances}
          busy={balancesBusy}
          usdPrices={prices}
          bridgeUrl={resolvedConfig.bridgeUrl}
          ethValueByToken={resolvedConfig.gasPayment.ethValueByToken}
          tokens={tokens}
          selectedSymbol={gasPaymentToken}
        />
      </TabsContent>

      <TabsContent value="reputation" className="flex flex-col gap-2 pt-2">
        {reputation.phase === "ready" ? (
          <div className="flex flex-col gap-2">
            {orderedFamilyKeys(reputation.families.families).map((name) => (
              <ReputationFamilyCard
                key={name}
                family={name}
                tier={reputation.families.families[name as FluentFamilyType].tier}
              />
            ))}
          </div>
        ) : null}

        {reputation.phase === "loading" ? (
          <ReputationNotice title="Loading reputation" description="Fetching your Fluent families." />
        ) : null}

        {reputation.phase === "disconnected" ? (
          <ReputationNotice
            title="Not connected"
            description="Connect with Fluent ID to see your reputation."
          />
        ) : null}

        {reputation.phase === "signup" ? (
          <ReputationNotice
            title="No reputation available"
            description="Connect your X account to access your reputation."
            action={{
              label: "Connect with X",
              icon: "x",
              onClick: onConnectWithX,
            }}
          />
        ) : null}

        {reputation.phase === "error" ? (
          <ReputationNotice title="Could not load reputation" description={reputation.message} />
        ) : null}
      </TabsContent>

      <TabsContent value="settings" className="flex flex-col gap-6 pt-2">

        

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-50 uppercase">Preferences</span>
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
                  onCheckedChange={(enabled) => {
                    track("wallet_silent_signing_toggled", { enabled });
                    onSilentSigningChange(enabled);
                  }}
                />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="gas-payment">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Gas payment</FieldTitle>
                  <FieldDescription>
                    Token used to pay transaction fees.
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={gasPaymentToken}
                  onValueChange={(value) => {
                    if (value) {
                      track("wallet_gas_token_selected", { symbol: value });
                      onGasPaymentTokenChange(value as FluentGasPaymentSymbol);
                    }
                  }}
                >
                  <SelectTrigger
                    id="gas-payment"
                    size="sm"
                    className="shrink-0 border-0 bg-transparent p-0 !h-auto shadow-none dark:bg-transparent dark:hover:bg-transparent"
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

          <span className="text-xs font-medium opacity-50 uppercase">Developer</span>
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
          <span className="text-xs font-medium opacity-50 uppercase">Account</span>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="justify-between" onClick={onDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>

      </TabsContent>
    </Tabs>
  );
}
