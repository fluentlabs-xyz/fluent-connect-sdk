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
 * The sponsorship paymaster, and the only paymaster address this file may name.
 *
 * It is `ZERODEV_SPONSORSHIP_PAYMASTER_ADDRESS` from `charts/values-sponsorship.yaml`, and
 * it is the service's own definition of who gets charged: the settle indexer charges a
 * hold only for an operation paid by this address. Lowercased so a comparison never has to
 * remember to be.
 *
 * There is deliberately no ERC-20 paymaster constant beside it. Token-paid gas goes to a
 * different ZeroDev project (`FLUENT_CONNECT_ZERODEV_PROJECT_ID`), so the ERC-20 address in
 * this repo's chart belongs to the wrong project and would mislabel a working send as a
 * misconfiguration. That one is resolved from the SDK at runtime — see
 * `bench/erc20Paymaster.ts`.
 */
export const SPONSORSHIP_PAYMASTER = "0x991e4158e338283d7efbc37eb49491a21434d964" as Address;

/**
 * Approve generously, once. A standing allowance is how a real integration behaves: the
 * first token-paid send carries the approval, every later one carries none. 100 tokens is
 * a number a person can read — `maxUint256` is not, and a silent infinite allowance is
 * exactly the thing this bench exists to make visible.
 *
 * The floor is what "short" means: below one token the next send tops the allowance back
 * up, which is still many operations' worth of gas ahead of the reader.
 */
export const GAS_TOKEN_APPROVE_TOKENS = 100n;
export const GAS_TOKEN_APPROVE_FLOOR_TOKENS = 1n;

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
    note: "Native gas, through the sponsorship path. The partner's budget pays when a rule covers the action, your own ETH when none does — send “Covered by no rule” to watch that.",
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
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export type BenchActionId = "deposit" | "approve" | "transfer-shares";

export type BenchAction = {
  id: BenchActionId;
  /**
   * What this action demonstrates — the rule's promise, not the verdict. It stays true
   * while the verdict beside it moves from person to person, and the two together are the
   * lesson: "sponsored for verified humans" reading `refused` for Fresh Fred is the gate
   * working, not the page disagreeing with itself.
   */
  label: string;
  /** The call itself, so a builder can see these are genuine contracts and not a mock. */
  method: string;
  target: Address;
  targetLabel: string;
  /** Encoded here, where the concrete ABI is in scope, so viem checks the arguments. */
  data: (account: Address) => Hex;
};

/**
 * Three actions, because there are three distinguishable verdicts. Deposit and withdraw
 * were admitted by one rule, for everyone, and produced the same answer twice — the second
 * taught nothing and was deleted.
 *
 * Amounts are zero everywhere. A policy question must not turn into a revert because the
 * signed-in account happens to hold no BLEND: the target and the selector are the whole of
 * what the evaluator sees, and a zero-amount call carries exactly the same ones.
 */
export const BENCH_ACTIONS: readonly BenchAction[] = [
  {
    id: "deposit",
    label: "Sponsored for anyone",
    method: "deposit(0, you)",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [0n, account] }),
  },
  {
    id: "approve",
    label: "Sponsored for verified humans, twice each",
    method: "approve(vault, 0)",
    target: BLEND_ADDRESS,
    targetLabel: "BLEND token",
    data: () =>
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [VAULT_ADDRESS, 0n] }),
  },
  {
    id: "transfer-shares",
    label: "Covered by no rule",
    method: "transfer(you, 0)",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "transfer", args: [account, 0n] }),
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
