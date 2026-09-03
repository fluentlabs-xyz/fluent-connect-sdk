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

/**
 * The partner id the widget sends in `/paymaster/{partner_id}`. Default is the dev
 * "Auth demo" partner, shared with `apps/auth-demo`: one demo partner serves both — auth
 * and sponsorship are independent switches on the same partner row, and
 * `http://localhost:5173` is already registered for it on the service and on the Privy
 * client. A local service mints a different partner — override via VITE_FLUENT_PARTNER_ID
 * (see `docs/sponsorship-bench-local.md`), never by editing this default.
 */
export const PARTNER_ID: string =
  import.meta.env.VITE_FLUENT_PARTNER_ID ?? "partner_8908941315934a06b738c6804ce26132";

/** The Privy app client of the same partner — login only, no longer the partner's identity. */
export const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

export const FLUENT_WIDGET_CONFIG = {
  partnerId: PARTNER_ID,
  privyClientId: PRIVY_CLIENT_ID,
  network: FLUENT_NETWORK,
  appName: "Fluent Sponsorship Demo",
  authMode: "direct",
  source: "sponsorship_demo",
  campaign: "sponsorship-demo",
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
 * The labels state what each rule promises, and the rules live in the partner's configuration
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
