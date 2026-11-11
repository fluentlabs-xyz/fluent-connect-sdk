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
  erc20Abi,
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
  getFluentZeroDevProjectId,
  type ResolvedFluentWidgetExecution,
} from "../core/config";
import { getFluentWidgetNetworkForChainId, type FluentWidgetNetwork } from "../core/network";
import {
  normalizeSigningMode,
  type FluentAccountType,
  type FluentBatchOperationExecuteOptions,
  type FluentExecuteTiming,
  type FluentSigningMode,
} from "./batchOperation";
import type { FluentSponsorshipReason } from "../core/sponsorshipFailure";
import {
  buildSponsoredClient,
  resolveSponsorshipBearer,
  sendWithSponsorship,
  type SponsorshipTokenRequest,
} from "../core/sponsoredClient";

export type { FluentSponsorshipReason } from "../core/sponsorshipFailure";
// The call type a permission session's call policy names; for code that builds one beside the
// widget (the chess demo's bot), which reaches this module by an internal path.
export { CallType };
// Some functions below are exported only for this module's tests, which import them rather than
// render the hook. The package's public API is what `src/index.ts` names, and none of them is
// there.

import {
  createFluentErc20ApproveCall,
  createFluentZeroDevErc20Paymaster,
  createFluentZeroDevSponsoredPaymaster,
  readFluentZeroDevErc20PaymasterAddress,
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
import { getFluentGasTokenAddress, getFluentGasTokenApproval } from "../core/gasPayment";
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
 * Where a sponsored operation gets its bearer: the Auth token for the connected account, and
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
 */
type FluentZeroDevExecutionReader = () => ResolvedFluentWidgetExecution;

/**
 * A check of the Signer's chain, as the kernel holding the Signer runs it: one `eth_chainId` on
 * the Signer's provider, and a switch when it answers another chain. A function rather than the
 * wallet, so an operation needs only the account it signs with to check the chain.
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

/** Returns a copy of `account` carrying its Signer's chain check. */
function carryFluentSignerChainCheck<account extends object>(
  account: account,
  check: FluentSignerChainCheck,
): account {
  return { ...account, [FLUENT_SIGNER_CHAIN_CHECK]: check };
}

/**
 * Returns the Signer chain check `account` carries, or `undefined`.
 *
 * `undefined` is the authorized-session kernel: its signer is a local key, with no wallet to
 * ask and no chain to be on, so an operation on it makes no chain request.
 */
export function readFluentSignerChainCheck(account: unknown): FluentSignerChainCheck | undefined {
  if (typeof account !== "object" || account === null) return undefined;
  const check = (account as Record<symbol, unknown>)[FLUENT_SIGNER_CHAIN_CHECK];
  return typeof check === "function" ? (check as FluentSignerChainCheck) : undefined;
}

/**
 * Returns a copy of `account` that awaits `before` ahead of each of `signatures`.
 *
 * This is where `execution.chainCheckBeforeSign` is obeyed. Not in the Signer adapter: it is
 * built once per kernel and called with a message alone, while a send keeping the setting it
 * started with, a standalone signature reading the live one, and a later send under a changed
 * setting all reach it. Each of them holds its own copy of the account, so the check sits there.
 * A send signs through `signUserOperation`; `widget.signMessage` and `widget.signTypedData`
 * through the methods of their names.
 */
export function withFluentSignerChainCheck<account extends object>(
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
 * Returns the kernel's account as the widget holds it: the Signer's chain read before a
 * standalone signature when the host asks for it, and the check itself carried for a send.
 *
 * The live setting is read at the signature, so a host that turns the check on is obeyed by the
 * next standalone signature. A send does not go through these two methods: it pins the setting
 * it read at its start and installs its own check on `signUserOperation` (`sendCalls`).
 */
export function toFluentSigningAccount(params: {
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
  /** The Auth token a sponsored operation authenticates with. Without it nothing is sponsored. */
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
  /** Replaces Privy's `login` when a kernel needs a login; the widget passes its own. */
  login?: () => void;
} = {}) {
  const { chain, network } = useFluentWidgetNetwork();
  const zeroDevProjectId = getFluentZeroDevProjectId(network);
  // No `getAccessToken`: the sponsorship paymaster is authenticated with the Auth token from
  // `getAuthToken()`, and the kernel signs through the Signer, not through a token.
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
  // Set on a 403 only, so an unregistered App stops paying a failed round trip per operation. A
  // policy denial is per operation, a 502 transient, and a 401 a refused Auth token, which one
  // fresh token and one retry answer.
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
      hasEmbeddedWallet: Boolean(embeddedWallet),
      hasKernel: Boolean(cachedKernel),
      cachedSignerModes: Object.keys(kernels),
      initInFlight: Boolean(initPromise.current[signerMode]),
      throwOnError: Boolean(options.throwOnError),
      hasProjectId: Boolean(zeroDevProjectId),
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
    if (!zeroDevProjectId) {
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
        hasEmbeddedWallet: Boolean(embeddedWallet),
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
    zeroDevProjectId,
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

  const createSponsoredClient = useCallback(
    (kernel: FluentZeroDevKernel, sponsorship: { sponsorshipUrl: string; appId: string }) =>
      createFluentZeroDevSponsoredClient(kernel, sponsorship, readExecution),
    [readExecution],
  );

  const boundSendCalls = useCallback(
    (
      calls: FluentZeroDevCall[],
      options?: FluentBatchOperationExecuteOptions,
      readyAccount?: unknown,
    ) =>
      sendCalls(
        {
          kernels,
          initialize,
          error,
          network,
          readExecution,
          appId: hookOptions.appId,
          sponsorshipUrl: hookOptions.sponsorshipUrl,
          sponsorshipTokenSource: hookOptions.sponsorshipTokenSource,
          sponsorshipUnavailable,
          createSponsoredClient,
        },
        calls,
        options,
        readyAccount,
      ),
    [
      createSponsoredClient,
      error,
      hookOptions.appId,
      hookOptions.sponsorshipTokenSource,
      hookOptions.sponsorshipUrl,
      initialize,
      kernels,
      network,
      readExecution,
    ],
  );

  const boundEnsureExecutionReady = useCallback(
    (options: { confirmation?: FluentSigningMode } = {}) =>
      ensureExecutionReady({ kernels, ready, authenticated, login, initialize, error }, options),
    [authenticated, error, initialize, kernels, login, ready],
  );

  return {
    smartAccountEnabled: Boolean(zeroDevProjectId),
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
    ensureExecutionReady: boundEnsureExecutionReady,
    sendTransaction,
    sendCalls: boundSendCalls,
    refresh: () => initialize({ throwOnError: true, signerMode: "prompt" }),
  };
}

/**
 * How `useFluentZeroDevAccount` builds a kernel for a signer mode, as a send or a readiness
 * check calls it: `null` or `undefined` when it built none without throwing.
 */
type FluentZeroDevInitialize = (options: {
  throwOnError?: boolean;
  signerMode?: FluentZeroDevSignerMode;
}) => Promise<FluentZeroDevKernel | null | undefined>;

/**
 * What a send reads off the `useFluentZeroDevAccount` render that started it.
 *
 * The send is a module function rather than a callback inside the hook, so that its tests can
 * import it instead of rendering Privy, a bundler and a chain; the hook hands it these values on
 * every render. `kernels` and `error` are that render's state, which is why a kernel
 * `ensureExecutionReady` built moments ago travels to `sendCalls` as `readyAccount`.
 */
export type FluentZeroDevSendContext = {
  kernels: FluentZeroDevKernels;
  initialize: FluentZeroDevInitialize;
  error: Error | null;
  network: FluentWidgetNetwork;
  readExecution: FluentZeroDevExecutionReader;
  /** App id in the sponsorship path. Sponsorship is off unless both this and the URL are set. */
  appId?: string;
  sponsorshipUrl?: string;
  /** The Auth token a sponsored operation authenticates with. Without it nothing is sponsored. */
  sponsorshipTokenSource?: () => FluentZeroDevSponsorshipTokenSource | null;
  /** Set on a 403, and shared by every send of one hook; see `useFluentZeroDevAccount`. */
  sponsorshipUnavailable: { current: boolean };
  /** The sponsored client for one attempt, around one Auth token. */
  createSponsoredClient: (
    kernel: FluentZeroDevKernel,
    sponsorship: { sponsorshipUrl: string; appId: string },
  ) => (bearerToken: string) => KernelClient;
};

/** What a readiness check reads off the `useFluentZeroDevAccount` render that started it. */
export type FluentZeroDevReadinessContext = {
  kernels: FluentZeroDevKernels;
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  initialize: FluentZeroDevInitialize;
  error: Error | null;
};

/**
 * Returns the paymaster approval a Gas token send starts with, or `undefined` when it needs none.
 *
 * An explicit `includeApproval: true` approves the caller's `approveAmount`, whatever the
 * allowance. Without it the approval is automatic: the account's allowance to the
 * paymaster is read, and the token's `amount` is approved when it is below `refreshBelow`
 * (`getFluentGasTokenApproval`). Without an allowance the paymaster's `postOp` cannot charge the
 * fee, and the EntryPoint rolls back the whole operation, the caller's calls with it.
 *
 * The two reads fail differently on purpose. The paymaster's address is the spender and cannot
 * be guessed, so a failed `zd_pm_accounts` rejects. An allowance that cannot be read is taken as
 * 0: `approve` sets the amount rather than adding to it, so an approval nobody needed costs only
 * its gas, and a missing one costs the operation.
 */
async function prepareFluentGasTokenApproval(params: {
  kernel: FluentZeroDevKernel;
  gasToken: Address;
  network: FluentWidgetNetwork;
  gasPayment: NonNullable<FluentBatchOperationExecuteOptions["gasPayment"]>;
}): Promise<FluentZeroDevCall | undefined> {
  const { kernel, gasToken, network, gasPayment } = params;
  const paymaster = await readFluentZeroDevErc20PaymasterAddress({ chain: kernel.chain });
  if (gasPayment.includeApproval) {
    return createFluentErc20ApproveCall({
      gasToken,
      spender: paymaster,
      amount: gasPayment.approveAmount,
    });
  }
  const automatic = getFluentGasTokenApproval(gasToken, network);
  if (!automatic) {
    debugWarn("[fluent zerodev] no automatic approval for this Gas token", { gasToken });
    return undefined;
  }
  let allowance = 0n;
  try {
    allowance = await kernel.publicClient.readContract({
      address: gasToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [kernel.smartAccountAddress, paymaster],
    });
  } catch (err) {
    debugWarn("[fluent zerodev] Gas token allowance unreadable, approving", {
      gasToken,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (allowance >= automatic.refreshBelow) return undefined;
  return createFluentErc20ApproveCall({ gasToken, spender: paymaster, amount: automatic.amount });
}

/**
 * Sends one Batch operation from a Fluent ID, from the kernel of its signing mode to the
 * included operation's receipt.
 */
export async function sendCalls(
  context: FluentZeroDevSendContext,
  calls: FluentZeroDevCall[],
  options?: FluentBatchOperationExecuteOptions,
  /**
   * A kernel `ensureExecutionReady` returned moments ago, typed `unknown` because it
   * travels through `FluentBatchOperationExecutor.sendCalls`, which knows nothing about
   * kernels. Needed because `context.kernels` is the state of the render that started this
   * send: when readiness was reached during the `await` that precedes this call, that state is
   * still empty and a second `initialize` would run — another account derivation and another
   * signer prompt for one operation.
   */
  readyAccount?: unknown,
): Promise<{
  hash: Hash;
  receipt: TransactionReceipt;
  userOpHash: Hash;
  sponsored: boolean | null;
  sponsorshipReason?: FluentSponsorshipReason;
  paymaster?: Address;
  /** Where this send's milliseconds went. Absent only when the measurement itself failed. */
  timing?: FluentExecuteTiming;
}> {
  const {
    kernels,
    initialize,
    error,
    network,
    readExecution,
    sponsorshipUnavailable,
    createSponsoredClient,
  } = context;
  /**
   * Writes one timing diagnostic line of this send, and never throws.
   *
   * Every stage line goes through it: most are written when the bundler may already hold the
   * operation, and two sit in a `finally`, so a throw (from a host's patched console, say) would
   * reject a send that was made, lose its operation hash, or replace the submission error. The
   * clocks are read through `monotonicNow`/`epochNow` and `span` for the same reason.
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
  // Read once: every attempt, signature and inclusion wait of this send answers to the same
  // settings, whatever the host changes meanwhile. The signatures, made inside `@zerodev/sdk`,
  // get them through the account below.
  const execution = readExecution();
  const signerMode = normalizeSigningMode(options?.confirmation ?? "prompt");
  // Accepted only for this send's own signer mode: a silent send must not be signed by the
  // prompting kernel, or a prompting one signed silently, however fresh the kernel is.
  const readyKernel =
    readyAccount &&
    typeof readyAccount === "object" &&
    (readyAccount as FluentZeroDevKernel).signerMode === signerMode
      ? (readyAccount as FluentZeroDevKernel)
      : undefined;
  const knownKernel = readyKernel ?? kernels[signerMode];
  const executionKernel = knownKernel ?? await initialize({ signerMode, throwOnError: true });
  if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
  const gasToken = options?.gasPayment?.symbol
    ? getFluentGasTokenAddress(options.gasPayment.symbol, network)
    : undefined;
  // Before anything is signed: a paymaster ZeroDev cannot name rejects the send here, while no
  // signature has been asked for.
  const approval = gasToken && options?.gasPayment
    ? await prepareFluentGasTokenApproval({
        kernel: executionKernel,
        gasToken,
        network,
        gasPayment: options.gasPayment,
      })
    : undefined;
  const preparedCalls = approval ? [approval, ...calls] : [...calls];
  debugLog("[fluent zerodev] sendCalls", {
    signerMode,
    smartAccountAddress: executionKernel.smartAccountAddress,
    gasToken,
    gasTokenSymbol: options?.gasPayment?.symbol,
    sponsorship: options?.gasPayment?.sponsorship ?? "auto",
    approvalIncluded: Boolean(approval),
    calls: preparedCalls.map((call) => ({
      to: call.to,
      hasData: Boolean(call.data && call.data !== "0x"),
      value: (call.value ?? 0n).toString(),
    })),
  });
  /**
   * The account this send signs with: its own copy, carrying the `chainCheckBeforeSign` it read
   * at its start, so both submissions of a fee retry sign under that one reading and no other
   * operation sees it (`withFluentSignerChainCheck`). Passed on as it came when the check is off
   * or the kernel has no Signer chain to read.
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
    // Every submission of this send in order, failed ones included: a refused Auth token is
    // retried, a refused Sponsorship falls back to own gas. Only the attempt whose hash comes
    // back owns the stages; the others count as retry overhead.
    const submissions: FluentUserOperationAttempt[] = [];
    const submitOnce = async (client: KernelClient, feeAttempt: FluentFeeAttempt) => {
      // The one submission point, so every attempt is both governed by the caller's gas policy
      // and counted towards the retry overhead.
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
     * Whether this send has spent its one fee retry. The budget is the send's, not the quote's:
     * a fresh quote is worth one attempt whichever source gave the refused one, and a third
     * submission is not.
     */
    let feeRetrySpent = false;
    /**
     * Submits one operation, and retries once when the bundler refused this send's fee quote:
     * with the bundler's own quote, prepared and signed again. A second refusal reaches the
     * caller unchanged, and nothing is latched, so the next send asks the chain first again.
     *
     * Only this refusal is retried here. A policy denial, a refused Auth token or a reverted
     * estimate belongs to the caller or to the sponsorship path, which has its own single retry.
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
      // Guarded: the bundler already holds the operation, so a throw here would reject a send
      // that was made and lose `hash`, the caller's only name for it.
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
        // `waitMs` is this client's whole wait: bundling, block time and polling together,
        // which the result's stages separate. Guarded: the receipt may already be in hand.
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
    // Checked before anything is built, so no Auth token is fetched for a paymaster the caller
    // refused. `!gasToken`: `sponsorship` is ignored for a Gas token, whose own paymaster pays.
    const sponsorshipRefused = !gasToken && options?.gasPayment?.sponsorship === "never";
    const sponsorship =
      context.sponsorshipUrl && context.appId
        ? { sponsorshipUrl: context.sponsorshipUrl, appId: context.appId }
        : null;
    const executionClient = gasToken
      ? createFluentZeroDevErc20ExecutionClient(
          executionKernel,
          gasToken,
          readExecution,
          options?.gasPayment?.symbol,
        )
      : executionKernel.client;
    const callSponsored =
      !gasToken && !sponsorshipRefused && sponsorship && !sponsorshipUnavailable.current;

    // Before the first broadcast, and awaited: `fromBlock` has to name a block this operation
    // cannot already be in, and after the broadcast no such block is left to name.
    if (execution.receiptSource === "chain") {
      inclusionAnchor = await readFluentInclusionAnchor(executionKernel.publicClient);
    }

    let sponsorshipReason: FluentSponsorshipReason | undefined;
    let settlementClient: KernelClient = executionClient;
    let userOpHash: Hash;
    let receipt: KernelUserOperationReceipt;
    let sponsoredSend = false;
    if (callSponsored) {
      const tokenSource = context.sponsorshipTokenSource?.() ?? null;
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
      // Sponsorship is configured but was not attempted: say why, so the case is not mistaken
      // for a Gas token send.
      if (sponsorshipRefused) sponsorshipReason = "not_requested";
      else if (!gasToken && sponsorship && sponsorshipUnavailable.current) {
        sponsorshipReason = "unauthorized";
      }
      userOpHash = await submit(executionClient);
      debugLog("[fluent zerodev] sendCalls userOp submitted", { userOpHash });
      receipt = await waitForInclusion(settlementClient, userOpHash);
    }
    // Who paid is read off the settled operation: after a sponsored submission the account may
    // have paid its own gas. With no paymaster on the receipt, an operation never sent sponsored
    // is `false`, and one that was is `null`, unknown.
    const paymaster = readUserOperationPaymaster(receipt);
    const sponsored = gasToken
      ? false
      : paymaster
        ? paymaster !== zeroAddress
        : sponsoredSend
          ? null
          : false;
    if (!gasToken && sponsoredSend && sponsored === false) sponsorshipReason ??= "denied";
    debugLog("[fluent zerodev] sendCalls receipt", {
      userOpHash,
      success: receipt.success,
      reason: receipt.reason,
      transactionHash: receipt.receipt.transactionHash,
      sponsored,
      paymaster,
      sponsorshipReason,
    });
    // Closed before the revert check: a reverted operation's time breakdown is still reported.
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
  }
}

/**
 * Returns the kernel a send in `options.confirmation`'s signing mode signs with, building it
 * when this render has none. Throws an `Error` while Privy is loading, after asking for a login
 * when Privy is not authenticated, and when the kernel cannot be built.
 */
export async function ensureExecutionReady(
  context: FluentZeroDevReadinessContext,
  options: { confirmation?: FluentSigningMode } = {},
): Promise<FluentZeroDevKernel> {
  const { kernels, ready, authenticated, login, initialize, error } = context;
  const signerMode = normalizeSigningMode(options.confirmation ?? "prompt");
  if (kernels[signerMode]) return kernels[signerMode];
  if (!ready) throw new Error("Privy wallet context is still loading");
  if (!authenticated) {
    login();
    throw new Error("Complete wallet login, then submit the transaction again");
  }
  const executionKernel = await initialize({ signerMode, throwOnError: true });
  if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
  return executionKernel;
}

/** The widget's gated console, in the shape `core/sponsoredClient` takes it in. */
const sponsorshipLog = {
  debug: (message: string, detail: Record<string, unknown>) => debugLog(message, detail),
  warn: (message: string, detail: Record<string, unknown>) => debugWarn(message, detail),
};

/** The topic of `UserOperationEvent`, the EntryPoint's record of who paid, in 0.6 and 0.7 alike. */
const USER_OPERATION_EVENT_TOPIC = toEventSelector(
  parseAbiItem(
    "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  ),
).toLowerCase();

/**
 * Returns which contract the EntryPoint charged for this operation, the zero address when the
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

  // A timestamp policy only for an expiring session; the call policy bounds target, selector
  // and arguments either way.
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

/**
 * Returns a builder of the sponsored client for one attempt, around one Auth token. A new token
 * needs a new client: the bearer lives in the paymaster transport's headers.
 */
export function createFluentZeroDevSponsoredClient(
  kernel: FluentZeroDevKernel,
  sponsorship: { sponsorshipUrl: string; appId: string },
  readExecution: FluentZeroDevExecutionReader,
) {
  return (bearerToken: string): KernelClient =>
    buildSponsoredClient({
      kernel,
      bearerToken,
      sponsorshipUrl: sponsorship.sponsorshipUrl,
      appId: sponsorship.appId,
      createPaymaster: createFluentZeroDevSponsoredPaymaster,
      createClient: ({ kernel: target, paymaster }) =>
        createFluentZeroDevKernelClient({ kernel: target, readExecution, paymaster }),
    });
}

/** The paymasters the widget can hand a kernel client. Both are `getPaymasterData` adapters. */
type FluentZeroDevPaymaster =
  | ReturnType<typeof createFluentZeroDevSponsoredPaymaster>
  | ReturnType<typeof createFluentZeroDevErc20Paymaster>;

/**
 * Builds every kernel client the widget sends a user operation through, each with
 * `userOperation.estimateFeesPerGas`.
 *
 * Without it a client inherits ZeroDev's default, which asks the bundler
 * `zd_getUserOperationGasPrice` on every send (`@zerodev/sdk@5.5.10`
 * `_esm/clients/kernelAccountClient.js`), a slower round trip than the chain's `eth_gasPrice`.
 * Four clients reach a submission: the Privy-signed kernel, the session kernel, the sponsored
 * client and the Gas token client, and a new one belongs here too. The client
 * `sendFluentZeroDevErc20PaymasterDemo` in `core/zerodevPaymaster.ts` builds keeps ZeroDev's
 * quote: the widget never sends through it.
 */
export function createFluentZeroDevKernelClient(params: {
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

export async function createFluentZeroDevAuthorizedSessionKernel(
  authorizationSession: {
    serializedPermissionAccount: string;
    sessionPrivateKey: Hex;
  },
  chain: Chain,
  readExecution: FluentZeroDevExecutionReader,
): Promise<FluentZeroDevKernel> {
  const projectId = getFluentZeroDevProjectId(getFluentWidgetNetworkForChainId(chain.id));
  if (!projectId) {
    throw new Error("Fluent ZeroDev project is not configured");
  }
  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${projectId}/chain/${chain.id}`;
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

export async function createFluentZeroDevKernel(params: {
  wallet?: PrivyEthereumWallet;
  signerMode: FluentZeroDevSignerMode;
  promptedSigners: FluentZeroDevPromptedSigners;
  chain: Chain;
  readExecution: FluentZeroDevExecutionReader;
}): Promise<FluentZeroDevKernel> {
  const projectId = getFluentZeroDevProjectId(getFluentWidgetNetworkForChainId(params.chain.id));
  if (!projectId) throw new Error("Fluent ZeroDev project is not configured");
  if (!params.wallet) throw new Error("Fluent signer is unavailable");

  // Once per kernel, whatever `execution.chainCheckBeforeSign` says: this is the one moment the
  // Signer's chain has not been established yet, and the smart account is derived from it.
  debugLog("[fluent zerodev] ensuring Fluent chain", params.chain.id);
  await ensureWalletOnFluentChain(params.wallet, params.chain);
  debugLog("[fluent zerodev] Fluent chain ready", params.chain.id);

  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${projectId}/chain/${params.chain.id}`;
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: createFluentRpcTransport(params.chain),
  });
  const entryPoint = getEntryPoint("0.7");

  // The Signer, wrapped as a local ECDSA signer, is the sudo validator of a Kernel account, whose
  // address is the Fluent ID's, deterministic for that Signer.
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

/**
 * Builds the bundler client of a Gas token send. Its paymaster names the token by
 * `gasTokenSymbol` in the `FluentGasPaymentError` it rejects with when it refuses the payment.
 */
export function createFluentZeroDevErc20ExecutionClient(
  kernel: FluentZeroDevKernel,
  gasToken: Address,
  readExecution: FluentZeroDevExecutionReader,
  gasTokenSymbol?: string,
) {
  return createFluentZeroDevKernelClient({
    kernel,
    readExecution,
    paymaster: createFluentZeroDevErc20Paymaster({
      chain: kernel.chain,
      gasToken: { address: gasToken, symbol: gasTokenSymbol },
    }),
  });
}

/**
 * The Privy UI options of every Prompt mode signature: `showWalletUIs: false`, named per call
 * rather than left to the `PrivyProvider` config.
 *
 * In Prompt mode the widget's own Review is the confirmation: `createBatchOp().execute()` and
 * the sign API show it and sign only once it is confirmed. A Privy screen on top would ask the
 * same question again and show a hash where the Review showed the calls.
 */
const PROMPT_MODE_PRIVY_UI_OPTIONS = { showWalletUIs: false } as const;

/**
 * Returns the Signer adapter the prompting kernel signs through.
 *
 * It asks the provider for the signature and for nothing else. The chain check the host can turn
 * on with `execution.chainCheckBeforeSign` is not here but on the account
 * (`withFluentSignerChainCheck`), because an adapter is called with a message and cannot tell
 * which operation is asking — and the three that can ask need three different answers.
 *
 * Off by default, and nothing is lost by it: the widget gives Privy its own chain as the only
 * chain it supports (`core/config.ts`, `defaultChain` and `supportedChains`), the kernel
 * already checks once when it is created, and neither `personal_sign` nor
 * `eth_signTypedData_v4` carries a value read from the provider's `eth_chainId`.
 */
export function toPromptedPrivyLocalAccount(
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
          uiOptions: PROMPT_MODE_PRIVY_UI_OPTIONS,
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
          uiOptions: PROMPT_MODE_PRIVY_UI_OPTIONS,
        },
      );
      return signature as Hex;
    },
  } satisfies CustomSource;

  return toAccount(source);
}

/** Returns the Signer adapter the silent kernel signs through. See `toPromptedPrivyLocalAccount`. */
export function toSilentPrivyLocalAccount(wallet: PrivyEthereumWallet) {
  const source = {
    address: wallet.address as Address,
    async signMessage({ message }: { message: SignableMessage }) {
      debugLog("[fluent zerodev] requesting embedded provider signature", {
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

export async function ensureWalletOnFluentChain(wallet: PrivyEthereumWallet, chain: Chain) {
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
