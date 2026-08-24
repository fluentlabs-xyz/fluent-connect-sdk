import {
  getFluentChainForNetwork,
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
  resolveFluentWidgetNetworkFromEnv,
  type FluentGasPaymentSymbol,
  type FluentTokenDefinition,
  type FluentWidgetConfig,
} from "@fluent.xyz/connect";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

export const FLUENT_NETWORK = resolveFluentWidgetNetworkFromEnv() ?? "testnet";
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

/** The Privy app client the widget sends in `/paymaster/{client_id}`. Not a slug. */
export const PARTNER_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiAJgZ9D8Dwur";

export const FLUENT_WIDGET_CONFIG = {
  clientId: PARTNER_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Sponsorship Bench",
  authMode: "direct",
  source: "sponsorship_bench",
  campaign: "sponsorship-bench",
  sponsorshipUrl: SPONSORSHIP_URL,
} satisfies FluentWidgetConfig;

/** stBlend ERC-4626 vault, `apps/erc4626-vault/config.json`. A real testnet contract. */
export const VAULT_ADDRESS = "0xcd78874E6625557C3C50891969ac1040DE26E097" as Address;

/** Read from the SDK's token table rather than transcribed, so it cannot drift. */
export const BLEND_TOKEN = getFluentTokenDefaults(FLUENT_NETWORK).BLEND;
export const BLEND_ADDRESS = BLEND_TOKEN.address as Address;

/**
 * The only two paymasters this bench can name. Both are the dev values from
 * `charts/values-sponsorship.yaml` — `ZERODEV_SPONSORSHIP_PAYMASTER_ADDRESS` and
 * `ZERODEV_ERC20_PAYMASTER_ADDRESS` — and they are the service's own definition of who
 * gets charged: only an operation paid by the first is charged to a partner.
 *
 * Lowercased here so a comparison never has to remember to be. Anything else non-zero is
 * a paymaster we cannot account for, and the page says exactly that rather than guessing.
 */
export const SPONSORSHIP_PAYMASTER = "0x991e4158e338283d7efbc37eb49491a21434d964" as Address;
export const ERC20_PAYMASTER = "0x6cadc99bbb0e98cb9b5c379242c1f131c2ecbd72" as Address;

/**
 * What a mode *asks for*. Never what happened — that is read off the settled operation's
 * paymaster, and the two disagreeing is the single most useful thing this page can show.
 */
export type GasMode = {
  symbol: FluentGasPaymentSymbol;
  note: string;
};

/**
 * ETH is not "the user pays" and there is deliberately no position that is. Native gas
 * enters the sponsorship path; whether a rule covers the action decides whether the
 * partner's budget or the account's own ETH ends up paying, and watching that fall
 * through on an uncovered action is the lesson a toggle would have hidden.
 */
export const GAS_MODES: readonly GasMode[] = [
  {
    symbol: "ETH",
    note: "Native gas, through the sponsorship path. The partner's budget pays when a rule covers the action, your own ETH when none does — send “Transfer shares” to watch that.",
  },
  {
    symbol: "BLEND",
    note: "You pay, in BLEND, through the ERC-20 paymaster. The sponsorship rules are never consulted.",
  },
  {
    symbol: "USDnr",
    note: "You pay, in USDnr, through the ERC-20 paymaster. The sponsorship rules are never consulted.",
  },
];

/**
 * The gas tokens by symbol, read from the SDK's table rather than transcribed. Used only
 * when a token-mode send fails: an empty balance is the ordinary cause and deserves that
 * sentence rather than the bundler's.
 */
export const GAS_TOKENS: Readonly<Record<"BLEND" | "USDnr", FluentTokenDefinition>> = {
  BLEND: BLEND_TOKEN,
  USDnr: getFluentTokenDefaults(FLUENT_NETWORK).USDnr,
};

const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export type BenchActionId = "approve" | "deposit" | "withdraw" | "transfer-shares";

export type BenchAction = {
  id: BenchActionId;
  label: string;
  /** What the call does, in the words the operations feed would use. */
  summary: string;
  target: Address;
  targetLabel: string;
  /** Encoded here, where the concrete ABI is in scope, so viem checks the arguments. */
  data: (account: Address) => Hex;
  /** True for the action the seeded rules deliberately do not cover. */
  uncovered?: boolean;
};

/**
 * Amounts are zero everywhere except the approve, which needs no balance either. A policy
 * question must not turn into a revert because the signed-in account happens to hold no
 * BLEND: the selector and the target are the whole of what the evaluator sees, and a
 * zero-amount call carries exactly the same ones.
 */
export const BENCH_ACTIONS: readonly BenchAction[] = [
  {
    id: "approve",
    label: "Approve",
    summary: "approve(vault, 0) on BLEND",
    target: BLEND_ADDRESS,
    targetLabel: "BLEND token",
    data: () =>
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [VAULT_ADDRESS, 0n] }),
  },
  {
    id: "deposit",
    label: "Deposit",
    summary: "deposit(0, you) on the stBlend vault",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [0n, account] }),
  },
  {
    id: "withdraw",
    label: "Withdraw",
    summary: "withdraw(0, you, you) on the stBlend vault",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "withdraw",
        args: [0n, account, account],
      }),
  },
  {
    id: "transfer-shares",
    label: "Transfer shares",
    summary: "transfer(you, 0) on the stBlend vault — deliberately uncovered",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "transfer", args: [account, 0n] }),
    uncovered: true,
  },
];

export type BenchPerson = {
  privyId: string;
  name: string;
  /** Families as the seed writes them — what the segments are computed from. */
  families: string;
};

/** The four seeded people, so dry-run works logged out. */
export const SEEDED_PEOPLE: readonly BenchPerson[] = [
  {
    privyId: "did:privy:seed-user-verified",
    name: "Verified Vera",
    families: "identity B · influential C · predictor D",
  },
  {
    privyId: "did:privy:seed-user-tester",
    name: "Testing Tom",
    families: "identity D · tester A · predictor D",
  },
  {
    privyId: "did:privy:seed-user-builder",
    name: "Building Bea",
    families: "identity C · builder C · predictor D",
  },
  {
    privyId: "did:privy:seed-user-fresh",
    name: "Fresh Fred",
    families: "identity D · predictor D",
  },
];

/**
 * A cost the evaluator can compare against a budget. The bench never builds a real
 * UserOp for the dry run, so there is nothing to estimate from — these stand in for one
 * ordinary operation (0.01 ETH ceiling at 1 gwei) and are the same for every action.
 */
export const DRY_RUN_MAX_COST_WEI = "10000000000000000";
export const DRY_RUN_MAX_FEE_PER_GAS_WEI = "1000000000";
