import {
  usePrivy,
  useSignMessage,
  useSignTypedData,
  useWallets,
  type SignTypedDataParams,
} from "@privy-io/react-auth";
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
  http,
  isHex,
  numberToHex,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type SignableMessage,
  type TypedData,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount, toAccount, type CustomSource } from "viem/accounts";
import { fluentTestnet } from "viem/chains";

import { FLUENT_CONNECT_ZERODEV_PROJECT_ID } from "./config";
import type { FluentBatchOperationExecuteOptions } from "./batchOperation";
import {
  createFluentHostedSigner,
  type FluentHostedSigner,
} from "./hostedSigner";
import {
  createFluentZeroDevErc20Paymaster,
  createFluentZeroDevErc20PaymasterApprovalCall,
  FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS,
} from "./zerodevPaymaster";

type KernelAccount = Awaited<ReturnType<typeof createKernelAccount>>;
type KernelClient = ReturnType<typeof createKernelAccountClient>;
type PrivyEthereumWallet = {
  address: string;
  sign: (message: string) => Promise<string>;
  switchChain?: (targetChainId: number | `0x${string}`) => Promise<void>;
  getEthereumProvider: () => Promise<unknown>;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

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
  signerMode: FluentZeroDevSignerMode;
  signerSource: "privy" | "hosted" | "session";
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
  authorizeUrl?: string;
  allowHostedSigner?: boolean;
  authorizationSession?: {
    expiresAt: number;
    serializedPermissionAccount: string;
    sessionPrivateKey: Hex;
  };
  sessionSignerAddress?: Address;
  sessionSmartAccountAddress?: Address;
  /** Prefer over Privy's login when the host needs to remount Privy first. */
  login?: () => void;
} = {}) {
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

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const hostedSigner = useMemo(
    () =>
      hookOptions.allowHostedSigner !== false &&
      hookOptions.authorizeUrl &&
      hookOptions.sessionSignerAddress
        ? createFluentHostedSigner({
            address: hookOptions.sessionSignerAddress,
            authorizeUrl: hookOptions.authorizeUrl,
          })
        : null,
    [
      hookOptions.allowHostedSigner,
      hookOptions.authorizeUrl,
      hookOptions.sessionSignerAddress,
    ],
  );
  const activeKernel = kernels.prompt ?? kernels.silent ?? null;

  useEffect(() => () => hostedSigner?.close(), [hostedSigner]);

  const initialize = useCallback(async (options: {
    throwOnError?: boolean;
    signerMode?: FluentZeroDevSignerMode;
  } = {}) => {
    const signerMode = options.signerMode ?? "prompt";
    const cachedKernel = kernels[signerMode];
    console.log("[fluent zerodev] initialize requested", {
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
      console.log("[fluent zerodev] using cached kernel", {
        signerMode,
        smartAccountAddress: cachedKernel.smartAccountAddress,
      });
      return cachedKernel;
    }
    const canUseLocalSigner = ready && authenticated && Boolean(embeddedWallet);
    const canUseHostedSigner = Boolean(hostedSigner);
    const canUseAuthorizationSession =
      signerMode === "silent" &&
      Boolean(hookOptions.authorizationSession?.serializedPermissionAccount) &&
      (hookOptions.authorizationSession?.expiresAt ?? 0) > Math.floor(Date.now() / 1000);
    if (!canUseLocalSigner && !canUseHostedSigner && !canUseAuthorizationSession) {
      const nextError = new Error(getZeroDevReadinessMessage({
        ready,
        authenticated,
        embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
        walletCount: wallets.length,
        hostedSignerAvailable: canUseHostedSigner,
      }));
      console.warn("[fluent zerodev] initialize blocked", {
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
      console.log("[fluent zerodev] joining in-flight initialization");
      return initPromise.current[signerMode];
    }
    if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) {
      setKernels({});
      setSmartAccountReady(false);
      setError(null);
      console.warn("[fluent zerodev] initialize blocked: project id missing");
      return null;
    }

    setSmartAccountReady(Boolean(activeKernel));
    setError(null);

    initPromise.current[signerMode] = (async () => {
      console.log("[fluent zerodev] initializing", {
        signerMode,
        embeddedWallet: embeddedWallet?.address,
        walletClientType: embeddedWallet?.walletClientType,
        hostedSigner: hostedSigner?.address,
      });
      const nextKernel = canUseAuthorizationSession
        ? await createFluentZeroDevAuthorizedSessionKernel(
            hookOptions.authorizationSession!,
          )
        : await createFluentZeroDevKernel({
            wallet: canUseLocalSigner ? embeddedWallet as PrivyEthereumWallet : undefined,
            hostedSigner: canUseLocalSigner ? undefined : hostedSigner ?? undefined,
            signerMode,
            promptedSigners: {
              signMessage: promptSignMessage,
              signTypedData: promptSignTypedData,
            },
          });
      if (
        hookOptions.sessionSmartAccountAddress &&
        nextKernel.smartAccountAddress.toLowerCase() !==
          hookOptions.sessionSmartAccountAddress.toLowerCase()
      ) {
        throw new Error("Fluent Connect signer does not control the connected smart account");
      }
      console.log("[fluent zerodev] ready", {
        signerMode,
        signerAddress: embeddedWallet?.address ?? hostedSigner?.address,
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
      console.error("[fluent zerodev] initialization failed", nextError);
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
    hostedSigner,
    kernels,
    hookOptions.sessionSmartAccountAddress,
    hookOptions.authorizationSession,
    promptSignMessage,
    promptSignTypedData,
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
      if (
        cachedKernel?.signerSource === "hosted" ||
        (!cachedKernel && hostedSigner && !(ready && authenticated && embeddedWallet))
      ) {
        hostedSigner?.prepare("always");
      }
      const executionKernel = cachedKernel ?? await initialize({ signerMode: "prompt" });
      if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      console.log("[fluent zerodev] sendTransaction", {
        signerMode: executionKernel.signerMode,
        smartAccountAddress: executionKernel.smartAccountAddress,
        to: request.to,
        hasData: Boolean(request.data && request.data !== "0x"),
        value: (request.value ?? 0n).toString(),
      });
      try {
        const hash = await executionKernel.client.sendTransaction({
          account: executionKernel.account,
          chain: fluentTestnet,
          to: request.to,
          data: request.data ?? "0x",
          value: request.value ?? 0n,
        });
        console.log("[fluent zerodev] sendTransaction submitted", { hash });
        return hash;
      } catch (err) {
        console.error("[fluent zerodev] sendTransaction failed", err);
        throw err;
      }
    },
    [authenticated, embeddedWallet, error, hostedSigner, initialize, kernels.prompt, ready],
  );

  const sendCalls = useCallback(
    async (
      calls: FluentZeroDevCall[],
      options?: FluentBatchOperationExecuteOptions,
    ): Promise<Hash> => {
      const signerMode = confirmationToSignerMode(options?.confirmation ?? "always");
      const cachedKernel = kernels[signerMode];
      const hasAuthorizationSession =
        signerMode === "silent" &&
        Boolean(hookOptions.authorizationSession?.serializedPermissionAccount) &&
        (hookOptions.authorizationSession?.expiresAt ?? 0) > Math.floor(Date.now() / 1000);
      if (
        cachedKernel?.signerSource === "hosted" ||
        (!cachedKernel &&
          !hasAuthorizationSession &&
          hostedSigner &&
          !(ready && authenticated && embeddedWallet))
      ) {
        hostedSigner?.prepare(options?.confirmation ?? "always");
      }
      const executionKernel = cachedKernel ?? await initialize({ signerMode, throwOnError: true });
      if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      const gasToken = options?.gasPayment?.token;
      const preparedCalls = [...calls];
      if (gasToken && options?.gasPayment?.includeApproval) {
        preparedCalls.unshift(await createFluentZeroDevErc20PaymasterApprovalCall({
          gasToken,
          approveAmount: options.gasPayment.approveAmount,
        }));
      }
      console.log("[fluent zerodev] sendCalls", {
        signerMode,
        smartAccountAddress: executionKernel.smartAccountAddress,
        gasToken,
        gasTokenSymbol: options?.gasPayment?.symbol,
        approvalIncluded: Boolean(gasToken && options?.gasPayment?.includeApproval),
        calls: preparedCalls.map((call) => ({
          to: call.to,
          hasData: Boolean(call.data && call.data !== "0x"),
          value: (call.value ?? 0n).toString(),
        })),
      });
      setPromptSigningContext({
        gasTokenSymbol: resolvePromptGasTokenSymbol(options?.gasPayment),
      });
      try {
        const executionClient = gasToken
          ? createFluentZeroDevErc20ExecutionClient(executionKernel, gasToken)
          : executionKernel.client;
        const userOpHash = await executionClient.sendUserOperation({
          account: executionKernel.account,
          calls: preparedCalls.map((call) => ({
            to: call.to,
            data: call.data ?? "0x",
            value: call.value ?? 0n,
          })),
        });
        console.log("[fluent zerodev] sendCalls userOp submitted", { userOpHash });
        const receipt = await executionClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        console.log("[fluent zerodev] sendCalls receipt", {
          userOpHash,
          success: receipt.success,
          reason: receipt.reason,
          transactionHash: receipt.receipt.transactionHash,
        });
        if (!receipt.success) {
          throw new Error(receipt.reason ?? `UserOperation ${userOpHash} execution failed`);
        }
        return receipt.receipt.transactionHash;
      } catch (err) {
        console.error("[fluent zerodev] sendCalls failed", err);
        throw err;
      } finally {
        clearPromptSigningContext();
      }
    },
    [
      authenticated,
      embeddedWallet,
      error,
      hostedSigner,
      hookOptions.authorizationSession,
      initialize,
      kernels,
      ready,
    ],
  );

  const ensureExecutionReady = useCallback(async (
    options: { confirmation?: "always" | "session" } = {},
  ) => {
    const signerMode = confirmationToSignerMode(options.confirmation ?? "always");
    if (kernels[signerMode]) return kernels[signerMode];
    if (!ready) throw new Error("Privy wallet context is still loading");
    if (!authenticated && !hostedSigner) {
      login();
      throw new Error("Complete wallet login, then submit the transaction again");
    }
    const executionKernel = await initialize({ signerMode, throwOnError: true });
    if (!executionKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
    return executionKernel;
  }, [authenticated, error, hostedSigner, initialize, kernels, login, ready]);

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

function getZeroDevReadinessMessage(params: {
  ready: boolean;
  authenticated: boolean;
  embeddedWalletCount: number;
  walletCount: number;
  hostedSignerAvailable: boolean;
}) {
  if (!params.ready) return "Privy wallet context is still loading";
  if (params.hostedSignerAvailable) return "Fluent hosted signer is preparing";
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

async function createFluentZeroDevAuthorizedSessionKernel(
  authorizationSession: {
    serializedPermissionAccount: string;
    sessionPrivateKey: Hex;
  },
): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) {
    throw new Error("Fluent ZeroDev project is not configured");
  }
  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${FLUENT_CONNECT_ZERODEV_PROJECT_ID}/chain/${fluentTestnet.id}`;
  const publicClient = createPublicClient({
    chain: fluentTestnet,
    transport: http(fluentTestnet.rpcUrls.default.http[0]),
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
  const client = createKernelAccountClient({
    account,
    chain: fluentTestnet,
    bundlerTransport: http(zeroDevRpcUrl),
    client: publicClient,
  });

  return {
    account,
    client,
    publicClient,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
    signerMode: "silent",
    signerSource: "session",
  };
}

async function createFluentZeroDevKernel(params: {
  wallet?: PrivyEthereumWallet;
  hostedSigner?: FluentHostedSigner;
  signerMode: FluentZeroDevSignerMode;
  promptedSigners: FluentZeroDevPromptedSigners;
}): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) throw new Error("Fluent ZeroDev project is not configured");
  if (!params.wallet && !params.hostedSigner) throw new Error("Fluent signer is unavailable");

  if (params.wallet) {
    console.log("[fluent zerodev] ensuring Fluent Testnet");
    await ensureWalletOnFluentTestnet(params.wallet);
    console.log("[fluent zerodev] Fluent Testnet ready");
  }

  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${FLUENT_CONNECT_ZERODEV_PROJECT_ID}/chain/${fluentTestnet.id}`;
  const publicClient = createPublicClient({
    chain: fluentTestnet,
    transport: http(fluentTestnet.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");

  /// ZeroDev smart-account derivation starts here: the Privy embedded wallet is
  /// wrapped as a local ECDSA signer, then used as the sudo validator for a
  /// Kernel account. `account.address` below is the deterministic ZeroDev
  /// smart account controlled by the embedded Fluent ID wallet.
  let signer;
  if (params.hostedSigner) {
    signer = toHostedSignerLocalAccount(params.hostedSigner, params.signerMode);
  } else if (params.wallet && params.signerMode === "prompt") {
    signer = toPromptedPrivyLocalAccount(params.wallet, params.promptedSigners);
  } else if (params.wallet) {
    signer = toSilentPrivyLocalAccount(params.wallet);
  } else {
    throw new Error("Fluent signer is unavailable");
  }
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_3,
  });
  const client = createKernelAccountClient({
    account,
    chain: fluentTestnet,
    bundlerTransport: http(zeroDevRpcUrl),
    client: publicClient,
  });

  return {
    account,
    client,
    publicClient,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
    signerMode: params.signerMode,
    signerSource: params.hostedSigner ? "hosted" : "privy",
  };
}

function toHostedSignerLocalAccount(
  signer: FluentHostedSigner,
  signerMode: FluentZeroDevSignerMode,
) {
  const confirmation = signerMode === "silent" ? "session" : "always";
  const source = {
    address: signer.address,
    async signMessage({ message }: { message: SignableMessage }) {
      return signer.signMessage(formatSignableMessageForPrivy(message), confirmation);
    },
    async signTransaction() {
      throw new Error("Fluent ZeroDev signer does not sign raw transactions");
    },
    async signTypedData<
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(typedData: TypedDataDefinition<typedData, primaryType>) {
      return signer.signTypedData(
        {
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        } as Record<string, unknown>,
        confirmation,
      );
    },
  } satisfies CustomSource;

  return toAccount(source);
}

function createFluentZeroDevErc20ExecutionClient(
  kernel: FluentZeroDevKernel,
  gasToken: Address,
) {
  return createKernelAccountClient({
    account: kernel.account,
    chain: fluentTestnet,
    bundlerTransport: http(kernel.zeroDevRpcUrl),
    client: kernel.publicClient,
    paymaster: createFluentZeroDevErc20Paymaster({ gasToken }),
  });
}

type FluentPromptSigningContext = {
  gasTokenSymbol?: string;
};

let promptSigningContext: FluentPromptSigningContext = {};

function setPromptSigningContext(context: FluentPromptSigningContext) {
  promptSigningContext = context;
}

function clearPromptSigningContext() {
  promptSigningContext = {};
}

function resolvePromptGasTokenSymbol(gasPayment?: FluentBatchOperationExecuteOptions["gasPayment"]) {
  if (gasPayment?.symbol) return gasPayment.symbol;
  if (!gasPayment?.token) return undefined;
  const known = Object.values(FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS).find(
    (token) => token.address.toLowerCase() === gasPayment.token.toLowerCase(),
  );
  return known?.symbol;
}

function buildPromptSigningUiOptions() {
  const gasTokenSymbol = promptSigningContext.gasTokenSymbol;
  return {
    title: "Confirm Fluent transaction",
    description: gasTokenSymbol
      ? `Gas will be paid in ${gasTokenSymbol}. Confirm this Fluent transaction.`
      : "Confirm this Fluent transaction.",
    buttonText: "Sign",
  };
}

function toPromptedPrivyLocalAccount(
  wallet: PrivyEthereumWallet,
  promptedSigners: FluentZeroDevPromptedSigners,
) {
  const source = {
    address: wallet.address as Address,
    async signMessage({ message }: { message: SignableMessage }) {
      await ensureWalletOnFluentTestnet(wallet);
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
      await ensureWalletOnFluentTestnet(wallet);
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

function toSilentPrivyLocalAccount(wallet: PrivyEthereumWallet) {
  const source = {
    address: wallet.address as Address,
    async signMessage({ message }: { message: SignableMessage }) {
      console.log("[fluent zerodev] requesting embedded provider signature", {
        signerAddress: wallet.address,
        messageKind: typeof message === "string" ? "string" : "raw" in message ? "raw" : typeof message,
      });
      await ensureWalletOnFluentTestnet(wallet);
      const provider = (await wallet.getEthereumProvider()) as Eip1193Provider | undefined;
      if (!provider?.request) throw new Error("Fluent embedded wallet provider is unavailable");
      const formattedMessage = formatSignableMessageForPrivy(message);
      try {
        const signature = await provider.request({
          method: "personal_sign",
          params: [isHex(formattedMessage) ? formattedMessage : stringToHex(formattedMessage), wallet.address],
        });
        if (typeof signature !== "string") throw new Error("Privy embedded wallet returned an invalid signature");
        console.log("[fluent zerodev] embedded provider signature ready", {
          signerAddress: wallet.address,
          signatureLength: signature.length,
        });
        return signature as Hex;
      } catch (err) {
        console.error("[fluent zerodev] embedded provider signature failed", err);
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
      console.log("[fluent zerodev] requesting embedded provider typed-data signature", {
        signerAddress: wallet.address,
        primaryType: typedData.primaryType,
      });
      await ensureWalletOnFluentTestnet(wallet);
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
        console.log("[fluent zerodev] embedded provider typed-data signature ready", {
          signerAddress: wallet.address,
          signatureLength: signature.length,
        });
        return signature as Hex;
      } catch (err) {
        console.error("[fluent zerodev] embedded provider typed-data signature failed", err);
        throw err;
      }
    },
  } satisfies CustomSource;

  return toAccount(source);
}

function stringifyTypedDataForProvider(value: unknown) {
  return JSON.stringify(value, (_key, next) =>
    typeof next === "bigint" ? next.toString() : next,
  );
}

function formatSignableMessageForPrivy(message: SignableMessage): string {
  if (typeof message === "string") return message;
  if ("raw" in message) return typeof message.raw === "string" ? message.raw : bytesToHex(message.raw);
  return String(message);
}

async function ensureWalletOnFluentTestnet(wallet: PrivyEthereumWallet) {
  const targetChainId = numberToHex(fluentTestnet.id);
  const provider = (await wallet.getEthereumProvider()) as Eip1193Provider | undefined;

  if (wallet.switchChain) {
    console.log("[fluent zerodev] wallet.switchChain", fluentTestnet.id);
    await wallet.switchChain(fluentTestnet.id);
  }

  if (provider?.request) {
    const currentChainId = await getProviderChainId(provider);
    console.log("[fluent zerodev] provider chain", currentChainId);
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
            chainName: fluentTestnet.name,
            nativeCurrency: fluentTestnet.nativeCurrency,
            rpcUrls: fluentTestnet.rpcUrls.default.http,
            blockExplorerUrls: fluentTestnet.blockExplorers?.default.url
              ? [fluentTestnet.blockExplorers.default.url]
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
    console.log("[fluent zerodev] provider chain after switch", nextChainId);
    if (nextChainId !== targetChainId) {
      throw new Error(`Unsupported chainId ${Number(BigInt(nextChainId))}; switch to Fluent Testnet`);
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
