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
 * Both the widget's paymaster RPC and this app's `/bench/decide` calls. One URL, two
 * consumers, so a bench pointed at the wrong service cannot explain one thing and do
 * another.
 */
export const SPONSORSHIP_URL: string =
  import.meta.env.VITE_SPONSORSHIP_URL ?? "http://localhost:8076";

/**
 * The App id the widget sends in `/paymaster/{app_id}`. Default is the dev
 * "Auth demo" App, shared with `apps/auth-demo`: one demo App serves both — auth
 * and sponsorship are independent switches on the same App row, and
 * `http://localhost:5173` is already registered for it on the service and on the Privy
 * client. A local service mints a different App — override via VITE_FLUENT_APP_ID
 * (see `docs/sponsorship-bench-local.md`), never by editing this default.
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
 * How a way of paying is identified everywhere in this app.
 *
 * Not the SDK's `FluentGasTokenSymbol`, because two of these ways share one symbol:
 * `sponsored` and `self` are both native-gas sends, and what separates them is whether the
 * sponsorship paymaster is asked at all. Keying the page on the symbol would collapse the
 * two options the page exists to contrast.
 */
export type GasOptionId = "sponsored" | "self" | "BLEND" | "USDnr";

export type GasOption = {
  id: GasOptionId;
  /** What the SDK is told. `ETH` means native gas — no ERC-20 paymaster. */
  symbol: FluentGasTokenSymbol;
  /**
   * How this way of paying is named everywhere it appears. "sponsored" rather than "ETH",
   * because the reader's question is who pays, and the native token is an implementation
   * detail of the answer.
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

/*
 * The four ways to pay, in the order the page teaches them: the account paying for itself
 * first, because that is what any account does without Fluent, then the App's budget
 * beside it — the same send, the one difference being who was asked — then the visitor's own
 * tokens. Dry-run stands beside them on every row but is not one of them: it is a question
 * about sponsorship, and it only applies to the sponsored way of paying.
 *
 * `token` is undefined for both native ways and is the token definition otherwise, so no
 * consumer has to test the symbol. The ERC-20 paymaster's own address appears nowhere here:
 * it is resolved from the SDK at runtime, as the comment on `SPONSORSHIP_PAYMASTERS` below
 * requires.
 */
export const GAS_OPTIONS: readonly GasOption[] = [
  { id: "self", symbol: "ETH", label: "self", token: undefined, sponsorship: "never" },
  { id: "sponsored", symbol: "ETH", label: "sponsored", token: undefined, sponsorship: "auto" },
  { id: "BLEND", symbol: "BLEND", label: "BLEND", token: BLEND_TOKEN, sponsorship: "auto" },
  { id: "USDnr", symbol: "USDnr", label: "USDnr", token: USDNR_TOKEN, sponsorship: "auto" },
];

/** The same word in the selector, on the Send button and in the log — one label, three uses. */
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
 * The allowance each token-paid send asks for.
 *
 * Every token send carries its own `approve`, because the demo's subject is the call itself
 * — showing it once and then hiding it on later sends would teach the wrong shape. The cap
 * is a demo cap: large enough to cover the operation it precedes, small enough to read as a
 * bounded allowance rather than an unlimited one. Per token, because a cap is a number of
 * tokens and the decimals are the token's own.
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
 * A sponsorship paymaster address, from the environment where one is set and from the dev
 * values otherwise, lowercased either way. The empty string counts as unset: a `.env` line
 * left blank should fall back, not turn every sponsored send into `UNKNOWN PAYMASTER`.
 */
function sponsorshipPaymasterAddress(fromEnv: string | undefined, dev: string): Address {
  return (fromEnv || dev).toLowerCase() as Address;
}

/**
 * The Network's two sponsorship paymasters. No other paymaster address is named in this file.
 *
 * Since FLU-1603 a Network names two: its `own_paymaster_address` and its
 * `zerodev_paymaster_address`, and an App is sponsored through one of the two. The public
 * service exposes no read of a Network, so this demo holds the pair itself: the dev Network's
 * values by default, each overridable the way `VITE_SPONSORSHIP_URL` overrides the service URL,
 * so a bench pointed at another service can name that service's paymasters. The settle indexer
 * charges a hold only for an operation paid by one of these addresses.
 *
 * There is deliberately no ERC-20 paymaster constant beside them. Token-paid gas goes to a
 * different ZeroDev project (`getFluentZeroDevProjectId`), so the ERC-20 address in
 * this repo's chart belongs to the wrong project and would mislabel a working send as a
 * misconfiguration. That one is resolved from the SDK at runtime — see
 * `bench/erc20Paymaster.ts`.
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

/** The sponsorship paymaster an address is, or undefined when it is neither of the two. */
export function sponsorshipPaymasterFor(address: Address): SponsorshipPaymaster | undefined {
  const paid = address.toLowerCase();
  return SPONSORSHIP_PAYMASTERS.find((paymaster) => paymaster.address === paid);
}

/** The paymaster of a kind; the list above names every kind, so this never fails to find one. */
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
 * Two actions, because there are two rules worth demonstrating: one open to everyone, one gated on
 * the verified segment. Amounts are zero everywhere — a zero ERC-20 transfer and a zero deposit
 * both succeed with an empty balance, so a policy question never turns into a revert: the target
 * and the selector are the whole of what the evaluator sees.
 *
 * Order is the demonstration, not a list: the one that is sponsored comes first, so a visitor sees
 * the thing working before they see it refuse. Reading the refusal first teaches "this is broken"
 * a beat before the page can say otherwise, and that beat is the whole first impression.
 *
 * The labels state what each rule promises, and the rules live in the App's configuration
 * rather than in this file — so a configuration that swaps the two segments makes both labels
 * lie. If that drift happens again, the fix is to stop promising here and let the verdict line
 * speak, not to keep the two in sync by hand.
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
 * A cost the evaluator can compare against a budget. The bench never builds a real
 * UserOp for the dry run, so there is nothing to estimate from — these stand in for one
 * ordinary operation (0.01 ETH ceiling at 1 gwei) and are the same for every action.
 */
export const DRY_RUN_MAX_COST_WEI = "10000000000000000";
export const DRY_RUN_MAX_FEE_PER_GAS_WEI = "1000000000";
