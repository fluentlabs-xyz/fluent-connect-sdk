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
  /** The host's own identifier for the call, copied to its `FluentEncodedBatchCall`. */
  id?: string;
  /** The call's name in the Review. Defaults to `method`, else "Contract call". */
  label?: string;
  to: Address;
  /** Native ETH sent with the call, in wei. Defaults to `0n`. */
  value?: bigint;
  /** The encoded calldata. When given, `abi`, `method` and `args` are not read. */
  data?: Hex;
  /** The contract's ABI, to encode `method` with `args` when `data` is not given. */
  abi?: Abi;
  /** The ABI function to encode, with `abi` and `args`, when `data` is not given. */
  method?: string;
  /** The arguments of `method`. Defaults to `[]`. */
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

/** The kind of Widget account: `"smart"` for a Fluent ID, `"eoa"` for an External wallet. */
export type FluentAccountType = "smart" | "eoa";

/** What the Widget account can do, so a host adapts its UI without branching on its type. */
export type FluentAccountCapabilities = {
  /** Whether a Batch operation's calls land in one atomic transaction: a Fluent ID only. */
  atomicBatch: boolean;
  /**
   * Whether gas can be paid in a Gas token instead of native ETH: a Fluent ID only. This is not
   * Sponsorship: the account still pays, in the Gas token.
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
  /**
   * The Widget account's kind. Undefined until a Fluent ID's smart account is ready or an
   * External wallet is connected.
   */
  type?: FluentAccountType;
  /** What the Widget account can do. */
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
 * `prepareMs`, `signMs`, `broadcastMs`, `retryMs` and `totalMs` are measured on the client's
 * monotonic clock (`performance.now()`). `inclusionMs` and `detectMs` are signed estimates across
 * the client's clock and the chain's `block.timestamp`, which has one-second resolution: either
 * may be negative when small, neither is clamped, and `instants` keeps their inputs. `totalMs`
 * runs from the first submission to the receipt in hand, without the account and authentication
 * setup before it or the block read after, and is not the sum of the stages. Collected for every
 * send, whatever `debugLogging` is set to; a failure in the measuring code loses the stages it
 * could not establish, not the send.
 *
 * @experimental May change or be removed in a minor release while the numbers are measured.
 */
export type FluentExecuteTiming = {
  /**
   * Building the user operation (nonce, gas estimate, paymaster) up to the signature request.
   * Absent when the clock could not be read at that boundary: no stage here is approximated.
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
   * Time spent on submissions that did not settle (a sponsored submission whose Auth token was
   * refused, a refused Sponsorship falling back to own gas) and on the new Auth token between
   * them. It belongs to no stage, is counted inside `totalMs`, and is `0` for one submission.
   */
  retryMs: number;
  /** First submission to receipt in hand. Measured directly; never a sum of the stages. */
  totalMs: number;
  /** The raw instants the signed estimates above were computed from. */
  instants: FluentExecuteTimingInstants;
};

/** The result of executing a Batch operation. */
export type FluentExecuteResult = {
  /**
   * The hash of the transaction holding the last call: a Fluent ID's one transaction, or an
   * External wallet's last.
   */
  hash: Hash;
  /** Every transaction hash, in order: one for a Fluent ID, one per call for an External wallet. */
  hashes: Hash[];
  /** The receipt of `hash` once it is included; not a finality guarantee. */
  receipt?: TransactionReceipt;
  /** The ERC-4337 user operation hash, for a Fluent ID. */
  userOpHash?: Hash;
  /**
   * `true` when all calls landed in one transaction (a Fluent ID), `false` for an External
   * wallet's one transaction per call.
   */
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
   * @experimental May change or be removed in a minor release.
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
  /** The host's own identifier for the operation, copied to `FluentBatchOperation.id`. */
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
  /** The Gas payment chosen in the widget, which `execute` uses when given no `gasPayment`. */
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
   * `readyAccount` is what `ensureReady` resolved with for this execution, or `undefined` when
   * the executor was already ready. An executor built in a React render closes over that
   * render's readiness, which `ensureReady` resolving does not update, so this argument is how
   * `sendCalls` reaches the account that just became ready.
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
 * Returns the signing mode a value names, failing closed: only exactly `"silent"` is Silent mode,
 * and every other value is Prompt mode, with the Review. A JavaScript host is not held to the
 * type, and one passing 0.5's `"always"` or `"session"`, or any other string, must not skip the
 * person's Review by it.
 */
export function normalizeSigningMode(value: unknown): FluentSigningMode {
  return value === "silent" ? "silent" : "prompt";
}

/**
 * How one operation's gas is paid: a Gas token by symbol, or native ETH, and whether
 * Sponsorship is asked for.
 *
 * Without `includeApproval`, the widget adds the approval of the Gas token to its ERC-20
 * paymaster at the start of the operation when the account's allowance is below the threshold:
 * 1 USDnr when the allowance is below 0.1 USDnr, 10 BLEND when it is below 1 BLEND. An
 * allowance that cannot be read counts as none. `includeApproval: true` with an `approveAmount`
 * approves that amount instead, whatever the allowance. Either way the Review lists the
 * operation's own calls, and nothing is added for `"ETH"` or for an External wallet.
 */
export type FluentGasPayment = {
  /**
   * The Gas token's symbol, whose address the widget resolves for the Network. `"ETH"` means
   * native gas, with no Gas token paymaster.
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
   * Ignored when `symbol` names a Gas token, whose own paymaster pays.
   */
  sponsorship?: "auto" | "never";
} & (
  | {
      /** Approves `approveAmount` to the paymaster whatever the allowance, for a Gas token. */
      includeApproval: true;
      /** In the Gas token's smallest unit. */
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
   * @throws `FluentGasPaymentError` when a Fluent ID's operation is paid in a Gas token and
   * cannot be prepared; nothing has been signed or sent. Its `code` is `paymaster_unavailable`
   * when the address of the paymaster to approve the Gas token to cannot be read,
   * `insufficient_gas_token` when the paymaster's simulation of the operation cannot charge the
   * fee in the Gas token, and `paymaster_rejected` when the paymaster refuses to charge the fee in
   * the Gas token for another reason. The account's balance of the Gas token is not read first:
   * the operation may acquire the fee itself.
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
   * Throws an `Error` when `calls` is empty, or when a call has neither `data` nor `abi` with
   * `method`; a call naming its function in 0.5's `functionName` has neither.
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
      // With no `gasPayment`, the Gas payment chosen in the widget applies. A native ETH choice
      // is passed on only with a `defaultSponsorship`, so that a `"never"` reaches the send.
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
          ? {
              ...gasPayment,
              sponsorship: gasPayment.sponsorship ?? activeExecutor.defaultSponsorship,
            }
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
      const executionReady =
        activeExecutor.account?.executionReady ?? activeExecutor.smartAccountReady === true;
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
