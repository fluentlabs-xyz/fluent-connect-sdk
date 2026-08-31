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
 * Two actions, because there are two rules worth demonstrating: one open to everyone with
 * a per-user send limit, one gated on the verified segment. Amounts are zero everywhere — a zero
 * ERC-20 transfer and a zero deposit both succeed with an empty balance, so a policy
 * question never turns into a revert: the target and the selector are the whole of what
 * the evaluator sees.
 */
export const BENCH_ACTIONS: readonly BenchAction[] = [
  {
    id: "deposit",
    label: "Sponsored for anyone — limited sends per user",
    method: "deposit(0, you)",
    target: VAULT_ADDRESS,
    targetLabel: "stBlend vault",
    data: (account) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [0n, account] }),
  },
  {
    id: "transfer",
    label: "Sponsored for verified humans only",
    method: "transfer(you, 0)",
    target: BLEND_ADDRESS,
    targetLabel: "BLEND token",
    data: (account) =>
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 0n] }),
  },
];

/**
 * A cost the evaluator can compare against a budget. The bench never builds a real
 * UserOp for the dry run, so there is nothing to estimate from — these stand in for one
 * ordinary operation (0.01 ETH ceiling at 1 gwei) and are the same for every action.
 */
export const DRY_RUN_MAX_COST_WEI = "10000000000000000";
export const DRY_RUN_MAX_FEE_PER_GAS_WEI = "1000000000";
