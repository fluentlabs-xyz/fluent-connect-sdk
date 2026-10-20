import type { SignTypedDataParams } from "@privy-io/react-auth";
import {
  usePrivy,
  useSignMessage,
  useSignTypedData,
  useWallets,
} from "./privyAdapter";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  deserializePermissionAccount,
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import {
  CallPolicyVersion,
  CallType,
  toCallPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  createKernelAccount,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bytesToHex,
  createPublicClient,
  getAddress,
  isHex,
  numberToHex,
  parseAbiItem,
  stringToHex,
  toEventSelector,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
  type SignableMessage,
  type TypedData,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount, toAccount, type CustomSource } from "viem/accounts";
import type { Chain } from "viem";

import {
  FLUENT_CONNECT_DEFAULT_EXECUTION,
  FLUENT_CONNECT_ZERODEV_PROJECT_ID,
  type ResolvedFluentWidgetExecution,
} from "../core/config";
import type {
  FluentAccountType,
  FluentBatchOperationExecuteOptions,
  FluentExecuteTiming,
} from "./batchOperation";
import type { FluentSponsorshipReason } from "../core/sponsorshipFailure";
import {
  buildSponsoredClient,
  resolveSponsorshipBearer,
  sendWithSponsorship,
  type SponsorshipTokenRequest,
} from "../core/sponsoredClient";

export type { FluentSponsorshipReason } from "../core/sponsorshipFailure";

import {
  createFluentZeroDevErc20Paymaster,
  createFluentZeroDevErc20PaymasterApprovalCall,
  createFluentZeroDevSponsoredPaymaster,
} from "../core/zerodevPaymaster";
import { useFluentWidgetNetwork } from "./widgetNetworkContext";
import { debugLog, debugWarn, debugError } from "../core/debugLogger";
import {
  closeSendTiming,
  epochNow,
  monotonicNow,
  sendUserOperationWithTiming,
  span,
  type FluentUserOperationAttempt,
} from "../core/userOperationTiming";
import {
  createFluentUserOperationFeeHook,
  isFluentFeeRejection,
  type FluentFeeAttempt,
} from "../core/userOperationFees";
import {
  readFluentInclusionAnchor,
  waitForFluentUserOperationReceipt,
  type FluentReceiptSource,
} from "../core/userOperationReceipt";
import { validateUserOperationGas } from "../core/userOperationGas";
import { getFluentGasTokenAddress } from "../core/gasPayment";
import { createFluentBundlerTransport, createFluentRpcTransport } from "../core/rpc";
import { stringifyWithBigInt } from "../utils";

type KernelAccount = Awaited<ReturnType<typeof createKernelAccount>>;
type KernelClient = ReturnType<typeof createKernelAccountClient>;
type KernelUserOperationReceipt = Awaited<
  ReturnType<KernelClient["waitForUserOperationReceipt"]>
>;
type PrivyEthereumWallet = {
  address: string;
  sign: (message: string) => Promise<string>;
  switchChain?: (targetChainId: number | `0x${string}`) => Promise<void>;
  getEthereumProvider: () => Promise<unknown>;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Where a sponsored operation gets its bearer: the Fluent token for the connected account, and
 * which kind of account that is. Read at send time through a function rather than taken as a
 * value, because `useFluentZeroDevAccount` is constructed before the widget has derived the
 * account or built its `getAuthToken()`, and reordering the widget would change when the kernel
 * initializes.
 */
export type FluentZeroDevSponsorshipTokenSource = {
  accountType: FluentAccountType | undefined;
  getAuthToken: SponsorshipTokenRequest;
};

/**
 * The widget's execution settings, read at the moment they are needed.
 *
 * A function rather than a value because a kernel client is built once and cached for as long
 * as the account lives, while `FluentWidgetConfig.execution` is the host's and may change under
 * it: the send after a change has to obey the new settings without the kernel being rebuilt.
 *
 * Not exported: every reader of it is in this file, and `index.ts` re-exports this module whole.
 */
type FluentZeroDevExecutionReader = () => ResolvedFluentWidgetExecution;

/**
 * Reading the Signer's chain, as the kernel that holds the Signer reads it.
 *
 * One `eth_chainId` on the embedded provider, and a switch when the answer is another chain.
 * A function rather than the wallet itself, so the only thing an operation needs in order to
 * check the chain is the account it signs with.
 */
type FluentSignerChainCheck = () => Promise<void>;

/** The account methods a signature is asked for through, as viem and `@zerodev/sdk` name them. */
type FluentAccountSignature = "signUserOperation" | "signMessage" | "signTypedData";

/**
 * The key the check above travels under, from the kernel that captured the Signer to the
 * operation that signs through it.
 *
 * A symbol, so it collides with nothing viem or `@zerodev/sdk` reads off an account and survives
 * the object spreads both of them do — the same channel `core/userOperationFees.ts` carries one
 * submission's fee decision on, and for the same reason: the account is the one object each
 * operation holds its own copy of.
 */
const FLUENT_SIGNER_CHAIN_CHECK = Symbol.for("fluent.signer.chainCheck");

/** The same account, carrying how its Signer's chain is read. */
function carryFluentSignerChainCheck<account extends object>(
  account: account,
  check: FluentSignerChainCheck,
): account {
  return { ...account, [FLUENT_SIGNER_CHAIN_CHECK]: check };
}

/**
 * How this account's Signer's chain is read, or nothing.
 *
 * Nothing is the authorized-session kernel: its signer is a local key, with no wallet to ask and
 * no chain to be on. An operation that finds nothing here makes no chain request, which is the
 * right answer for that kernel rather than a failure.
 */
function readFluentSignerChainCheck(account: unknown): FluentSignerChainCheck | undefined {
  if (typeof account !== "object" || account === null) return undefined;
  const check = (account as Record<symbol, unknown>)[FLUENT_SIGNER_CHAIN_CHECK];
  return typeof check === "function" ? (check as FluentSignerChainCheck) : undefined;
}

/**
 * The same account, with `before` awaited ahead of each of `signatures`.
 *
 * This is where `execution.chainCheckBeforeSign` is obeyed, and it is not the Signer adapter
 * because an adapter cannot tell whose signature it is being asked for: it is built once per
 * kernel and the Kernel account's validator calls it with a message and nothing else, while a
 * send that must keep the setting it started with, a standalone signature that must read the
 * live one, and a second send under a setting the host has since changed all reach that one
 * adapter. The account is the one object each of the three holds its own copy of, so the check
 * sits on it: no two operations share the answer, and none can read another's.
 *
 * A send signs through `signUserOperation`; a standalone `widget.signMessage` or
 * `widget.signTypedData` signs through the two methods named after it.
 */
function withFluentSignerChainCheck<account extends object>(
  account: account,
  signatures: readonly FluentAccountSignature[],
  before: () => Promise<void>,
): account {
  const checked = { ...account } as Record<string | symbol, unknown>;
  for (const name of signatures) {
    const sign = (account as Record<string, unknown>)[name];
    if (typeof sign !== "function") continue;
    checked[name] = async (...args: unknown[]) => {
      await before();
      // Applied to the account it came from, so a method that reads `this` — viem's
      // `getFactoryArgs` does — keeps the object whose state it was written against.
      return (sign as (...rest: unknown[]) => unknown).apply(account, args);
    };
  }
  return checked as account;
}

/**
 * The kernel's account as the rest of the widget holds it: the Signer's chain read before a
 * standalone signature when the host asks for it, and the check itself carried for a send.
 *
 * The live setting is read at the signature, not here, so a host that turns the check on is
 * obeyed by the next standalone signature rather than after a remount. A send does not go
 * through these two methods: it pins the setting it read at its start and installs its own
 * check on `signUserOperation` (`sendCalls`).
 */
function toFluentSigningAccount(params: {
  account: KernelAccount;
  wallet: PrivyEthereumWallet;
  chain: Chain;
  readExecution: FluentZeroDevExecutionReader;
}): KernelAccount {
  const check: FluentSignerChainCheck = () =>
    ensureWalletOnFluentChain(params.wallet, params.chain);
  return withFluentSignerChainCheck(
    carryFluentSignerChainCheck(params.account, check),
    ["signMessage", "signTypedData"],
    async () => {
      if (!params.readExecution().chainCheckBeforeSign) return;
      await check();
    },
  );
}

export type FluentZeroDevSignerMode = "prompt" | "silent";

type FluentZeroDevKernels = Partial<Record<FluentZeroDevSignerMode, FluentZeroDevKernel>>;

type FluentZeroDevPromptedSigners = {
  signMessage: ReturnType<typeof useSignMessage>["signMessage"];
  signTypedData: ReturnType<typeof useSignTypedData>["signTypedData"];
};

type FluentZeroDevCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
};

export type FluentZeroDevKernel = {
  account: KernelAccount;
  client: KernelClient;
  publicClient: ReturnType<typeof createPublicClient>;
  smartAccountAddress: Address;
  zeroDevRpcUrl: string;
  chain: Chain;
  signerMode: FluentZeroDevSignerMode;
  signerSource: "privy" | "session";
};

export type FluentZeroDevPermissionSession = {
  serializedPermissionAccount: string;
  sessionSignerAddress: Address;
  smartAccountAddress: Address;
};

export type FluentZeroDevPermissionCall = {
  target: Address;
  selector?: Hex;
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  valueLimit?: bigint;
  callType?: CallType;
};

export function useFluentZeroDevAccount(hookOptions: {
  /** App id in the sponsorship path. Sponsorship is off unless both this and the URL are set. */
  appId?: string;
  sponsorshipUrl?: string;
  /** The Fluent token a sponsored operation authenticates with. Without it nothing is sponsored. */
  sponsorshipTokenSource?: () => FluentZeroDevSponsorshipTokenSource | null;
  authorizationSession?: {
    expiresAt: number;
    serializedPermissionAccount: string;
    sessionPrivateKey: Hex;
  };
  sessionSignerAddress?: Address;
  sessionSmartAccountAddress?: Address;
  /**
   * Where a send reads its fees and its receipt, and whether the Signer's chain is read before
   * every signature. Omitted, the defaults of `FLUENT_CONNECT_DEFAULT_EXECUTION` apply.
   */
  execution?: ResolvedFluentWidgetExecution;
  /** Prefer over Privy's login when the host needs to remount Privy first. */
  login?: () => void;
} = {}) {
  const { chain, network } = useFluentWidgetNetwork();
  // No `getAccessToken`: the sponsorship paymaster is authenticated with the Fluent token from
  // `getAuthToken()`, and the kernel signs through the embedded wallet, not through a token.
  const { authenticated, login: privyLogin, ready } = usePrivy();
  const login = hookOptions.login ?? privyLogin;
  const { signMessage: promptSignMessage } = useSignMessage();
  const { signTypedData: promptSignTypedData } = useSignTypedData();
  const { wallets } = useWallets();
  const [kernels, setKernels] = useState<FluentZeroDevKernels>({});
  const [error, setError] = useState<Error | null>(null);
  const [smartAccountReady, setSmartAccountReady] = useState(false);
  const initPromise = useRef<
    Partial<Record<FluentZeroDevSignerMode, Promise<FluentZeroDevKernel | null>>>
  >({});
  // Set on a 403 only — an unregistered App would otherwise pay a failed round trip on
  // every operation. A policy denial is per-op, a 502 is transient, and a 401 means this
  // Fluent token was rejected, which one forced refresh and one retry answer; none of the
  // three set it.
  const sponsorshipUnavailable = useRef(false);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const activeKernel = kernels.prompt ?? kernels.silent ?? null;
  /**
   * The execution settings every kernel client, every signature and every send reads through
   * `readExecution`. Written during render rather than from an effect: a send started in the
   * same tick as a configuration change must obey the new settings, and an effect would land
   * after that send had already read the old ones.
   */
  const executionRef = useRef<ResolvedFluentWidgetExecution>(FLUENT_CONNECT_DEFAULT_EXECUTION);
  executionRef.current = hookOptions.execution ?? FLUENT_CONNECT_DEFAULT_EXECUTION;
  const readExecution = useCallback<FluentZeroDevExecutionReader>(
    () => executionRef.current,
    [],
  );

  useEffect(() => {
    setKernels({});
    setSmartAccountReady(false);
    setError(null);
    initPromise.current = {};
  }, [chain.id]);

  const initialize = useCallback(async (options: {
    throwOnError?: boolean;
    signerMode?: FluentZeroDevSignerMode;
  } = {}) => {
    const signerMode = options.signerMode ?? "prompt";
    const cachedKernel = kernels[signerMode];
    debugLog("[fluent zerodev] initialize requested", {
      signerMode,
      ready,
      authenticated,
      walletCount: wallets.length,
      embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
      embeddedWallet: embeddedWallet?.address,
      hasKernel: Boolean(cachedKernel),
      cachedSignerModes: Object.keys(kernels),
      initInFlight: Boolean(initPromise.current[signerMode]),
      throwOnError: Boolean(options.throwOnError),
      hasProjectId: Boolean(FLUENT_CONNECT_ZERODEV_PROJECT_ID),
    });
    if (cachedKernel) {
      debugLog("[fluent zerodev] using cached kernel", {
        signerMode,
        smartAccountAddress: cachedKernel.smartAccountAddress,
      });
      return cachedKernel;
    }
    const canUseLocalSigner = ready && authenticated && Boolean(embeddedWallet);
    const canUseAuthorizationSession =
      signerMode === "silent" &&
      Boolean(hookOptions.authorizationSession?.serializedPermissionAccount) &&
      (hookOptions.authorizationSession?.expiresAt ?? 0) > Math.floor(Date.now() / 1000);
    if (!canUseLocalSigner && !canUseAuthorizationSession) {
      const nextError = new Error(getZeroDevReadinessMessage({
        ready,
        authenticated,
        embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
        walletCount: wallets.length,
      }));
      debugWarn("[fluent zerodev] initialize blocked", {
        message: nextError.message,
        ready,
        authenticated,
        embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
        walletCount: wallets.length,
      });
      setError(nextError);
      if (options.throwOnError) throw nextError;
      return null;
    }
    if (initPromise.current[signerMode]) {
      debugLog("[fluent zerodev] joining in-flight initialization");
      return initPromise.current[signerMode];
    }
    if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) {
      setKernels({});
      setSmartAccountReady(false);
      setError(null);
      debugWarn("[fluent zerodev] initialize blocked: project id missing");
      return null;
    }

    setSmartAccountReady(Boolean(activeKernel));
    setError(null);

    initPromise.current[signerMode] = (async () => {
      debugLog("[fluent zerodev] initializing", {
        signerMode,
        embeddedWallet: embeddedWallet?.address,
        walletClientType: embeddedWallet?.walletClientType,
      });
      const nextKernel = canUseAuthorizationSession
        ? await createFluentZeroDevAuthorizedSessionKernel(
            hookOptions.authorizationSession!,
            chain,
            readExecution,
          )
        : await createFluentZeroDevKernel({
            wallet: embeddedWallet as PrivyEthereumWallet,
            signerMode,
            promptedSigners: {
              signMessage: promptSignMessage,
              signTypedData: promptSignTypedData,
            },
            chain,
            readExecution,
          });
      if (
        hookOptions.sessionSmartAccountAddress &&
        nextKernel.smartAccountAddress.toLowerCase() !==
          hookOptions.sessionSmartAccountAddress.toLowerCase()
      ) {
        throw new Error("Fluent Connect signer does not control the connected smart account");
      }
      debugLog("[fluent zerodev] ready", {
        signerMode,
        signerAddress: embeddedWallet?.address,
        smartAccountAddress: nextKernel.smartAccountAddress,
      });
      setKernels((current) => ({ ...current, [signerMode]: nextKernel }));
      setSmartAccountReady(true);
      return nextKernel;
    })();

    try {
      return await initPromise.current[signerMode];
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error("Failed to create ZeroDev account");
      debugError("[fluent zerodev] initialization failed", nextError);
      setKernels((current) => {
        const { [signerMode]: _failed, ...rest } = current;
        setSmartAccountReady(Object.keys(rest).length > 0);
        return rest;
      });
      setError(nextError);
      if (options.throwOnError) throw nextError;
      return null;
    } finally {
      delete initPromise.current[signerMode];
    }
  }, [
    activeKernel,
    authenticated,
    embeddedWallet,
    kernels,
    hookOptions.sessionSmartAccountAddress,
    hookOptions.authorizationSession,
    promptSignMessage,
    promptSignTypedData,
    readExecution,
    ready,
  ]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setKernels({});
      setSmartAccountReady(false);
      setError(null);
      initPromise.current = {};
    }
  }, [authenticated, ready]);

  const sendTransaction = useCallback(
    async (request: { to: Address; data?: Hex; value?: bigint }): Promise<Hash> => {
      const cachedKernel = kernels.prompt;
      const executionKernel = cachedKernel ?? await initialize({ signerMode: "prompt" });
      if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      debugLog("[fluent zerodev] sendTransaction", {
        signerMode: executionKernel.signerMode,
        smartAccountAddress: executionKernel.smartAccountAddress,
        to: request.to,
        hasData: Boolean(request.data && request.data !== "0x"),
        value: (request.value ?? 0n).toString(),
      });
      try {
        const hash = await executionKernel.client.sendTransaction({
          account: executionKernel.account,
          chain: executionKernel.chain,
          to: request.to,
          data: request.data ?? "0x",
          value: request.value ?? 0n,
        });
        debugLog("[fluent zerodev] sendTransaction submitted", { hash });
        return hash;
      } catch (err) {
        debugError("[fluent zerodev] sendTransaction failed", err);
        throw err;
      }
    },
    [error, initialize, kernels.prompt],
  );

  /**
   * The sponsored client for one attempt, around one Fluent token. A rebuild is what a forced
   * refresh means on the wire: the bearer lives in the paymaster transport's headers.
   */
  const createSponsoredClient = useCallback(
    (kernel: FluentZeroDevKernel, sponsorship: { sponsorshipUrl: string; appId: string }) =>
      (bearerToken: string): KernelClient =>
        buildSponsoredClient({
          kernel,
          bearerToken,
          sponsorshipUrl: sponsorship.sponsorshipUrl,
          appId: sponsorship.appId,
          createPaymaster: createFluentZeroDevSponsoredPaymaster,
          createClient: ({ kernel: target, paymaster }) =>
            createFluentZeroDevKernelClient({ kernel: target, readExecution, paymaster }),
        }),
    [readExecution],
  );

  const sendCalls = useCallback(
    async (
      calls: FluentZeroDevCall[],
      options?: FluentBatchOperationExecuteOptions,
      /**
       * A kernel `ensureExecutionReady` returned moments ago, typed `unknown` because it
       * travels through `FluentBatchOperationExecutor.sendCalls`, which knows nothing about
       * kernels. Needed because `kernels` below is the state of this callback's render: when
       * readiness was reached during the `await` that precedes this call, that state is still
       * empty and a second `initialize` would run — another account derivation and another
       * signer prompt for one operation.
       */
      readyAccount?: unknown,
    ): Promise<{
      hash: Hash;
      receipt: TransactionReceipt;
      userOpHash: Hash;
      sponsored: boolean;
      sponsorshipReason?: FluentSponsorshipReason;
      paymaster?: Address;
      /** Where this send's milliseconds went. Absent only when the measurement itself failed. */
      timing?: FluentExecuteTiming;
    }> => {
      /**
       * The timing diagnostics of this send, wrapped so none of them can cost it.
       *
       * Every stage line of this send goes through it, with no exception for the ones that look
       * harmless: most are written when the bundler may already hold the operation, and two sit
       * in a `finally`, so a throw from one would reject a send that has been made — replacing a
       * settled receipt with an exception, losing the operation hash the caller is owed, or
       * replacing the submission error the caller has to classify. The
       * clocks are read through `monotonicNow`/`epochNow` and subtracted with `span` for the
       * same reason, so an unreadable clock costs a number and never the send. The host's
       * console is the host's, and a patched one that throws is its own hazard.
       */
      const timingLog = (label: string, line: Record<string, unknown>) => {
        try {
          debugLog(label, line);
        } catch {
          // A diagnostic line is worth less than the send it would break.
        }
      };
      const startedAt = monotonicNow();
      timingLog("[fluent execution stage]", { stage: "setup" });
      validateUserOperationGas(options?.userOperationGas);
      // Read once, at the start: every attempt and the inclusion wait of this send answer to
      // the same settings, however the host changes them while it runs. Its signatures answer
      // to them too, through the account below — they are made deep inside `@zerodev/sdk`, so
      // the setting travels on the one object this send does not share.
      const execution = readExecution();
      const signerMode = confirmationToSignerMode(options?.confirmation ?? "always");
      // Accepted only for this send's own signer mode: a silent send must not be signed by the
      // prompting kernel, or a prompting one signed silently, however fresh the kernel is.
      const readyKernel =
        readyAccount &&
        typeof readyAccount === "object" &&
        (readyAccount as FluentZeroDevKernel).signerMode === signerMode
          ? (readyAccount as FluentZeroDevKernel)
          : undefined;
      const knownKernel = readyKernel ?? kernels[signerMode];
      const hasAuthorizationSession =
        signerMode === "silent" &&
        Boolean(hookOptions.authorizationSession?.serializedPermissionAccount) &&
        (hookOptions.authorizationSession?.expiresAt ?? 0) > Math.floor(Date.now() / 1000);
      const executionKernel = knownKernel ?? await initialize({ signerMode, throwOnError: true });
      if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      const gasToken = options?.gasPayment?.symbol
        ? getFluentGasTokenAddress(options.gasPayment.symbol, network)
        : undefined;
      const preparedCalls = [...calls];
      if (gasToken && options?.gasPayment?.includeApproval) {
        preparedCalls.unshift(await createFluentZeroDevErc20PaymasterApprovalCall({
          chain: executionKernel.chain,
          gasToken,
          approveAmount: options.gasPayment.approveAmount,
        }));
      }
      debugLog("[fluent zerodev] sendCalls", {
        signerMode,
        smartAccountAddress: executionKernel.smartAccountAddress,
        gasToken,
        gasTokenSymbol: options?.gasPayment?.symbol,
        sponsorship: options?.gasPayment?.sponsorship ?? "auto",
        approvalIncluded: Boolean(gasToken && options?.gasPayment?.includeApproval),
        calls: preparedCalls.map((call) => ({
          to: call.to,
          hasData: Boolean(call.data && call.data !== "0x"),
          value: (call.value ?? 0n).toString(),
        })),
      });
      setPromptSigningContext({
        intent: "transaction",
        gasTokenSymbol: options?.gasPayment?.symbol,
      });
      /**
       * The account this send signs its operation with: this send's copy, carrying the setting
       * it read at its start.
       *
       * Both submissions of a fee retry sign under that one reading, whatever the host does to
       * `execution.chainCheckBeforeSign` while they run, and no other operation can see it —
       * a standalone signature and the next send hold their own accounts and read the setting
       * for themselves (`withFluentSignerChainCheck`). Unwrapped when the check is off, or when
       * the kernel has no Signer chain to read: the account is then passed on as it came.
       */
      const signerChainCheck = execution.chainCheckBeforeSign
        ? readFluentSignerChainCheck(executionKernel.account)
        : undefined;
      const signingAccount = signerChainCheck
        ? withFluentSignerChainCheck(
            executionKernel.account,
            ["signUserOperation"],
            signerChainCheck,
          )
        : executionKernel.account;
      try {
        const submissionStartedAt = monotonicNow();
        // Every submission this send makes, in order — a rejected bearer is retried, a refused
        // sponsorship falls back to own gas — including the ones that failed, which name no
        // operation but were still waited for. Only the attempt whose hash comes back owns the
        // stages; what the others cost is reported as retry overhead.
        const submissions: FluentUserOperationAttempt[] = [];
        const submitOnce = async (client: KernelClient, feeAttempt: FluentFeeAttempt) => {
          // The one submission point of this send, so the caller's explicit gas policy and the
          // recording of this attempt travel together: every attempt is both governed by the
          // policy and counted towards the retry overhead, and neither can be forgotten at a
          // call site.
          const submission = await sendUserOperationWithTiming(
            client,
            callArgs,
            options?.userOperationGas,
            (attempt) => {
              submissions.push(attempt);
            },
            feeAttempt,
          );
          return submission.userOpHash;
        };
        /**
         * Whether this send has already spent its one fee retry.
         *
         * The budget is the send's, not the quote's: a bundler that refuses a fee refuses the
         * operation in front of it, and a fresh quote and a fresh preparation are worth one
         * attempt whichever source answered the first one — the host asked for `bundler`, or a
         * chain quote fell back to it. What must not happen is a third submission, so the flag
         * is checked before the retry rather than the source of the quote that was refused.
         */
        let feeRetrySpent = false;
        /**
         * One operation, and one retry when the bundler refused this send's fee quote.
         *
         * The retry is the chain quote's whole risk, answered inside the send that took it: the
         * bundler is asked for its own quote, the operation is prepared and signed again — a
         * second Privy prompt in prompt mode — and submitted once more. A second rejection is
         * the bundler's answer to its own quote and reaches the caller unchanged; nothing is
         * latched, so the next send asks the chain first again (FLU-1591, Q3).
         *
         * Only this one rejection is retried. Every other failure — a policy denial, a rejected
         * bearer, a reverted estimate — belongs to the caller or to the sponsorship path, which
         * has its own single retry and must not see this one.
         */
        const submit = async (client: KernelClient) => {
          const feeAttempt: FluentFeeAttempt = { feeSource: execution.feeSource };
          try {
            return await submitOnce(client, feeAttempt);
          } catch (err) {
            if (feeRetrySpent) throw err;
            if (!isFluentFeeRejection(err)) throw err;
            feeRetrySpent = true;
            debugWarn("[fluent zerodev] fee rejected, retrying with the bundler's quote", {
              feeSource: feeAttempt.settledFeeSource,
            });
            return await submitOnce(client, { feeSource: "bundler" });
          }
        };
        // When this client held the receipt, on both clocks: the monotonic one closes `totalMs`,
        // the wall-clock one is the only thing the chain's `block.timestamp` can be compared to.
        let receivedAt: number | undefined;
        let receivedAtEpochMs: number | undefined;
        /**
         * The block number `receiptSource: "chain"` anchors its log filter to, read before the
         * first broadcast. Absent when this send waits on the bundler — because the host asked
         * for it, or because the chain could not be read.
         */
        let inclusionAnchor: bigint | undefined;
        const waitForInclusion = async (client: KernelClient, hash: Hash) => {
          const waitStartedAt = monotonicNow();
          // Guarded, and for the sharpest of the reasons above: by the time this line runs the
          // bundler already holds the operation, so a throw from it would reject a send that
          // has been made, and `hash` — the only name the caller has for it — would be lost
          // before the inclusion wait was ever entered.
          timingLog("[fluent execution stage]", { stage: "submitted", userOpHash: hash });
          // Which source answered, for the line below. The requested one is not it: a chain
          // wait that fell back mid-flight was answered by the bundler and says so.
          let settledReceiptSource: FluentReceiptSource | undefined;
          try {
            const operation = await waitForFluentUserOperationReceipt<KernelUserOperationReceipt>({
              bundlerClient: client,
              chainClient: executionKernel.publicClient,
              hash,
              entryPoint: executionKernel.account.entryPoint.address,
              anchorBlockNumber: inclusionAnchor,
              receiptSource: execution.receiptSource,
              onReceiptSource: (source) => {
                settledReceiptSource = source;
              },
            });
            // Read through the timing module's guarded clocks: a receipt in hand must survive
            // an unreadable clock, which costs the timeline and not the send.
            receivedAt = monotonicNow();
            receivedAtEpochMs = epochNow();
            return operation;
          } finally {
            // Named for what it measures. The old `inclusionMs` conflated bundling, block time
            // and this client's own polling delay — the very three the result now separates.
            // The whole line is guarded: this one runs with the receipt already in hand.
            timingLog("[fluent inclusion timing]", {
              userOpHash: hash,
              waitMs: span(waitStartedAt, monotonicNow()),
              receiptSource: settledReceiptSource,
            });
          }
        };
        const callArgs = {
          account: signingAccount,
          calls: preparedCalls.map((call) => ({
            to: call.to,
            data: call.data ?? "0x",
            value: call.value ?? 0n,
          })),
        };
        // Opting out is checked before anything is built, not after: a sponsored attempt
        // exchanges a Fluent token, and minting one to then discard it is a round trip — and,
        // for an external wallet, a signature prompt — spent on a paymaster the caller has
        // already refused.
        // `!gasToken` is part of the condition, not an accident: `sponsorship` is documented
        // as ignored for an ERC-20 send, where that token's own paymaster pays and
        // sponsorship was never in the picture to refuse.
        const sponsorshipRefused = !gasToken && options?.gasPayment?.sponsorship === "never";
        const sponsorship =
          hookOptions.sponsorshipUrl && hookOptions.appId
            ? { sponsorshipUrl: hookOptions.sponsorshipUrl, appId: hookOptions.appId }
            : null;
        const executionClient = gasToken
          ? createFluentZeroDevErc20ExecutionClient(executionKernel, gasToken, readExecution)
          : executionKernel.client;
        const callSponsored =
          !gasToken && !sponsorshipRefused && sponsorship && !sponsorshipUnavailable.current;

        // Before the first broadcast, and awaited: `fromBlock` has to name a block this
        // operation cannot already be in, and after the broadcast no such block is left to
        // name. One `eth_blockNumber` against the inclusion wait it anchors — about 70 ms
        // ahead of a send that saves about 480 ms on detection.
        if (execution.receiptSource === "chain") {
          inclusionAnchor = await readFluentInclusionAnchor(executionKernel.publicClient);
        }

        let sponsorshipReason: FluentSponsorshipReason | undefined;
        let settlementClient: KernelClient = executionClient;
        let userOpHash: Hash;
        let receipt: KernelUserOperationReceipt;
        let sponsoredSend = false;
        if (callSponsored) {
          const tokenSource = hookOptions.sponsorshipTokenSource?.() ?? null;
          const outcome = await sendWithSponsorship<KernelClient, KernelUserOperationReceipt>({
            resolveBearer: ({ fresh }) =>
              resolveSponsorshipBearer({
                accountType: tokenSource?.accountType,
                getAuthToken: tokenSource?.getAuthToken,
                fresh,
                log: sponsorshipLog,
              }),
            buildClient: createSponsoredClient(executionKernel, sponsorship),
            sendSponsored: (client) => submit(client),
            sendOwnGas: () => submit(executionKernel.client),
            ownGasClient: executionKernel.client,
            waitFor: ({ client, userOpHash: hash }) => waitForInclusion(client, hash),
            // A fee the bundler refused is the operation's, not the paymaster's: `submit` has
            // already answered it with ZeroDev's own quote, so an own-gas submission here
            // would be a third operation over a fee the account cannot change.
            isOperationFailure: isFluentFeeRejection,
            disableSponsorship: () => {
              sponsorshipUnavailable.current = true;
            },
            log: sponsorshipLog,
          });
          ({ userOpHash, receipt, settlementClient, sponsorshipReason } = outcome);
          sponsoredSend = outcome.sponsored;
        } else {
          // Sponsorship was configured for this network but was not attempted — say which,
          // otherwise the case this reporting exists for is indistinguishable from an
          // ERC-20 send.
          if (sponsorshipRefused) sponsorshipReason = "not_requested";
          else if (!gasToken && sponsorship && sponsorshipUnavailable.current) {
            sponsorshipReason = "unauthorized";
          }
          userOpHash = await submit(executionClient);
          debugLog("[fluent zerodev] sendCalls userOp submitted", { userOpHash });
          receipt = await waitForInclusion(settlementClient, userOpHash);
        }
        // Who actually paid, read off the settled operation rather than off which client
        // we chose to send with. A refusal in the sponsorship proxy is a flat 403 and the
        // account then quietly pays its own gas, so "sponsored" and "silently not
        // sponsored" are the same picture from the send side.
        const paymaster = readUserOperationPaymaster(receipt);
        const sponsored = gasToken
          ? false
          : paymaster
            ? paymaster !== zeroAddress
            : sponsoredSend;
        if (!gasToken && sponsoredSend && !sponsored) sponsorshipReason ??= "denied";
        debugLog("[fluent zerodev] sendCalls receipt", {
          userOpHash,
          success: receipt.success,
          reason: receipt.reason,
          transactionHash: receipt.receipt.transactionHash,
          sponsored,
          paymaster,
          sponsorshipReason,
        });
        // Closed before the revert check, not after: a UserOperation that reverted still took
        // its four seconds somewhere, and that is the breakdown worth having.
        const timing =
          receivedAt === undefined || receivedAtEpochMs === undefined
            ? // Only an unreadable clock gets here. Standing in a fresh instant would be worse
              // than an absent timeline: the stages would still look measured.
              undefined
            : await closeSendTiming({
                attempts: submissions,
                settledUserOpHash: userOpHash,
                receivedAt,
                receivedAtEpochMs,
                blockNumber: receipt.receipt.blockNumber,
                // The widget chain's own public client, the same transport `publicClient` was
                // built with. Reached only after `receivedAt` was taken, so it inflates no stage.
                getBlock: ({ blockNumber }) =>
                  executionKernel.publicClient.getBlock({ blockNumber }),
              });
        timingLog("[fluent execution timing]", {
          setupMs: span(startedAt, submissionStartedAt),
          // The whole call including kernel and authentication setup, which `timing.totalMs`
          // deliberately excludes — the two are different spans and say so.
          elapsedMs: span(startedAt, monotonicNow()),
          timing,
          userOpHash,
          hash: receipt.receipt.transactionHash,
        });
        if (!receipt.success) {
          throw new Error(receipt.reason ?? `UserOperation ${userOpHash} execution failed`);
        }
        return {
          hash: receipt.receipt.transactionHash,
          receipt: receipt.receipt,
          userOpHash,
          sponsored,
          sponsorshipReason,
          paymaster,
          timing,
        };
      } catch (err) {
        debugError("[fluent zerodev] sendCalls failed", err);
        throw err;
      } finally {
        clearPromptSigningContext();
      }
    },
    [
      authenticated,
      createSponsoredClient,
      embeddedWallet,
      error,
      hookOptions.authorizationSession,
      hookOptions.appId,
      hookOptions.sponsorshipTokenSource,
      hookOptions.sponsorshipUrl,
      initialize,
      kernels,
      network,
      readExecution,
      ready,
    ],
  );

  const ensureExecutionReady = useCallback(async (
    options: { confirmation?: "always" | "session" } = {},
  ) => {
    const signerMode = confirmationToSignerMode(options.confirmation ?? "always");
    if (kernels[signerMode]) return kernels[signerMode];
    if (!ready) throw new Error("Privy wallet context is still loading");
    if (!authenticated) {
      login();
      throw new Error("Complete wallet login, then submit the transaction again");
    }
    const executionKernel = await initialize({ signerMode, throwOnError: true });
    if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
    return executionKernel;
  }, [authenticated, error, initialize, kernels, login, ready]);

  return {
    smartAccountEnabled: Boolean(FLUENT_CONNECT_ZERODEV_PROJECT_ID),
    smartAccountReady,
    smartAccountAddress: activeKernel?.smartAccountAddress,
    signerAddress: embeddedWallet?.address as Address | undefined ??
      hookOptions.sessionSignerAddress,
    privyReady: ready,
    privyAuthenticated: authenticated,
    embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
    authenticate: login,
    kernel: activeKernel,
    signerModesReady: Object.keys(kernels) as FluentZeroDevSignerMode[],
    error,
    ensureExecutionReady,
    sendTransaction,
    sendCalls,
    refresh: () => initialize({ throwOnError: true, signerMode: "prompt" }),
  };
}

/** The widget's gated console, in the shape `core/sponsoredClient` takes it in. */
const sponsorshipLog = {
  debug: (message: string, detail: Record<string, unknown>) => debugLog(message, detail),
  warn: (message: string, detail: Record<string, unknown>) => debugWarn(message, detail),
};

/** `UserOperationEvent` — the EntryPoint's own record of who paid. Same signature in 0.6 and 0.7. */
const USER_OPERATION_EVENT_TOPIC = toEventSelector(
  parseAbiItem(
    "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  ),
).toLowerCase();

/**
 * Which contract the EntryPoint charged for this operation, the zero address when the
 * account paid itself. Bundlers are not obliged to fill the receipt's `paymaster` field,
 * so fall back to the event, whose third indexed topic is the paymaster. Undefined when
 * neither is present — an admitted unknown, so the caller does not report a guess as fact.
 */
function readUserOperationPaymaster(
  receipt: Awaited<ReturnType<KernelClient["waitForUserOperationReceipt"]>>,
): Address | undefined {
  if (receipt.paymaster) return getAddress(receipt.paymaster);
  const event = receipt.logs.find(
    (log) =>
      log.topics[0]?.toLowerCase() === USER_OPERATION_EVENT_TOPIC &&
      log.topics[1]?.toLowerCase() === receipt.userOpHash.toLowerCase(),
  );
  const topic = event?.topics[3];
  // 32 bytes, of which the address is the low 20 — anything else is not this event.
  if (!topic || topic.length !== 66) return undefined;
  return getAddress(`0x${topic.slice(26)}`);
}

function getZeroDevReadinessMessage(params: {
  ready: boolean;
  authenticated: boolean;
  embeddedWalletCount: number;
  walletCount: number;
}) {
  if (!params.ready) return "Privy wallet context is still loading";
  if (!params.authenticated) return "Fluent session is connected, but Privy embedded wallet is not authenticated on this page";
  if (params.embeddedWalletCount === 0) {
    return `Privy is authenticated, but no embedded wallet is available (${params.walletCount} linked wallets found)`;
  }
  return "Fluent ZeroDev account is still preparing. Try again in a moment.";
}

export async function createFluentZeroDevPermissionSession(params: {
  kernel: FluentZeroDevKernel;
  sessionPrivateKey: Hex;
  calls: readonly FluentZeroDevPermissionCall[];
  expiresAt?: number;
}): Promise<FluentZeroDevPermissionSession> {
  const sessionAccount = privateKeyToAccount(params.sessionPrivateKey);
  const signer = await toECDSASigner({ signer: sessionAccount });
  const policies = [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_5,
      permissions: params.calls.map((call) =>
        call.abi && call.functionName
          ? {
              target: call.target,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args,
              callType: call.callType,
              valueLimit: call.valueLimit ?? 0n,
            }
          : {
              target: call.target,
              selector: call.selector,
              callType: call.callType,
              valueLimit: call.valueLimit ?? 0n,
            },
      ) as Parameters<typeof toCallPolicy>[0]["permissions"],
    }),
  ];

  /// 2. Add a ZeroDev timestamp policy when the builder asks for an expiring
  /// session. The call policy still enforces target, selector, and arg bounds.
  if (params.expiresAt) {
    policies.push(toTimestampPolicy({ validUntil: params.expiresAt }));
  }

  const permissionPlugin = await toPermissionValidator(params.kernel.publicClient, {
    signer,
    policies,
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
  });

  const serializedPermissionAccount = await serializePermissionAccount(
    params.kernel.account as Parameters<typeof serializePermissionAccount>[0],
    params.sessionPrivateKey,
    undefined,
    undefined,
    permissionPlugin,
    true,
  );
  return {
    serializedPermissionAccount,
    sessionSignerAddress: sessionAccount.address,
    smartAccountAddress: params.kernel.smartAccountAddress,
  };
}

function confirmationToSignerMode(
  confirmation: "always" | "session",
): FluentZeroDevSignerMode {
  return confirmation === "session" ? "silent" : "prompt";
}

/** The paymasters the widget can hand a kernel client. Both are `getPaymasterData` adapters. */
type FluentZeroDevPaymaster =
  | ReturnType<typeof createFluentZeroDevSponsoredPaymaster>
  | ReturnType<typeof createFluentZeroDevErc20Paymaster>;

/**
 * Every kernel client the widget sends a user operation through is built here.
 *
 * One constructor, because of one argument: `userOperation.estimateFeesPerGas`. A kernel client
 * built without it inherits ZeroDev's default, which asks the bundler
 * `zd_getUserOperationGasPrice` on every send (`@zerodev/sdk@5.5.10`
 * `_esm/clients/kernelAccountClient.js:38-43`) — about 590 ms against about 70 ms for the
 * chain's own `eth_gasPrice`. Four clients reach a submission: the Privy-signed kernel, the
 * session kernel, the sponsored client and the ERC-20 gas client. A fifth, the one
 * `core/zerodevPaymaster.ts`'s `sendFluentZeroDevErc20PaymasterDemo` builds for itself, does
 * not: the widget never sends through it, and it keeps ZeroDev's own quote (FLU-1591 Boundary).
 * A new client the widget does send through belongs here, or it quietly pays that round trip.
 */
function createFluentZeroDevKernelClient(params: {
  kernel: Pick<FluentZeroDevKernel, "account" | "chain" | "publicClient" | "zeroDevRpcUrl">;
  readExecution: FluentZeroDevExecutionReader;
  paymaster?: FluentZeroDevPaymaster;
}): KernelClient {
  const { kernel, readExecution, paymaster } = params;
  return createKernelAccountClient({
    account: kernel.account,
    chain: kernel.chain,
    bundlerTransport: createFluentBundlerTransport(kernel.zeroDevRpcUrl),
    client: kernel.publicClient,
    ...(paymaster ? { paymaster } : {}),
    userOperation: {
      estimateFeesPerGas: createFluentUserOperationFeeHook({
        // The widget chain's own public client, so the quote and the account's reads travel
        // the same transport and its retry policy.
        readGasPrice: () => kernel.publicClient.getGasPrice(),
        readFeeSource: () => readExecution().feeSource,
      }),
    },
  });
}

async function createFluentZeroDevAuthorizedSessionKernel(
  authorizationSession: {
    serializedPermissionAccount: string;
    sessionPrivateKey: Hex;
  },
  chain: Chain,
  readExecution: FluentZeroDevExecutionReader,
): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) {
    throw new Error("Fluent ZeroDev project is not configured");
  }
  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${FLUENT_CONNECT_ZERODEV_PROJECT_ID}/chain/${chain.id}`;
  const publicClient = createPublicClient({
    chain,
    transport: createFluentRpcTransport(chain),
  });
  const entryPoint = getEntryPoint("0.7");
  const sessionSigner = await toECDSASigner({
    signer: privateKeyToAccount(authorizationSession.sessionPrivateKey),
  });
  const account = await deserializePermissionAccount(
    publicClient as Parameters<typeof deserializePermissionAccount>[0],
    entryPoint,
    KERNEL_V3_3,
    authorizationSession.serializedPermissionAccount,
    sessionSigner,
  );
  const client = createFluentZeroDevKernelClient({
    kernel: { account, chain, publicClient, zeroDevRpcUrl },
    readExecution,
  });

  return {
    account,
    client,
    publicClient,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
    chain,
    signerMode: "silent",
    signerSource: "session",
  };
}

async function createFluentZeroDevKernel(params: {
  wallet?: PrivyEthereumWallet;
  signerMode: FluentZeroDevSignerMode;
  promptedSigners: FluentZeroDevPromptedSigners;
  chain: Chain;
  readExecution: FluentZeroDevExecutionReader;
}): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) throw new Error("Fluent ZeroDev project is not configured");
  if (!params.wallet) throw new Error("Fluent signer is unavailable");

  // Once per kernel, whatever `execution.chainCheckBeforeSign` says: this is the one moment the
  // Signer's chain has not been established yet, and the smart account is derived from it.
  debugLog("[fluent zerodev] ensuring Fluent chain", params.chain.id);
  await ensureWalletOnFluentChain(params.wallet, params.chain);
  debugLog("[fluent zerodev] Fluent chain ready", params.chain.id);

  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${FLUENT_CONNECT_ZERODEV_PROJECT_ID}/chain/${params.chain.id}`;
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: createFluentRpcTransport(params.chain),
  });
  const entryPoint = getEntryPoint("0.7");

  /// ZeroDev smart-account derivation starts here: the Privy embedded wallet is
  /// wrapped as a local ECDSA signer, then used as the sudo validator for a
  /// Kernel account. `account.address` below is the deterministic ZeroDev
  /// smart account controlled by the embedded Fluent ID wallet.
  const signer =
    params.signerMode === "prompt"
      ? toPromptedPrivyLocalAccount(params.wallet, params.promptedSigners)
      : toSilentPrivyLocalAccount(params.wallet);
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  const derivedAccount = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_3,
  });
  // Every holder of this kernel — the client below, `sendCalls`, and the widget's own
  // `signMessage` and `signTypedData` — gets the account that knows how to read the Signer's
  // chain, so `execution.chainCheckBeforeSign` is answered wherever a signature is asked for.
  const account = toFluentSigningAccount({
    account: derivedAccount,
    wallet: params.wallet,
    chain: params.chain,
    readExecution: params.readExecution,
  });
  const client = createFluentZeroDevKernelClient({
    kernel: { account, chain: params.chain, publicClient, zeroDevRpcUrl },
    readExecution: params.readExecution,
  });

  return {
    account,
    client,
    publicClient,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
    chain: params.chain,
    signerMode: params.signerMode,
    signerSource: "privy",
  };
}

function createFluentZeroDevErc20ExecutionClient(
  kernel: FluentZeroDevKernel,
  gasToken: Address,
  readExecution: FluentZeroDevExecutionReader,
) {
  return createFluentZeroDevKernelClient({
    kernel,
    readExecution,
    paymaster: createFluentZeroDevErc20Paymaster({
      chain: kernel.chain,
      gasToken,
    }),
  });
}

type FluentPromptSigningContext = {
  intent?: "transaction" | "signature";
  gasTokenSymbol?: string;
};

let promptSigningContext: FluentPromptSigningContext = {};

function setPromptSigningContext(context: FluentPromptSigningContext) {
  promptSigningContext = context;
}

function clearPromptSigningContext() {
  promptSigningContext = {};
}

/**
 * Runs `sign` with the Privy prompt worded for a plain signature rather than a
 * UserOperation. The prompt kernel's signer reads a module-level context because
 * the signer is built once per mode, while the wording is per call.
 */
export async function withFluentSignaturePrompt<T>(sign: () => Promise<T>): Promise<T> {
  setPromptSigningContext({ intent: "signature" });
  try {
    return await sign();
  } finally {
    clearPromptSigningContext();
  }
}

/**
 * `showWalletUIs` is named here rather than left to the `PrivyProvider` config.
 *
 * Privy resolves that config once per mount and ignores later changes to it, so
 * asking for the confirmation screen through it meant rebuilding Privy — and
 * with it the account, the settings in flight and the wallet connection — every
 * time a person touched Quick sign. Per call it wins over the config outright,
 * which is what lets the provider stay up. The silent signer is the other half:
 * it signs through the embedded provider, which passes no `uiOptions`, and so
 * lands on the config's constant `false`.
 */
function buildPromptSigningUiOptions() {
  if (promptSigningContext.intent === "signature") {
    return {
      showWalletUIs: true,
      title: "Sign with Fluent",
      description: "Sign this request with your Fluent account. Nothing is sent on chain.",
      buttonText: "Sign",
    };
  }
  const gasTokenSymbol = promptSigningContext.gasTokenSymbol;
  return {
    showWalletUIs: true,
    title: "Confirm Fluent transaction",
    description: gasTokenSymbol
      ? `Gas will be paid in ${gasTokenSymbol}. Confirm this Fluent transaction.`
      : "Confirm this Fluent transaction.",
    buttonText: "Sign",
  };
}

/**
 * The Signer adapter the prompting kernel signs through.
 *
 * It asks the provider for the signature and for nothing else. The chain check the host can turn
 * back on with `execution.chainCheckBeforeSign` is not here but on the account
 * (`withFluentSignerChainCheck`), because an adapter is called with a message and cannot tell
 * which operation is asking — and the three that can ask need three different answers.
 *
 * Off by default, and nothing is lost by it: the widget gives Privy its own chain as the only
 * chain it supports (`core/config.ts`, `defaultChain` and `supportedChains`), the kernel
 * already checks once when it is created, and neither `personal_sign` nor
 * `eth_signTypedData_v4` carries a value read from the provider's `eth_chainId` (FLU-1591, Q4).
 */
function toPromptedPrivyLocalAccount(
  wallet: PrivyEthereumWallet,
  promptedSigners: FluentZeroDevPromptedSigners,
) {
  const source = {
    address: wallet.address as Address,
    async signMessage({ message }: { message: SignableMessage }) {
      const { signature } = await promptedSigners.signMessage(
        { message: formatSignableMessageForPrivy(message) },
        {
          address: wallet.address,
          uiOptions: buildPromptSigningUiOptions(),
        },
      );
      return signature as Hex;
    },
    async signTransaction() {
      throw new Error("Fluent ZeroDev signer does not sign raw transactions");
    },
    async signTypedData<
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(typedData: TypedDataDefinition<typedData, primaryType>) {
      const { signature } = await promptedSigners.signTypedData(
        {
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        } as unknown as SignTypedDataParams,
        {
          address: wallet.address,
          uiOptions: buildPromptSigningUiOptions(),
        },
      );
      return signature as Hex;
    },
  } satisfies CustomSource;

  return toAccount(source);
}

/** The Signer adapter the silent kernel signs through. See `toPromptedPrivyLocalAccount`. */
function toSilentPrivyLocalAccount(wallet: PrivyEthereumWallet) {
  const source = {
    address: wallet.address as Address,
    async signMessage({ message }: { message: SignableMessage }) {
      debugLog("[fluent zerodev] requesting embedded provider signature", {
        signerAddress: wallet.address,
        messageKind: typeof message === "string" ? "string" : "raw" in message ? "raw" : typeof message,
      });
      const provider = (await wallet.getEthereumProvider()) as Eip1193Provider | undefined;
      if (!provider?.request) throw new Error("Fluent embedded wallet provider is unavailable");
      const formattedMessage = formatSignableMessageForPrivy(message);
      try {
        const signature = await provider.request({
          method: "personal_sign",
          params: [isHex(formattedMessage) ? formattedMessage : stringToHex(formattedMessage), wallet.address],
        });
        if (typeof signature !== "string") throw new Error("Privy embedded wallet returned an invalid signature");
        debugLog("[fluent zerodev] embedded provider signature ready", {
          signerAddress: wallet.address,
          signatureLength: signature.length,
        });
        return signature as Hex;
      } catch (err) {
        debugError("[fluent zerodev] embedded provider signature failed", err);
        throw err;
      }
    },
    async signTransaction() {
      throw new Error("Fluent ZeroDev signer does not sign raw transactions");
    },
    async signTypedData<
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(typedData: TypedDataDefinition<typedData, primaryType>) {
      debugLog("[fluent zerodev] requesting embedded provider typed-data signature", {
        signerAddress: wallet.address,
        primaryType: typedData.primaryType,
      });
      const provider = (await wallet.getEthereumProvider()) as Eip1193Provider | undefined;
      if (!provider?.request) throw new Error("Fluent embedded wallet provider is unavailable");

      try {
        const signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [
            wallet.address,
            stringifyTypedDataForProvider({
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
            }),
          ],
        });
        if (typeof signature !== "string") {
          throw new Error("Privy embedded wallet returned an invalid typed-data signature");
        }
        debugLog("[fluent zerodev] embedded provider typed-data signature ready", {
          signerAddress: wallet.address,
          signatureLength: signature.length,
        });
        return signature as Hex;
      } catch (err) {
        debugError("[fluent zerodev] embedded provider typed-data signature failed", err);
        throw err;
      }
    },
  } satisfies CustomSource;

  return toAccount(source);
}

function stringifyTypedDataForProvider(value: unknown) {
  return stringifyWithBigInt(value);
}

function formatSignableMessageForPrivy(message: SignableMessage): string {
  if (typeof message === "string") return message;
  if ("raw" in message) return typeof message.raw === "string" ? message.raw : bytesToHex(message.raw);
  return String(message);
}

async function ensureWalletOnFluentChain(wallet: PrivyEthereumWallet, chain: Chain) {
  const targetChainId = numberToHex(chain.id);
  const provider = (await wallet.getEthereumProvider()) as Eip1193Provider | undefined;

  // Read the live provider each time: a cached chain can change between signs.
  if (provider?.request && await getProviderChainId(provider) === targetChainId) return;

  if (wallet.switchChain) {
    debugLog("[fluent zerodev] wallet.switchChain", chain.id);
    await wallet.switchChain(chain.id);
  }

  if (provider?.request) {
    const currentChainId = await getProviderChainId(provider);
    debugLog("[fluent zerodev] provider chain", currentChainId);
    if (currentChainId === targetChainId) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
    } catch (err) {
      if (!isUnknownChainError(err)) throw err;

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: targetChainId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers?.default.url
              ? [chain.blockExplorers.default.url]
              : undefined,
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
    }

    const nextChainId = await getProviderChainId(provider);
    debugLog("[fluent zerodev] provider chain after switch", nextChainId);
    if (nextChainId !== targetChainId) {
      throw new Error(`Unsupported chainId ${Number(BigInt(nextChainId))}; switch to ${chain.name}`);
    }
    return;
  }

  throw new Error("Fluent embedded wallet provider is unavailable");
}

async function getProviderChainId(provider: Eip1193Provider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string") throw new Error("Unable to read embedded wallet chainId");
  return chainId.toLowerCase() as Hex;
}

function isUnknownChainError(err: unknown) {
  const code = (err as { code?: number; data?: { originalError?: { code?: number } } })?.code;
  const nestedCode = (err as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
  return code === 4902 || nestedCode === 4902;
}
