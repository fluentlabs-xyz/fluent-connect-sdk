import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";

import type { FluentPermissionApi } from "./permissionSession";
import type { FluentSignApi } from "./signRequest";
import type { FluentGasTokenSymbol } from "../core/gasPayment";
import { validateUserOperationGas, type FluentUserOperationGas } from "../core/userOperationGas";

export type { FluentUserOperationGas } from "../core/userOperationGas";

export type FluentBatchCallInput = {
  id?: string;
  label?: string;
  to: Address;
  value?: bigint;
  data?: Hex;
  abi?: Abi;
  method?: string;
  functionName?: string;
  args?: readonly unknown[];
};

export type FluentEncodedBatchCall = {
  id?: string;
  label?: string;
  to: Address;
  value: bigint;
  data: Hex;
};

export type FluentWidgetExecutionStatus = "disconnected" | "ready" | "unavailable" | "error";

/** How the connected account executes transactions. */
export type FluentAccountType = "smart" | "eoa";

export type FluentAccountCapabilities = {
  /** Multiple calls land in a single atomic transaction (smart account only). */
  atomicBatch: boolean;
  /**
   * Gas can be paid in an ERC-20 (BLEND / USDnr) via the paymaster instead of
   * native ETH — smart account only. This is NOT free/sponsored gas: the user
   * still pays, just in a token. Without an ERC-20 selection the smart account
   * pays gas in native ETH from its own balance.
   */
  erc20Gas: boolean;
};

export type FluentWidgetAccount = {
  address?: Address;
  signerAddress?: Address;
  connected: boolean;
  executionReady: boolean;
  executionStatus: FluentWidgetExecutionStatus;
  executionError?: string;
  /** Active account kind, or undefined when nothing is connected. */
  type?: FluentAccountType;
  /** What the active account can do — lets hosts adapt UI without branching on `type`. */
  capabilities: FluentAccountCapabilities;
};

/**
 * Absolute instants behind `FluentExecuteTiming`, kept so its signed estimates can be
 * re-checked rather than believed. Epoch milliseconds (`Date.now()`), because the only other
 * clock in the arithmetic — the including block's `timestamp` — is a wall clock too.
 */
export type FluentExecuteTimingInstants = {
  /** When the first submission attempt of this send began. */
  submittedAtEpochMs: number;
  /** When the bundler accepted the operation that settled. */
  broadcastedAtEpochMs: number;
  /** When that operation's receipt was in hand. */
  receivedAtEpochMs: number;
  /**
   * The including block's `timestamp`, in milliseconds. Absent exactly when `inclusionMs` and
   * `detectMs` are absent: the block could not be read.
   */
  blockTimestampEpochMs?: number;
  /** How many operations were submitted; more than one means a retry or an own-gas fallback. */
  attempts: number;
};

/**
 * Where one send's milliseconds went, stage by stage.
 *
 * Two clocks, and the difference decides how these numbers may be read. `prepareMs`,
 * `signMs`, `broadcastMs`, `retryMs` and `totalMs` are direct monotonic measurements on the
 * client (`performance.now()`). `inclusionMs` and `detectMs` are *signed estimates* across the
 * client's clock and the chain's: `block.timestamp` has one-second resolution and no relation
 * to the browser's clock, so either may legitimately be negative when it is small, and neither
 * is clamped — a clamp would turn a known skew into a silent zero. `instants` keeps the inputs,
 * so the subtraction can be redone by whoever doubts it.
 *
 * `totalMs` is measured, not summed: it runs from the start of the first submission to the
 * instant the receipt was in hand, and excludes both the kernel and authentication setup before
 * the send and the block read after it. It does not equal the sum of the stages and must not be
 * displayed as if it did.
 *
 * Collected for every send, whatever `debugLogging` is set to — the numbers are the answer to
 * "where did the four seconds go", which is a question a host asks in production. A failure
 * inside the measuring code costs the stages it could not establish, never the send.
 */
export type FluentExecuteTiming = {
  /**
   * Building the UserOperation — nonce, gas estimate, paymaster — up to the signature request.
   * Absent when the clock could not be read at that boundary: every stage here is absent rather
   * than approximated, because a stage silently widened to cover its neighbours is worse than a
   * stage the display can mark as unmeasured.
   */
  prepareMs?: number;
  /** Producing the signature. Absent when the settled attempt never got that far. */
  signMs?: number;
  /** Handing the signed operation to the bundler. Absent when signing never finished. */
  broadcastMs?: number;
  /**
   * Bundler acceptance to the including block's timestamp: bundling plus block time. Signed
   * estimate; absent when the including block could not be read.
   */
  inclusionMs?: number;
  /**
   * The including block's timestamp to the instant this client held the receipt: how long the
   * inclusion took to notice. Signed estimate; absent when the including block could not be read.
   */
  detectMs?: number;
  /**
   * Time spent on submissions that did not settle — a rejected sponsorship bearer, a refused
   * sponsorship falling back to own gas — and on the token exchange between them. It belongs to
   * no stage, is counted inside `totalMs`, and is `0` for a send that submitted once.
   */
  retryMs: number;
  /** First submission to receipt in hand. Measured directly; never a sum of the stages. */
  totalMs: number;
  /** The raw instants the signed estimates above were computed from. */
  instants: FluentExecuteTimingInstants;
};

/** Result of executing a batch operation. */
export type FluentExecuteResult = {
  /** Primary transaction hash — the final/target call (e.g. deposit/withdraw). */
  hash: Hash;
  /** All transaction hashes in order. One for a smart-account UserOp; one per call for an EOA. */
  hashes: Hash[];
  /** Included receipt for hash (the final EOA call); not a finality guarantee. */
  receipt?: TransactionReceipt;
  /** ERC-4337 operation hash when executing through a smart account. */
  userOpHash?: Hash;
  /** True when all calls landed atomically (smart account), false for sequential EOA txs. */
  atomic: boolean;
  /**
   * True when an App's sponsorship paid the gas for this operation. Read back off the
   * settled UserOperation (which contract the EntryPoint charged), not from which client
   * we chose to send with: a refusal in the sponsorship proxy is a flat 403 and the
   * account silently pays its own gas, so an optimistic flag would report the failure
   * mode as a success. Always false for the EOA path, which has no paymaster.
   */
  sponsored: boolean;
  /**
   * The paymaster that actually paid, zero address when the account paid itself.
   * Undefined when the bundler's receipt carried no paymaster field and no
   * `UserOperationEvent` could be decoded — i.e. `sponsored` is a guess, say so.
   */
  paymaster?: Address;
  /**
   * Where this send's milliseconds went. Smart-account path only: an external wallet performs
   * its prompt, its signing and its broadcast behind one `sendTransaction` await, so EIP-1193
   * exposes no truthful instant to put a boundary on.
   */
  timing?: FluentExecuteTiming;
};

export type FluentWidgetGasPayment = {
  symbol: FluentGasTokenSymbol;
  token?: Address;
  decimals: number;
};

export type FluentBatchOperationInput = {
  id?: string;
  /** Heading shown in the Fluent transaction-review modal (smart account, confirmation "always"). Defaults to "Confirm transaction". */
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
};

export type FluentBatchOperationExecutor = {
  smartAccountReady?: boolean;
  account?: FluentWidgetAccount;
  ensureReady?: (options: FluentBatchOperationExecuteOptions) => Promise<unknown>;
  defaultConfirmation?: FluentBatchConfirmationMode;
  /**
   * Gas token selected in the widget UI. Used as the default when `execute` is
   * called without an explicit `gasPayment`, so the in-widget selector actually
   * drives which token pays for gas. Native-gas selections (no `token`) fall
   * back to native gas (no ERC20 paymaster).
   */
  defaultGasPayment?: FluentWidgetGasPayment;
  /** Native-gas policy inherited from widget config; each execution may override it. */
  defaultSponsorship?: "auto" | "never";
  /**
   * Call targets Quick sign may skip the review for, compared case-insensitively.
   * Set, it caps every `"session"` confirmation — the widget default and an explicit
   * per-execute option alike, because it is the host's guardrail and a per-call option
   * must not be able to lift it: an operation with any call outside the list reviews
   * and signs as `"always"`. Undefined leaves Quick sign covering every address.
   */
  quickSignWhitelist?: readonly Address[];
  confirm?: (operation: FluentBatchOperationReview) => Promise<void>;
  /**
   * `readyAccount` is whatever `ensureReady` resolved with for this execution, and is
   * `undefined` when the executor was already ready and `ensureReady` never ran.
   *
   * It is passed because an executor assembled inside a React render — which is every
   * executor the widget builds — closes over the readiness state of that render, and
   * `ensureReady` resolving does not re-render it: in the tick after the account becomes
   * ready, `sendCalls` still sees "not ready" and has no way to reach the account that
   * now exists. This argument is that way. An executor whose readiness is not captured in
   * a closure can ignore it.
   */
  sendCalls: (
    calls: FluentEncodedBatchCall[],
    options: FluentBatchOperationExecuteOptions,
    readyAccount?: unknown,
  ) => Promise<FluentExecuteResult>;
};

export type FluentBatchConfirmationMode = "always" | "session";

export type FluentGasPayment = {
  /**
   * Gas token symbol. The widget resolves the ERC-20 address for the active
   * network internally — callers never pass (or risk mistyping) an address.
   * `"ETH"` means native gas (no ERC-20 paymaster).
   */
  symbol: FluentGasTokenSymbol;
  /**
   * Whether to ask the App's sponsorship paymaster to pay for this operation.
   *
   * Defaults to `"auto"`, which is what every caller got before this option existed: try
   * sponsorship, and if the paymaster refuses, resend with the account paying its own gas.
   * `"never"` skips the paymaster outright, so the account pays from the first attempt and
   * the result reports `sponsorshipReason: "not_requested"`.
   *
   * The distinction is not cosmetic: under `"auto"` the two outcomes are indistinguishable
   * before the send and only the settled receipt separates them, so a caller that wants to
   * *demonstrate* unsponsored execution — or to keep an App's budget untouched — has no
   * way to say so. Ignored when `symbol` names an ERC-20: that token's own paymaster pays,
   * and sponsorship is not in the picture.
   */
  sponsorship?: "auto" | "never";
} & (
  | {
      includeApproval: true;
      approveAmount: bigint;
    }
  | {
      includeApproval?: false;
      approveAmount?: never;
    }
);

export type FluentBatchOperationExecuteOptions = {
  confirmation?: FluentBatchConfirmationMode;
  gasPayment?: FluentGasPayment;
  /** Smart-account execution gas override or headroom. Ignored for external EOA transactions. */
  userOperationGas?: FluentUserOperationGas;
};

export type FluentBatchOperationReview = {
  id?: string;
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  account?: FluentWidgetAccount;
};

export type FluentBatchOperation = {
  id?: string;
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  canExecute: boolean;
  execute: (
    optionsOrExecutor?: FluentBatchOperationExecuteOptions | FluentBatchOperationExecutor,
    executor?: FluentBatchOperationExecutor,
  ) => Promise<FluentExecuteResult>;
};

export type FluentBatchApi = FluentPermissionApi & FluentSignApi & {
  account: FluentWidgetAccount;
  confirmationMode: FluentBatchConfirmationMode;
  gasPayment: FluentWidgetGasPayment;
  createBatchOp: (input: FluentBatchOperationInput) => FluentBatchOperation;
};

export function createFluentBatchOp(
  input: FluentBatchOperationInput,
  executor?: FluentBatchOperationExecutor | null,
): FluentBatchOperation {
  if (input.calls.length === 0) {
    throw new Error("A Fluent batch operation requires at least one call");
  }

  const encodedCalls = input.calls.map(encodeBatchCall);

  return {
    id: input.id,
    reviewTitle: input.reviewTitle,
    calls: input.calls,
    encodedCalls,
    canExecute: Boolean(
      executor &&
        (executor.account?.executionReady || executor.smartAccountReady || executor.ensureReady),
    ),
    async execute(optionsOrExecutor, overrideExecutor) {
      const inlineExecutor =
        optionsOrExecutor && "sendCalls" in optionsOrExecutor ? optionsOrExecutor : undefined;
      const options =
        optionsOrExecutor && "sendCalls" in optionsOrExecutor ? undefined : optionsOrExecutor;
      const activeExecutor = overrideExecutor ?? inlineExecutor ?? executor;
      validateUserOperationGas(options?.userOperationGas);
      if (!activeExecutor) {
        throw new Error("A Fluent batch operation requires a Fluent execution executor");
      }
      // Default the gas token to the one selected in the widget UI when the
      // caller doesn't pass an explicit `gasPayment`. Preserve the native-gas
      // sponsorship policy too, otherwise an opt-out silently becomes auto.
      const fallbackGasPayment: FluentGasPayment | undefined =
        activeExecutor.defaultGasPayment &&
        (activeExecutor.defaultGasPayment.token || activeExecutor.defaultSponsorship !== undefined)
          ? { symbol: activeExecutor.defaultGasPayment.symbol }
          : undefined;
      const gasPayment = options?.gasPayment ?? fallbackGasPayment;
      const executionOptions: FluentBatchOperationExecuteOptions = {
        ...options,
        confirmation: options?.confirmation ?? activeExecutor.defaultConfirmation ?? "always",
        gasPayment: gasPayment
          ? { ...gasPayment, sponsorship: gasPayment.sponsorship ?? activeExecutor.defaultSponsorship }
          : undefined,
      };
      // Decided before the review and the signer alike: escalating here is what makes a
      // non-whitelisted target show the review *and* sign through the prompting kernel.
      if (
        executionOptions.confirmation === "session" &&
        activeExecutor.quickSignWhitelist &&
        !isQuickSignWhitelisted(encodedCalls, activeExecutor.quickSignWhitelist)
      ) {
        executionOptions.confirmation = "always";
      }
      // The Fluent review modal explains the embedded-signer UserOp. An external
      // EOA shows its own wallet prompt, so skip our modal for that account type.
      if (executionOptions.confirmation === "always" && activeExecutor.account?.type !== "eoa") {
        await activeExecutor.confirm?.({
          id: input.id,
          reviewTitle: input.reviewTitle,
          calls: input.calls,
          encodedCalls,
          account: activeExecutor.account,
        });
      }
      const executionReady = activeExecutor.account?.executionReady ?? activeExecutor.smartAccountReady === true;
      let readyAccount: unknown;
      if (!executionReady) {
        if (!activeExecutor.ensureReady) {
          throw new Error(
            activeExecutor.account?.executionError ??
              "Fluent smart account execution is not available for this widget session",
          );
        }
        // Keep what readiness produced: the send below runs in the same tick, before anything
        // that captured "not ready" can be rebuilt, so this is the only account it can reach.
        readyAccount = await activeExecutor.ensureReady(executionOptions);
      }
      return activeExecutor.sendCalls(encodedCalls, executionOptions, readyAccount);
    },
  };
}

function isQuickSignWhitelisted(
  calls: readonly FluentEncodedBatchCall[],
  whitelist: readonly Address[],
): boolean {
  const allowed = new Set(whitelist.map((address) => address.toLowerCase()));
  return calls.every((call) => allowed.has(call.to.toLowerCase()));
}

function encodeBatchCall(call: FluentBatchCallInput): FluentEncodedBatchCall {
  if (call.data) {
    return {
      id: call.id,
      label: call.label,
      to: call.to,
      value: call.value ?? 0n,
      data: call.data,
    };
  }

  const functionName = call.functionName ?? call.method;
  if (!call.abi || !functionName) {
    throw new Error("Batch call requires either raw data or abi + method");
  }

  return {
    id: call.id,
    label: call.label,
    to: call.to,
    value: call.value ?? 0n,
    data: encodeFunctionData({
      abi: call.abi,
      functionName,
      args: call.args ?? [],
    } as Parameters<typeof encodeFunctionData>[0]),
  };
}
