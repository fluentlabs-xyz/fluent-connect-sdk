import { QueryClientContext } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { BridgeActivityDetail } from "../bridge/BridgeActivityDetail";
import { FluentActivityDetail, type FluentActivitySelection } from "./FluentActivityDetail";
import type { BridgeActivitySelection } from "../bridge/historyRows";
import { type FluentAnalyticsTrack } from "../core/analytics";
import { debugError } from "../core/debugLogger";
import {
  createFluentFamiliesClient,
  isFluentNativeToken,
  type FluentFamilies,
  type FluentFamilyType,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { type ReactNode, useContext, useEffect, useMemo, useState } from "react";
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
  deriveFluentGasEthRates,
  FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
  type FluentGasTokenSymbol,
} from "../core/gasPayment";
import { isFaucetNetwork } from "../core/network";
import type { UserTokenStore } from "../core/userTokens";
import type { FluentAccountType } from "../widget/batchOperation";
import type {
  FluentPendingTransfer,
  FluentTokenTransferSender,
} from "../widget/tokenTransfer";
import type { FluentUsdnrMinter } from "../widget/usdnrMint";
import { explorerAddress, FLUENT_DECIMAL_SEPARATOR } from "../utils";
import { cn } from "../lib/utils";
import { SendTokenForm } from "./SendTokenForm";
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
import { Spinner } from "./ui/spinner";
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
import { useFluentTransactionHistory } from "../hooks/useFluentTransactionHistory";
import { Icon, type IconName } from "./Icon";
import { WalletMenuTokenList } from "./WalletMenuTokenList";
import {
  formatBridgeRowUsd,
  formatFluentEntryUsd,
  useActivityPrices,
  WalletMenuActivity,
} from "./WalletMenuActivity";

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
    <div className="flex flex-col gap-2.5 rounded-xl border border-foreground/15 bg-background/40 p-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-foreground/60">
        {FLUENT_FAMILY_DISPLAY_NAMES[family] ?? family}
      </span>

      <div
        className="flex w-fit max-w-full items-center rounded-full border-[0.5px] border-foreground/20 px-2.5 py-0.5"
        style={{ backgroundImage: `linear-gradient(90deg, ${accent.from}28, ${accent.to}28)` }}
      >
        <span className="truncate text-[12px] font-medium uppercase leading-5 text-foreground/85">
          {labels?.[tier] ?? "Reputation signal"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {labels ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[9px] font-medium uppercase tracking-[0.06em] text-foreground/40">
              {labels.D}
            </span>
            <span className="truncate text-[9px] font-medium uppercase tracking-[0.06em] text-foreground/70">
              {labels.A}
            </span>
          </div>
        ) : null}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/15">
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
    <div className="flex flex-col items-center gap-3 rounded-xl bg-foreground/5 px-4 py-8 text-center">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs opacity-50">{description}</span>
      </div>
      {action ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.icon ? <Icon name={action.icon} className="size-4 shrink-0" aria-hidden /> : <ExternalLink className="size-4 shrink-0" aria-hidden />}
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * What the Settings screen says about a preference an External wallet cannot
 * have. One string, because Quick sign and Gas payment are unavailable to it
 * for the same reason and must not drift apart.
 */
const PREFERENCE_NEEDS_SMART_ACCOUNT = "Available with a Fluent smart account";

interface WalletMenuActionCardProps {
  track: FluentAnalyticsTrack;
  session: FluentWidgetSession | null;
  smartAccountAddress?: string;
  faucetBusy: boolean;
  onFaucet: () => void;
  config: FluentWidgetConfig;
  tokens?: readonly FluentTokenDefinition[];
  gasPaymentToken: FluentGasTokenSymbol;
  onGasPaymentTokenChange: (token: FluentGasTokenSymbol) => void;
  silentSigningEnabled: boolean;
  onSilentSigningChange: (enabled: boolean) => void;
  onDisconnect: () => void;
  onConnectWithX: () => void;
  tab: string;
  onTabChange: (tab: string) => void;
  /**
   * Which Home panel is showing, "tokens" or "activity". Optional, and only
   * because the preview harnesses render this card outside a drawer; the widget
   * must pass it, or a panel opened for a settled transfer dies with the card
   * the review modal unmounted.
   */
  panel?: string;
  onPanelChange?: (panel: string) => void;
  /** The connected account address shown in the header (external EOA or Fluent smart account). */
  connectedAddress?: string;
  /**
   * Which account this menu is for. An External wallet (`"eoa"`) confirms every
   * call in the wallet itself and pays the chain's own gas, so it has neither
   * Quick sign nor a Gas token to choose and no Fluent smart account to claim a
   * faucet for; Settings shows both preferences disabled, hides Faucet and
   * sends Explorer to the EOA's own address.
   *
   * Optional, and absent reads as a Fluent ID: this card is exported
   * (`src/index.ts`), and the preview harnesses mount it with no account at all.
   */
  accountKind?: FluentAccountType;
  /** The External wallet that signs bridge deposits, while one is connected. */
  externalWalletAddress?: string;
  /** Bumped after a confirmed widget transaction so balances refetch. */
  balanceRevisionCounter?: number;
  /**
   * Where this person's hand-added tokens live. The service's store while the
   * widget holds a Fluent token, this browser's otherwise.
   */
  userTokenStore?: UserTokenStore;
  /**
   * True while the stored settings are still on their way. The preferences and
   * the token actions stay disabled so the answer cannot overwrite a choice
   * made while it was in flight.
   */
  settingsPending?: boolean;
  /** A preference the service refused to store. */
  settingsError?: string | null;
  /** A token write the service refused. */
  tokenListError?: string | null;
  /**
   * Moves a token out of this account. Absent where nothing can execute — the
   * preview harnesses render the card outside the widget — and the Send button
   * is then disabled rather than hidden.
   */
  onSendToken?: FluentTokenTransferSender;
  /** Transfers sent from here that have not settled yet, listed in Activity. */
  pendingTransfers?: readonly FluentPendingTransfer[];
  /**
   * Mints testnet USDnr into this account. On a faucet network Get USDnr runs
   * this instead of opening the Swapper Finance on-ramp, which has nothing to
   * sell on a testnet, and the USDnr contract there mints to whoever asks.
   *
   * Absent where nothing can execute — the preview harnesses render this card
   * outside the widget — and Get USDnr then opens the on-ramp on both networks,
   * under the on-ramp's own rule.
   */
  onMintUsdnr?: FluentUsdnrMinter;
  /**
   * True while a mint is in flight, and the one thing that disables Get USDnr
   * on the mint path. An address that has not arrived yet does not: a press
   * reports it in the status line, the way Send does, which says more than a
   * button nothing explains. Held by the widget rather than here, because the
   * review modal closes the drawer and unmounts this card mid-mint.
   */
  mintUsdnrBusy?: boolean;
  /**
   * Brings the account drawer back up. A transaction review closes it on its
   * way in, so without this a transfer that settles has nowhere to report
   * itself. Absent in the preview harnesses, which render the card with no
   * drawer around it.
   */
  onRevealAccount?: () => void;
  /**
   * What pays a transfer's fee, for the Send page's fee selector and warnings.
   * Defaults describe the Fluent smart account with no sponsorship, which is
   * the conservative reading: it warns where a sponsoring App would not need to.
   */
  gasContext?: {
    /** False for an external wallet, which has no paymaster to charge a token. */
    erc20Gas: boolean;
    /** True where the App's paymaster may cover a native-gas operation. */
    sponsorshipAvailable: boolean;
  };
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
  panel,
  onPanelChange,
  connectedAddress,
  accountKind,
  externalWalletAddress,
  balanceRevisionCounter,
  userTokenStore,
  settingsPending = false,
  settingsError = null,
  tokenListError = null,
  onSendToken,
  pendingTransfers,
  onMintUsdnr,
  mintUsdnrBusy = false,
  onRevealAccount,
  gasContext,
}: WalletMenuActionCardProps) {
  const resolvedConfig = resolveFluentWidgetConfig(config);
  // Which of the two home panels is showing. Held by the caller, not here: a
  // transaction review closes the drawer, which unmounts this card, so a panel
  // chosen while a transfer was in flight would be lost by the time it settled.
  // The harnesses render the card with no drawer, so they may keep it local.
  const [ownPanel, setOwnPanel] = useState("tokens");
  const homePanel = panel ?? ownPanel;
  const setHomePanel = onPanelChange ?? setOwnPanel;
  // Activity is two cached queries; a refresh invalidates both and spins until
  // they are back. The harnesses mount this card without a query client.
  const queryClient = useContext(QueryClientContext);
  // Activity lists two sources: the account's transactions, restarted by the
  // revision bump, and the bridge's two cached queries. The harnesses mount
  // this card without a query client.
  const [historyRevision, setHistoryRevision] = useState(0);
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const refreshActivity = async () => {
    if (refreshingActivity) return;
    setHistoryRevision((value) => value + 1);
    if (!queryClient) return;
    setRefreshingActivity(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["fluent-bridge-tx-history"] }),
        queryClient.invalidateQueries({ queryKey: ["fluent-bridge-hyperlane-history"] }),
      ]);
    } finally {
      setRefreshingActivity(false);
    }
  };
  // The row opened from Activity; the `activity` sub-page shows it.
  const [activity, setActivity] = useState<
    | { kind: "bridge"; selection: BridgeActivitySelection }
    | { kind: "fluent"; selection: FluentActivitySelection }
    | null
  >(null);
  const [reputation, setReputation] = useState<ReputationState>({ phase: "disconnected" });
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const reputationEnabled = resolvedConfig.reputationEnabled;
  const client = useMemo(() => {
    // Nothing renders the families response when the tab is off, so don't ask for it.
    if (!reputationEnabled) return null;
    if (!session?.user.id) return null;
    // No public API base for this network (e.g. mainnet until it's wired) →
    // skip the client entirely instead of firing requests at an empty/relative
    // URL that would 404 against the host origin.
    if (!resolvedConfig.publicApiUrl) return null;
    return createFluentFamiliesClient({
      baseUrl: resolvedConfig.publicApiUrl,
    });
  }, [reputationEnabled, resolvedConfig.publicApiUrl, session?.user.id]);

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
  // An External wallet on its own: no Fluent smart account behind it, so the
  // two preferences describe nothing it does and there is no account for the
  // faucet to fund. Everything this screen says about them follows from here.
  const externalWalletAccount = accountKind === "eoa";
  const faucetAvailable = isFaucetNetwork(resolvedConfig.network);
  // The faucet funds a Fluent smart account, so an External wallet has nothing
  // to claim: the row is hidden rather than shown disabled, which is what it
  // was while it read "Connect Fluent ID first".
  const faucetOffered = faucetAvailable && !externalWalletAccount;
  // Set exactly where Get USDnr mints instead of opening the on-ramp. Both
  // halves matter: the on-ramp sells nothing on a testnet, and only the widget
  // can execute a mint — a direct consumer of this card passes no minter and
  // keeps the on-ramp on both networks, as it had before there was a mint.
  const usdnrMinter = faucetAvailable ? onMintUsdnr : undefined;
  const swapperReady =
    resolvedConfig.swapper.enabled &&
    Boolean(resolvedConfig.swapper.integratorId) &&
    Boolean(resolvedConfig.swapper.dstChainId) &&
    Boolean(resolvedConfig.swapper.dstTokenAddress);
  const handleSwapper = async () => {
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
      // Loaded on click, not at the top of the file: `deposit-sdk@0.2.14`'s
      // dist imports its own files without extensions, which Node's ESM
      // resolver rejects — a static import here would make the package entry
      // unimportable in plain Node and Jest (FLU-1559).
      const { openSwapperModal } = await import("@swapper-finance/deposit-sdk");
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
      debugError("[FluentWidget] Failed to open Swapper Finance on-ramp", error);
      setActionStatus(error instanceof Error ? error.message : "Could not open USDnr on-ramp");
    }
  };
  // The account Explorer opens: the EOA itself for an External wallet, which
  // has no smart account to look at, the Fluent smart account otherwise.
  const explorerTarget = externalWalletAccount ? connectedAddress : actionAddress;
  const handleExplorer = () => {
    setActionStatus(null);
    if (!explorerTarget) {
      setActionStatus(
        externalWalletAccount
          ? "Wallet address is still preparing"
          : "Kernel smart wallet is still preparing",
      );
      return;
    }
    openExternalUrl(explorerAddress(explorerTarget, resolvedConfig.network), "explorer", track);
  };

  // Balances/portfolio track the account shown in the header: the connected
  // external EOA (MetaMask) when present, otherwise the Fluent smart account.
  // `actionAddress` (smart-account-only) still drives faucet / on-ramp actions.
  const accountAddress = (connectedAddress ?? actionAddress) as `0x${string}` | undefined;

  // Only opens the page. The transfer is the page's business: it has no address
  // and no amount to send yet.
  const handleSend = () => {
    setActionStatus(null);
    if (!accountAddress) {
      setActionStatus("Wallet address is still preparing");
      return;
    }
    track("wallet_send_opened");
    onTabChange("send");
  };

  // The testnet half of Get USDnr. The recipient is the Widget account, the
  // address the balances above it are read for and Send sends from — not the
  // Fluent smart account, which an External wallet does not have and which
  // would put the money where this menu never looks.
  const handleMintUsdnr = async (mint: FluentUsdnrMinter) => {
    setActionStatus(null);
    if (!accountAddress) {
      // The same answer Send gives, and for the same reason: the address is on
      // its way, a press is how the person finds that out, and nothing is
      // built until there is somewhere for the money to go.
      setActionStatus("Wallet address is still preparing");
      return;
    }
    await mint(accountAddress);
  };

  const {
    balances,
    busy: balancesBusy,
    displayTokens,
    gasTokens,
    addUserToken,
    removeUserToken,
  } = useFluentTokenBalances({
    accountAddress,
    tokens,
    revisionCounter: balanceRevisionCounter,
    userTokenStore,
  });
  // Prices come back keyed by token identity, and only for tokens Fluent ships.
  // Anything else renders its balance without a USD line and stays out of the
  // portfolio total.
  const { prices, pricesYesterday, busy: pricesBusy } =
    useFluentTokenUsdPrices(displayTokens);
  // For the activity detail's line under the amount, by the list's own lookup.
  const activityPriceOf = useActivityPrices(prices, displayTokens);
  const {
    transactions,
    busy: transactionsBusy,
    loadingMore: transactionsLoadingMore,
    hasMore: hasMoreTransactions,
    loadMore: loadMoreTransactions,
    error: transactionsError,
  } = useFluentTransactionHistory({
    accountAddress,
    // The same Display tokens the token list renders, so both screens answer
    // for one set of tokens — including the ones this person added by hand.
    tokens: displayTokens,
    enabled: tab === "home" && homePanel === "activity",
    revisionCounter: (balanceRevisionCounter ?? 0) + historyRevision,
  });
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
  // Lets the Send page call a fee balance too small without the App having
  // configured a single rate — the prices above are already here.
  const gasEthRates = useMemo(
    () =>
      deriveFluentGasEthRates({
        tokens: gasTokens,
        usdPrices: prices,
        configured: resolvedConfig.gasPayment.ethValueByToken,
      }),
    [gasTokens, prices, resolvedConfig.gasPayment.ethValueByToken],
  );
  // What an External wallet pays fees in, whatever the App configured as its
  // default gas token: it has no paymaster to charge a token, so this is the
  // only value the disabled Gas payment selector may show for it.
  const nativeGasToken = useMemo(
    () => gasTokens.find(isFluentNativeToken)?.symbol ?? FLUENT_WIDGET_DEFAULT_GAS_TOKEN,
    [gasTokens],
  );
  const portfolioDisplay =
    portfolioTotal === null ? null : formatFluentPortfolioTotal(portfolioTotal);
  const portfolioLoading = Boolean(accountAddress) && (balancesBusy || pricesBusy);
  const hasReadyBalances = balances.some(
    (balance) => balance.status === "ready" && balance.raw !== null && balance.raw > 0n,
  );
  const portfolioUnavailable =
    Boolean(accountAddress) && !portfolioLoading && hasReadyBalances && portfolioTotal === null;

  // A failed write outranks the last action's outcome: it is the newer fact,
  // and every preference action clears the old one before it starts.
  const statusLine = settingsError ?? actionStatus;

  if (tab === "settings") {
    return (
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-50 uppercase">Preferences</span>
          <FieldGroup className="w-full gap-2">
            <FieldLabel htmlFor="silent-signing">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Quick sign</FieldTitle>
                  <FieldDescription>
                    {externalWalletAccount
                      ? PREFERENCE_NEEDS_SMART_ACCOUNT
                      : "Sign transactions without a confirmation popup."}
                  </FieldDescription>
                </FieldContent>
                {/* Off for an External wallet, and not merely disabled: its
                    calls are confirmed in the wallet whatever this holds, and a
                    switch left standing on means the opposite. */}
                <Switch
                  id="silent-signing"
                  checked={externalWalletAccount ? false : silentSigningEnabled}
                  disabled={settingsPending || externalWalletAccount}
                  onCheckedChange={(enabled) => {
                    setActionStatus(null);
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
                    {externalWalletAccount
                      ? PREFERENCE_NEEDS_SMART_ACCOUNT
                      : "Token used to pay transaction fees."}
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={externalWalletAccount ? nativeGasToken : gasPaymentToken}
                  disabled={settingsPending || externalWalletAccount}
                  onValueChange={(value) => {
                    if (value) {
                      setActionStatus(null);
                      track("wallet_gas_token_selected", { symbol: value });
                      onGasPaymentTokenChange(value);
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
                    {gasTokens.map((token) => (
                      <SelectItem key={token.symbol} value={token.symbol}>
                        {token.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldLabel>
          </FieldGroup>
          {/* The one status line of this screen: a preference the service
              refused, or the outcome of a Developer action below. */}
          {statusLine ? (
            <p className="text-xs text-destructive" role="status">
              {statusLine}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-50 uppercase">Developer</span>
          <FieldGroup className="w-full gap-2">
            {faucetOffered ? (
              <SettingsActionField
                title={faucetBusy ? "Requesting faucet" : "Faucet"}
                description={session ? "Claim testnet BLEND" : "Connect Fluent ID first"}
                disabled={faucetBusy || !session}
                onClick={onFaucet}
              />
            ) : null}
            <SettingsActionField
              title="Explorer"
              description={
                externalWalletAccount ? "View account on explorer" : "View Kernel smart wallet"
              }
              disabled={!explorerTarget}
              onClick={handleExplorer}
            />
          </FieldGroup>
        </div>

      </div>
    );
  }

  if (tab === "send") {
    // Reached only through the Send button, which stays disabled without a
    // sender — so this branch is for a `tab` restored from somewhere else.
    if (!onSendToken) return null;
    return (
      <SendTokenForm
        tokens={displayTokens}
        balances={balances}
        balancesBusy={balancesBusy}
        accountAddress={accountAddress}
        usdPrices={prices}
        gasTokens={gasTokens}
        defaultGasSymbol={gasPaymentToken}
        erc20GasAvailable={gasContext?.erc20Gas ?? true}
        sponsorshipAvailable={gasContext?.sponsorshipAvailable ?? false}
        ethValueByToken={gasEthRates}
        onSend={onSendToken}
        // The transfer's own row is the receipt now, so land on it rather than
        // on the token list. `onRevealAccount` matters on the path that showed
        // a review: opening it closed the drawer, and a panel switched behind a
        // closed drawer would leave a settled transfer with nothing to show for
        // it at all.
        onSent={() => {
          setHomePanel("activity");
          onTabChange("home");
          onRevealAccount?.();
        }}
      />
    );
  }

  if (tab === "activity") {
    if (!activity) return null;
    return activity.kind === "bridge" ? (
      <BridgeActivityDetail
        selection={activity.selection}
        network={resolvedConfig.network}
        usd={formatBridgeRowUsd(activity.selection.row, activityPriceOf)}
        track={track}
      />
    ) : (
      <FluentActivityDetail
        selection={activity.selection}
        network={resolvedConfig.network}
        usd={formatFluentEntryUsd(activity.selection.entry, activityPriceOf)}
        track={track}
      />
    );
  }

  return (
    // With Reputation off, Home is the only panel: the strip goes away, and the
    // active value is pinned so a `tab` left on "reputation" can't blank the card.
    <Tabs
      value={reputationEnabled ? tab : "home"}
      onValueChange={onTabChange}
      className="w-full flex flex-col"
    >
      {reputationEnabled ? (
        <TabsList className="w-full">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="reputation">Reputation</TabsTrigger>
        </TabsList>
      ) : null}

      <TabsContent
        value="home"
        className={`flex flex-col gap-4${reputationEnabled ? " pt-2" : ""}`}
      >

        <div className="flex flex-col gap-2">
          <div className="relative overflow-hidden px-4 py-8">
            <div className="relative z-10 flex flex-col items-center gap-1">
              <div className="tracking-[.05em] leading-none">
                {portfolioDisplay ? (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">{portfolioDisplay.whole}</span>
                    <span className="text-lg font-semibold opacity-50">
                      {portfolioDisplay.separator}
                      {portfolioDisplay.fraction}
                    </span>
                  </>
                ) : portfolioLoading ? (
                  <span
                    className="relative inline-flex items-baseline"
                    aria-busy="true"
                    aria-label="Loading portfolio total"
                  >
                    <span className="invisible" aria-hidden="true">
                      <span className="mr-1 text-3xl font-semibold">$</span>
                      <span className="text-3xl font-semibold">0</span>
                      <span className="text-lg font-semibold">{FLUENT_DECIMAL_SEPARATOR}00</span>
                    </span>
                    <span className="absolute inset-0 animate-pulse rounded-md bg-foreground/10" />
                  </span>
                ) : portfolioUnavailable ? (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">—</span>
                  </>
                ) : (
                  <>
                    <span className="mr-1 text-3xl font-semibold">$</span>
                    <span className="text-3xl font-semibold">0</span>
                    <span className="text-lg font-semibold opacity-50">{FLUENT_DECIMAL_SEPARATOR}00</span>
                  </>
                )}
              </div>
              <div className="flex min-h-4 items-center gap-1.5 text-xs font-medium leading-none">
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
                    className="relative inline-flex items-center gap-1.5"
                    aria-busy="true"
                    aria-label="Loading portfolio pnl"
                  >
                    <span className="invisible inline-flex items-center gap-1.5" aria-hidden="true">
                      <span className="inline-flex items-center gap-0.5">$ +0{FLUENT_DECIMAL_SEPARATOR}00</span>
                      <span className="inline-flex items-center">
                        <Icon name="arrow-up-s-fill" className="size-3.5" />
                        <span>0{FLUENT_DECIMAL_SEPARATOR}00%</span>
                      </span>
                    </span>
                    <span className="absolute inset-0 animate-pulse rounded-md bg-foreground/10" />
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-0.5">$ +0{FLUENT_DECIMAL_SEPARATOR}00</span>
                    <span className="inline-flex items-center text-green-400">
                      <Icon name="arrow-up-s-fill" className="size-3.5" />
                      <span>0{FLUENT_DECIMAL_SEPARATOR}00%</span>
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
          {/* The ways money gets in and out. Send and Bridge are sub-pages, opened
              the way the account menu opens Settings; the on-ramp is a modal, and
              stays disabled with the reason on hover when this app has none.
              The mint is neither: it is an operation, so it only ever waits on
              itself — not on a smart account it does not need, and not on an
              on-ramp configuration it never reads. */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="secondary"
              className="h-16 w-full"
              disabled={usdnrMinter ? mintUsdnrBusy : !actionAddress || !swapperReady}
              title={usdnrMinter || swapperReady ? undefined : "Not configured for this app"}
              onClick={usdnrMinter ? () => handleMintUsdnr(usdnrMinter) : handleSwapper}
            >
              <div className="flex flex-col items-center gap-1">
                <Icon name="plus" className="size-4" />
                <span>Get USDnr</span>
              </div>
            </Button>
            <Button
              variant="secondary"
              className="h-16 w-full"
              disabled={!accountAddress || !onSendToken}
              onClick={handleSend}
            >
              <div className="flex flex-col items-center gap-1">
                <Icon name="arrow-up-line" className="size-4" />
                <span>Send</span>
              </div>
            </Button>
            <Button
              variant="secondary"
              className="h-16 w-full"
              onClick={() => onTabChange("bridge")}
            >
              <div className="flex flex-col items-center gap-1">
                <Icon name="arrow-left-right-line" className="size-4" />
                <span>Bridge</span>
              </div>
            </Button>
          </div>
          {statusLine ? (
            <p className="text-xs text-destructive" role="status">
              {statusLine}
            </p>
          ) : null}
        </div>

        <Tabs value={homePanel} onValueChange={setHomePanel} className="flex w-full flex-col">
          <div className="flex items-center justify-between">
            <TabsList variant="line">
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            {homePanel === "activity" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh activity"
                className="rounded-full"
                disabled={transactionsBusy || refreshingActivity}
                onClick={refreshActivity}
              >
                <RefreshCw
                  className={cn("size-3.5", refreshingActivity && "animate-spin")}
                  aria-hidden
                />
              </Button>
            ) : null}
          </div>

          <TabsContent value="tokens" className="pt-2">
            <WalletMenuTokenList
              accountAddress={accountAddress}
              balances={balances}
              busy={balancesBusy}
              usdPrices={prices}
              tokens={displayTokens}
              selectedSymbol={gasPaymentToken}
              onAddUserToken={addUserToken}
              onRemoveUserToken={removeUserToken}
              actionsDisabled={settingsPending}
              error={tokenListError}
            />
          </TabsContent>

          <TabsContent value="activity" className="pt-2">
            <WalletMenuActivity
              network={resolvedConfig.network}
              fluent={{
                address: accountAddress,
                label: actionAddress ? "Fluent account" : "Wallet",
                entries: transactions,
                pending: pendingTransfers,
                busy: transactionsBusy,
                loadingMore: transactionsLoadingMore,
                hasMore: hasMoreTransactions,
                loadMore: loadMoreTransactions,
                error: transactionsError,
              }}
              externalWalletAddress={externalWalletAddress}
              usdPrices={prices}
              tokens={displayTokens}
              onOpenBridgeRow={(selection) => {
                setActivity({ kind: "bridge", selection });
                onTabChange("activity");
              }}
              onOpenFluentEntry={(entry) => {
                if (!accountAddress) return;
                setActivity({ kind: "fluent", selection: { entry, account: accountAddress } });
                onTabChange("activity");
              }}
            />
          </TabsContent>
        </Tabs>
      </TabsContent>

      {reputationEnabled ? (
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
            <div
              className="flex items-center justify-center rounded-xl bg-foreground/5 px-4 py-8"
              aria-busy="true"
              aria-label="Loading reputation"
            >
              <Spinner className="size-5 text-foreground/70" />
            </div>
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
      ) : null}
    </Tabs>
  );
}
