import {
  getFluentChainForNetwork,
  type FluentGasTokenSymbol,
  type FluentTokenDefinition,
  type FluentWidgetConfig,
  type FluentWidgetNetwork,
} from "@fluent.xyz/connect";
import {
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
} from "@fluent.xyz/connect/internal/network";
import { encodeFunctionData, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { PRIVY_CLIENT_ID } from "./privyClientId";

// The Network `config/*.env` names (scripts/with-config.mjs loads it); anything else is testnet.
export const FLUENT_NETWORK: FluentWidgetNetwork =
  import.meta.env.VITE_FLUENT_WIDGET_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const CHAIN = getFluentChainForNetwork(FLUENT_NETWORK);
export const EXPLORER_BASE_URL =
  getFluentExplorerBaseUrl(FLUENT_NETWORK) ?? "https://testnet.fluentscan.xyz";

/**
 * The sponsorship service URL, called by both the widget's paymaster RPC and this app's
 * `/bench/decide`, so the bench cannot explain one service and send through another.
 */
export const SPONSORSHIP_URL: string =
  import.meta.env.VITE_SPONSORSHIP_URL ?? "http://localhost:8076";

/**
 * The App id the widget sends in `/paymaster/{app_id}`. The default is the dev "Auth demo" App,
 * shared with `apps/auth-demo`, whose `http://localhost:5173` origin is registered on the
 * service and on the Privy client. A local service mints its own App: set
 * `VITE_FLUENT_APP_ID` rather than editing this default.
 */
export const APP_ID: string =
  import.meta.env.VITE_FLUENT_APP_ID ?? "app_8908941315934a06b738c6804ce26132";

/** The Privy app client, read from the environment in `privyClientId.ts`, testable alone. */
export { PRIVY_CLIENT_ID } from "./privyClientId";

export const FLUENT_WIDGET_CONFIG = {
  appId: APP_ID,
  privyClientId: PRIVY_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Sponsorship Demo",
  source: "sponsorship_demo",
  campaign: "sponsorship-demo",
  sponsorshipUrl: SPONSORSHIP_URL,
} satisfies FluentWidgetConfig;

/** stBlend ERC-4626 vault, `apps/erc4626-vault/config.json`. A real testnet contract. */
export const VAULT_ADDRESS = "0xcd78874E6625557C3C50891969ac1040DE26E097" as Address;

/** Read from the SDK's token table rather than transcribed, so it cannot drift. */
export const BLEND_TOKEN = getFluentTokenDefaults(FLUENT_NETWORK).BLEND;
export const BLEND_ADDRESS = BLEND_TOKEN.address as Address;
export const USDNR_TOKEN = getFluentTokenDefaults(FLUENT_NETWORK).USDnr;

/**
 * The id of a way of paying, used everywhere in this app.
 *
 * Not the SDK's `FluentGasTokenSymbol`: `sponsored` and `self` are both native-gas sends and
 * differ only in whether the sponsorship paymaster is asked, so keying on the symbol would
 * collapse the two options the page exists to contrast.
 */
export type GasOptionId = "sponsored" | "self" | "BLEND" | "USDnr";

export type GasOption = {
  id: GasOptionId;
  /** What the SDK is told. `ETH` means native gas — no ERC-20 paymaster. */
  symbol: FluentGasTokenSymbol;
  /**
   * The name of this way of paying wherever it appears: "sponsored" rather than "ETH", because
   * the reader's question is who pays.
   */
  label: string;
  token: FluentTokenDefinition | undefined;
  /**
   * `FluentGasPayment.sponsorship`. Ignored by the SDK when `token` is set — an ERC-20 send
   * is paid by that token's own paymaster — so it is written here only where it decides
   * something.
   */
  sponsorship: "auto" | "never";
};

/**
 * The four ways to pay, in the order the page teaches them: the account paying for itself, as
 * any account does without Fluent, then the App's budget for the same send, then the visitor's
 * own tokens. Dry-run is not one of them: it asks about Sponsorship, so it applies only to the
 * sponsored way. `token` is undefined for both native ways, so no consumer tests the symbol.
 */
export const GAS_OPTIONS: readonly GasOption[] = [
  { id: "self", symbol: "ETH", label: "self", token: undefined, sponsorship: "never" },
  { id: "sponsored", symbol: "ETH", label: "sponsored", token: undefined, sponsorship: "auto" },
  { id: "BLEND", symbol: "BLEND", label: "BLEND", token: BLEND_TOKEN, sponsorship: "auto" },
  { id: "USDnr", symbol: "USDnr", label: "USDnr", token: USDNR_TOKEN, sponsorship: "auto" },
];

/** Returns the label of a way of paying: the one word the selector, Send button and log use. */
export function gasLabelFor(id: GasOptionId) {
  return GAS_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function gasOptionFor(id: GasOptionId): GasOption {
  const option = GAS_OPTIONS.find((candidate) => candidate.id === id);
  if (!option) throw new Error(`Unknown gas option ${id}`);
  return option;
}

/** The tokens whose balances decide whether a token option can be offered. */
export const GAS_TOKENS: readonly FluentTokenDefinition[] = GAS_OPTIONS
  .map((option) => option.token)
  .filter((token): token is FluentTokenDefinition => Boolean(token));

/**
 * Returns the allowance each token-paid send approves: 100 tokens in the token's own decimals,
 * enough for the operation it precedes and still a bounded allowance. Every token send carries
 * its own `approve`, because the call itself is what the demo shows.
 */
export function approveAmountFor(token: FluentTokenDefinition) {
  return parseUnits("100", token.decimals);
}

/** Which of a Network's two sponsorship paymasters an address is, in the service's own words. */
export type SponsorshipPaymasterKind = "own" | "zerodev";

export type SponsorshipPaymaster = {
  kind: SponsorshipPaymasterKind;
  /** How the badge's sentence names the paymaster that paid. */
  name: string;
  /** The word after `SPONSORED ·` on the badge. */
  badge: string;
  /** Lowercased, so a comparison never has to remember to be. */
  address: Address;
};

/**
 * Returns a sponsorship paymaster address from the environment, or the dev value when it is unset
 * or empty, lowercased either way. A blank `.env` line falls back rather than labelling every
 * sponsored send `UNKNOWN PAYMASTER`.
 */
function sponsorshipPaymasterAddress(fromEnv: string | undefined, dev: string): Address {
  return (fromEnv || dev).toLowerCase() as Address;
}

/**
 * The Network's two sponsorship paymasters, its `own_paymaster_address` and its
 * `zerodev_paymaster_address`; an App is sponsored through one of them, and the settle indexer
 * charges a hold only for an operation one of them paid. The public service exposes no read of
 * a Network, so the demo holds the dev Network's values, each overridable from the environment.
 *
 * No ERC-20 paymaster is named here: token-paid gas goes through a different ZeroDev project
 * (`getFluentZeroDevProjectId`), and `bench/erc20Paymaster.ts` resolves its address from the SDK
 * at runtime.
 */
export const SPONSORSHIP_PAYMASTERS: readonly SponsorshipPaymaster[] = [
  {
    kind: "own",
    name: "Fluent's own paymaster",
    badge: "FLUENT",
    address: sponsorshipPaymasterAddress(
      import.meta.env.VITE_OWN_PAYMASTER_ADDRESS,
      "0xc1f36bf0b66f8ac4ac8a7477378fe9c718c57c56",
    ),
  },
  {
    kind: "zerodev",
    name: "ZeroDev's paymaster",
    badge: "ZERODEV",
    address: sponsorshipPaymasterAddress(
      import.meta.env.VITE_ZERODEV_PAYMASTER_ADDRESS,
      "0x991e4158e338283d7efbc37eb49491a21434d964",
    ),
  },
];

/** Returns the sponsorship paymaster at an address, or undefined when it is neither of the two. */
export function sponsorshipPaymasterFor(address: Address): SponsorshipPaymaster | undefined {
  const paid = address.toLowerCase();
  return SPONSORSHIP_PAYMASTERS.find((paymaster) => paymaster.address === paid);
}

/** Returns the sponsorship paymaster of a kind; `SPONSORSHIP_PAYMASTERS` names every kind. */
export function sponsorshipPaymasterOf(kind: SponsorshipPaymasterKind): SponsorshipPaymaster {
  const paymaster = SPONSORSHIP_PAYMASTERS.find((candidate) => candidate.kind === kind);
  if (!paymaster) throw new Error(`Unknown sponsorship paymaster kind ${kind}`);
  return paymaster;
}

const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type BenchActionId = "deposit" | "transfer";

export type BenchAction = {
  id: BenchActionId;
  /** The rule's promise, not the verdict — it stays true while verdicts differ per person. */
  label: string;
  /** The call itself, so a builder can see these are genuine contracts and not a mock. */
  method: string;
  target: Address;
  targetLabel: string;
  /** Encoded here, where the concrete ABI is in scope, so viem checks the arguments. */
  data: (account: Address) => Hex;
};

/**
 * The two actions, one per rule the bench demonstrates: one open to everyone, one gated on the
 * verified segment. Amounts are zero: a zero ERC-20 transfer and a zero deposit succeed on an
 * empty balance, so the evaluator sees only the target and the selector and a policy question
 * never becomes a revert.
 *
 * The sponsored action comes first, so a visitor sees Sponsorship work before they see it refuse.
 * The labels promise what the App's rules grant, and those rules live in the App's configuration
 * on the service: a configuration that swaps the two segments makes both labels wrong.
 */
export const BENCH_ACTIONS: readonly BenchAction[] = [
  {
    id: "transfer",
    label: "Sponsored for anyone",
    method: "transfer(you, 0)",
    target: BLEND_ADDRESS,
    targetLabel: "BLEND token",
    data: (account) =>
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 0n] }),
  },
  {
    id: "deposit",
    label: "Sponsored for verified humans only",
    method: "deposit(0, you)",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [0n, account] }),
  },
];

/**
 * The cost a dry run sends the evaluator to compare against a budget. The bench builds no user
 * operation for a dry run, so these stand in for one ordinary operation (a 0.01 ETH ceiling at
 * 1 gwei), the same for every action.
 */
export const DRY_RUN_MAX_COST_WEI = "10000000000000000";
export const DRY_RUN_MAX_FEE_PER_GAS_WEI = "1000000000";
