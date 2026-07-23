import {
  usePrivy,
  useSignMessage,
  useSignTypedData,
  useWallets,
  type SignTypedDataParams,
} from "@privy-io/react-auth";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
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
import { useCallback, useEffect, useRef, useState } from "react";
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
  createFluentZeroDevErc20Paymaster,
  createFluentZeroDevErc20PaymasterApprovalCall,
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

export function useFluentZeroDevAccount() {
  const { authenticated, login, ready } = usePrivy();
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
  const activeKernel = kernels.prompt ?? kernels.silent ?? null;

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
    if (!ready || !authenticated || !embeddedWallet) {
      const nextError = new Error(getZeroDevReadinessMessage({
        ready,
        authenticated,
        embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
        walletCount: wallets.length,
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
        embeddedWallet: embeddedWallet.address,
        walletClientType: embeddedWallet.walletClientType,
      });
      const nextKernel = await createFluentZeroDevKernel({
        wallet: embeddedWallet as PrivyEthereumWallet,
        signerMode,
        promptedSigners: {
          signMessage: promptSignMessage,
          signTypedData: promptSignTypedData,
        },
      });
      console.log("[fluent zerodev] ready", {
        signerMode,
        signerAddress: embeddedWallet.address,
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
    kernels,
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
      const executionKernel = kernels.prompt ?? await initialize({ signerMode: "prompt" });
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
    [error, initialize, kernels.prompt],
  );

  const sendCalls = useCallback(
    async (
      calls: FluentZeroDevCall[],
      options?: FluentBatchOperationExecuteOptions,
    ): Promise<Hash> => {
      const signerMode = confirmationToSignerMode(options?.confirmation ?? "always");
      const executionKernel = kernels[signerMode] ?? await initialize({ signerMode, throwOnError: true });
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
        approvalIncluded: Boolean(gasToken && options?.gasPayment?.includeApproval),
        calls: preparedCalls.map((call) => ({
          to: call.to,
          hasData: Boolean(call.data && call.data !== "0x"),
          value: (call.value ?? 0n).toString(),
        })),
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
          transactionHash: receipt.receipt.transactionHash,
        });
        return receipt.receipt.transactionHash;
      } catch (err) {
        console.error("[fluent zerodev] sendCalls failed", err);
        throw err;
      }
    },
    [error, initialize, kernels],
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
    signerAddress: embeddedWallet?.address as Address | undefined,
    privyReady: ready,
    privyAuthenticated: authenticated,
    embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
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

async function createFluentZeroDevKernel(params: {
  wallet: PrivyEthereumWallet;
  signerMode: FluentZeroDevSignerMode;
  promptedSigners: FluentZeroDevPromptedSigners;
}): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) throw new Error("Fluent ZeroDev project is not configured");

  console.log("[fluent zerodev] ensuring Fluent Testnet");
  await ensureWalletOnFluentTestnet(params.wallet);
  console.log("[fluent zerodev] Fluent Testnet ready");

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
  const signer =
    params.signerMode === "prompt"
      ? toPromptedPrivyLocalAccount(params.wallet, params.promptedSigners)
      : toSilentPrivyLocalAccount(params.wallet);
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
  };
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
          uiOptions: {
            title: "Confirm Fluent transaction",
            description: "Sign the ZeroDev UserOperation for this Fluent account.",
            buttonText: "Sign",
          },
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
          uiOptions: {
            title: "Confirm Fluent transaction",
            description: "Sign the ZeroDev UserOperation for this Fluent account.",
            buttonText: "Sign",
          },
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
