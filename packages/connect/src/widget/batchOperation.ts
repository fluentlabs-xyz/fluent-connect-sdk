import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";

import type { FluentSignApi } from "./signRequest";
import type { FluentGasTokenSymbol } from "../core/gasPayment";
import { validateUserOperationGas, type FluentUserOperationGas } from "../core/userOperationGas";

export type { FluentUserOperationGas } from "../core/userOperationGas";

/**
 * One contract call of a Batch operation: either raw `data`, or an `abi` with the `method` to
 * encode and its `args`.
 */
export type FluentBatchCallInput = {
  id?: string;
  label?: string;
  to: Address;
  /** Native ETH sent with the call, in wei. Defaults to `0n`. */
  value?: bigint;
  data?: Hex;
  abi?: Abi;
  /** The ABI function to encode, with `abi` and `args`, when `data` is not given. */
  method?: string;
  args?: readonly unknown[];
};

/** A Batch operation's call as it is sent: `data` encoded, `value` defaulted to `0n`. */
export type FluentEncodedBatchCall = {
  id?: string;
  label?: string;
  to: Address;
  value: bigint;
  data: Hex;
};

/**
 * Whether the Widget account can send now: `ready`, `disconnected`, `unavailable` (connected
 * but not ready yet) or `error` (see `FluentWidgetAccount.executionError`).
 */
export type FluentWidgetExecutionStatus = "disconnected" | "ready" | "unavailable" | "error";

/** How the connected account executes transactions. */
export type FluentAccountType = "smart" | "eoa";

/** What the Widget account can do, so a host adapts its UI without branching on its type. */
export type FluentAccountCapabilities = {
  /** Multiple calls land in a single atomic transaction (smart account only). */
  atomicBatch: boolean;
  /**
   * Gas can be paid in an ERC-20 (BLEND / USDnr) via the paymaster instead of
   * native ETH — smart account only. This is NOT free/sponsored gas: the user
   * still pays, just in a token.
   */
  erc20Gas: boolean;
};

/**
 * The Widget account as the Widget API reports it: its address and type, whether it is
 * connected and can send now, and what it can do.
 */
export type FluentWidgetAccount = {
  /** The Widget account's address: the Fluent ID's, or the External wallet's. */
  address?: Address;
  /** Whether a Widget account, a Fluent ID or an External wallet, is connected. */
  connected: boolean;
  /** Whether the Widget account can send now; `executionStatus` says why it cannot. */
  executionReady: boolean;
  /** Where sending stands, a `FluentWidgetExecutionStatus`. */
  executionStatus: FluentWidgetExecutionStatus;
  /**
   * The message of the last failure to prepare the Fluent ID's account, if any: the reason an
   * `executionStatus` of `"error"` gives.
   */
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
 *
 * @experimental May change or be removed in a minor release while the numbers are measured.
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
 * instant the receipt was in hand, and excludes both the smart-account and authentication setup
 * before the send and the block read after it. It does not equal the sum of the stages and must
 * not be displayed as if it did.
 *
 * Collected for every send, whatever `debugLogging` is set to — the numbers are the answer to
 * "where did the four seconds go", which is a question a host asks in production. A failure
 * inside the measuring code costs the stages it could not establish, never the send.
 *
 * @experimental May change or be removed in a minor release while the numbers are measured.
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
   * Whether the App's Sponsorship paid the gas for this operation, read back off the settled
   * operation (which contract the EntryPoint charged) first: a refused Sponsorship falls back
   * to the account paying its own gas, so a flag set from asking for Sponsorship would report
   * the fallback as a success. `false` for a Gas token payment and always for an External
   * wallet, which has no paymaster. When a Fluent ID's receipt names no paymaster, the way the
   * operation was sent decides: `false` when it made no sponsored submission (the fallback,
   * `sponsorship: "never"`, Sponsorship unavailable or not configured), and `null` after a
   * sponsored submission, where nothing says who paid.
   */
  sponsored: boolean | null;
  /**
   * The paymaster a Fluent ID's receipt names: the Sponsorship paymaster or a Gas token's
   * paymaster, when one paid. Undefined when the receipt carried no paymaster — `sponsored` is
   * then `false`, or `null` after a sponsored submission — and always for an External wallet,
   * which has no paymaster.
   *
   * @experimental May change or be removed in a minor release while the numbers are measured.
   */
  paymaster?: Address;
  /**
   * Where this send's milliseconds went, as a `FluentExecuteTiming` whose raw instants are a
   * `FluentExecuteTimingInstants`. Fluent ID only: an External wallet performs its prompt, its
   * signing and its broadcast behind one `sendTransaction` await, so EIP-1193 exposes no
   * truthful instant to put a boundary on.
   *
   * @experimental May change or be removed in a minor release while the numbers are measured.
   */
  timing?: FluentExecuteTiming;
};

/** The Gas payment chosen in the widget: the Gas token's symbol, its address and decimals. */
export type FluentWidgetGasPayment = {
  symbol: FluentGasTokenSymbol;
  token?: Address;
  decimals: number;
};

/** What `widget.createBatchOp` takes: the calls of one Batch operation, and its Review title. */
export type FluentBatchOperationInput = {
  id?: string;
  /**
   * Heading of this Batch operation's Review (Fluent ID, Prompt mode). Defaults to the
   * widget's own copy, "Confirm transaction".
   */
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
};

/** What executes a Batch operation for the widget. Internal: hosts call `execute()` only. */
export type FluentBatchOperationExecutor = {
  smartAccountReady?: boolean;
  account?: FluentWidgetAccount;
  ensureReady?: (options: FluentBatchOperationExecuteOptions) => Promise<unknown>;
  defaultSigningMode?: FluentSigningMode;
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
   * Call targets Quick sign may skip the Review for, compared case-insensitively.
   * Set, it caps every `"silent"` signing mode — the widget default and an explicit
   * per-execute option alike, because it is the host's guardrail and a per-call option
   * must not be able to lift it: an operation with any call outside the list reviews
   * and signs as `"prompt"`. Undefined leaves Quick sign covering every address.
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

/**
 * How a Fluent ID signs: `"prompt"` shows the widget's Review first (Prompt mode), `"silent"`
 * signs with none (Silent mode), except that where the App set `quickSign.whitelistAddresses`, a
 * Batch operation with a call outside it is signed as `"prompt"`. An External wallet always
 * shows its own prompt.
 */
export type FluentSigningMode = "prompt" | "silent";

/**
 * The signing mode a value names, failing closed: only exactly `"silent"` is Silent mode, and
 * every other value is Prompt mode, with the Review. A JavaScript host is not held to the type,
 * and one still passing 0.5's `"always"` or `"session"`, or any other string, must not skip the
 * person's Review by it.
 */
export function normalizeSigningMode(value: unknown): FluentSigningMode {
  return value === "silent" ? "silent" : "prompt";
}

/**
 * How one operation's gas is paid: a Gas token by symbol, or native ETH, and whether
 * Sponsorship is asked for.
 */
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
   * `"auto"` tries Sponsorship, and if the paymaster refuses, resends with the account paying
   * its own gas. `"never"` skips the paymaster outright, so the account pays from the first
   * attempt and the result reports `sponsored: false`. What an omitted value means:
   * [guides/sponsorship.md](guides/sponsorship.md#not-asking-sponsorship-never-and-gas-tokens).
   *
   * Ignored when `symbol` names an ERC-20: that token's own paymaster pays,
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

/** The options of `FluentBatchOperation.execute`, every one optional. */
export type FluentBatchOperationExecuteOptions = {
  /**
   * The `FluentSigningMode` of this operation. Defaults to the widget's `signingMode`, which
   * follows the person's Quick sign. A `"silent"` operation with a call outside
   * `quickSign.whitelistAddresses` is signed as `"prompt"`. Any value but `"silent"`, 0.5's
   * `"always"` and `"session"` included, is `"prompt"`. Ignored for an External wallet.
   */
  confirmation?: FluentSigningMode;
  /** How the gas of this operation is paid. Defaults to the Gas payment chosen in the widget. */
  gasPayment?: FluentGasPayment;
  /**
   * Fluent ID gas limits, estimation opt-out or headroom: a `FluentUserOperationGas`, whose
   * fixed limits are a `FluentFixedAccountGas` and a `FluentFixedPaymasterGas`. Ignored for
   * External wallet sends.
   *
   * @experimental May change or be removed in a minor release while the gas policy is measured;
   * omitting it, which lets the widget estimate, is the recommended setting.
   */
  userOperationGas?: FluentUserOperationGas;
};

/** What a Batch operation's Review shows. Internal. */
export type FluentBatchOperationReview = {
  id?: string;
  reviewTitle?: string;
  calls: readonly FluentBatchCallInput[];
  encodedCalls: FluentEncodedBatchCall[];
  account?: FluentWidgetAccount;
};

/**
 * A Batch operation `widget.createBatchOp` built: its calls, encoded, and `execute`, which sends
 * them for the Widget account.
 */
export type FluentBatchOperation = {
  /** `FluentBatchOperationInput.id`, copied. */
  id?: string;
  /** `FluentBatchOperationInput.reviewTitle`, copied. */
  reviewTitle?: string;
  /** The calls as the host passed them. */
  calls: readonly FluentBatchCallInput[];
  /** The same calls encoded, in order: what `execute()` sends. */
  encodedCalls: FluentEncodedBatchCall[];
  /**
   * Whether the widget could send the operation when it was built: the Widget account ready, or
   * able to prepare itself when `execute()` is called. Not updated afterwards; read
   * `widget.account.executionReady` for the live value.
   */
  canExecute: boolean;
  /**
   * Executes the operation for the Widget account and resolves once it is included.
   *
   * @throws `FluentReviewRejectedError` with `code` `transaction_review_rejected` when the
   * person dismisses the Review, which a Fluent ID shows in Prompt mode; an External wallet's
   * refusal in its own prompt rejects with the wallet's error.
   * @throws `FluentSponsorshipFallbackError` when a Fluent ID asked for Sponsorship, a sponsored
   * submission failed, and the submission in which the account pays its own gas failed too;
   * its `code` says why Sponsorship failed: `denied`, `unauthorized`, `unreachable` or
   * `no_token`. A failure while waiting for an operation's inclusion is not wrapped: it rejects
   * with its own error, and an operation whose wait failed was submitted. What else is not
   * wrapped: [guides/sponsorship.md](guides/sponsorship.md#both-failed-fluentsponsorshipfallbackerror).
   * @throws `FluentUserOperationGasError` (experimental) with `code` `invalid_policy` for a
   * `skipEstimation` policy that cannot be used (other invalid `userOperationGas` values throw a
   * plain `Error`), and `paymaster_gas_mismatch` when, with estimation skipped,
   * the paymaster's authorization of a Gas token payment does not match the fixed gas limits.
   * Under Sponsorship, a failed check of the paymaster's gas fails the sponsored submission
   * instead, and the account pays its own gas.
   */
  execute: (options?: FluentBatchOperationExecuteOptions) => Promise<FluentExecuteResult>;
};

/**
 * The Widget API: what the widget gives an App's code to act for the Widget account. Reached as
 * `widget` in the render context or from `useFluentWidget()`.
 */
export type FluentBatchApi = FluentSignApi & {
  /** The Widget account: its address, type, readiness and capabilities. */
  account: FluentWidgetAccount;
  /** How the widget signs by default: `"silent"` while the person's Quick sign is on. */
  signingMode: FluentSigningMode;
  /** The Gas payment chosen in the widget, which `execute()` uses when given no `gasPayment`. */
  gasPayment: FluentWidgetGasPayment;
  /**
   * Builds a Batch operation, encoding its calls now; `execute()` sends it.
   *
   * @throws `Error` when `calls` is empty, or when a call has neither `data` nor `abi` with
   * `method`: a call that still names its function in 0.5's `functionName` is one.
   */
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
    async execute(options) {
      const activeExecutor = executor;
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
        // Normalized once, here: the allowlist check, the Review and the send below all read
        // this value, so none of them sees a value outside the type. Only an omitted value
        // takes the widget's default; an explicit one, `null` included, fails closed.
        confirmation: normalizeSigningMode(
          options?.confirmation === undefined
            ? activeExecutor.defaultSigningMode
            : options.confirmation,
        ),
        gasPayment: gasPayment
          ? { ...gasPayment, sponsorship: gasPayment.sponsorship ?? activeExecutor.defaultSponsorship }
          : undefined,
      };
      // Decided before the Review and the Signer alike: escalating here is what makes a
      // non-whitelisted target show the Review *and* sign in Prompt mode.
      if (
        executionOptions.confirmation === "silent" &&
        activeExecutor.quickSignWhitelist &&
        !isQuickSignWhitelisted(encodedCalls, activeExecutor.quickSignWhitelist)
      ) {
        executionOptions.confirmation = "prompt";
      }
      // The Review explains a Fluent ID's operation. An External wallet shows its own wallet
      // prompt, so the Review is skipped for that account type.
      if (executionOptions.confirmation === "prompt" && activeExecutor.account?.type !== "eoa") {
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

  const functionName = call.method;
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
