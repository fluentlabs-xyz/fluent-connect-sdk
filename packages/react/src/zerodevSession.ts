import { usePrivy, useWallets } from "@privy-io/react-auth";
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
  createZeroDevPaymasterClient,
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

type KernelAccount = Awaited<ReturnType<typeof createKernelAccount>>;
type KernelClient = ReturnType<typeof createKernelAccountClient>;
type SponsorUserOperation = Parameters<
  ReturnType<typeof createZeroDevPaymasterClient>["sponsorUserOperation"]
>[0]["userOperation"];
type PrivyEthereumWallet = {
  address: string;
  sign: (message: string) => Promise<string>;
  switchChain?: (targetChainId: number | `0x${string}`) => Promise<void>;
  getEthereumProvider: () => Promise<unknown>;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type FluentZeroDevKernel = {
  account: KernelAccount;
  client: KernelClient;
  publicClient: ReturnType<typeof createPublicClient>;
  smartAccountAddress: Address;
  zeroDevRpcUrl: string;
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
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const [kernel, setKernel] = useState<FluentZeroDevKernel | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [smartAccountReady, setSmartAccountReady] = useState(false);
  const initPromise = useRef<Promise<FluentZeroDevKernel | null> | null>(null);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");

  const initialize = useCallback(async (options: { throwOnError?: boolean } = {}) => {
    if (kernel) return kernel;
    if (!ready || !authenticated || !embeddedWallet) {
      const nextError = new Error(getZeroDevReadinessMessage({
        ready,
        authenticated,
        embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
        walletCount: wallets.length,
      }));
      setError(nextError);
      if (options.throwOnError) throw nextError;
      return null;
    }
    if (initPromise.current) return initPromise.current;
    if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) {
      setKernel(null);
      setSmartAccountReady(false);
      setError(null);
      return null;
    }

    setSmartAccountReady(false);
    setError(null);

    initPromise.current = (async () => {
      console.log("[fluent zerodev] initializing", {
        embeddedWallet: embeddedWallet.address,
        walletClientType: embeddedWallet.walletClientType,
      });
      const nextKernel = await createFluentZeroDevKernel(embeddedWallet as PrivyEthereumWallet);
      console.log("[fluent zerodev] ready", {
        signerAddress: embeddedWallet.address,
        smartAccountAddress: nextKernel.smartAccountAddress,
      });
      setKernel(nextKernel);
      setSmartAccountReady(true);
      return nextKernel;
    })();

    try {
      return await initPromise.current;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error("Failed to create ZeroDev account");
      console.error("[fluent zerodev] initialization failed", nextError);
      setKernel(null);
      setSmartAccountReady(false);
      setError(nextError);
      if (options.throwOnError) throw nextError;
      return null;
    } finally {
      initPromise.current = null;
    }
  }, [authenticated, embeddedWallet, kernel, ready]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setKernel(null);
      setSmartAccountReady(false);
      setError(null);
      initPromise.current = null;
    }
  }, [authenticated, ready]);

  const sendTransaction = useCallback(
    async (request: { to: Address; data?: Hex; value?: bigint }): Promise<Hash> => {
      const activeKernel = kernel ?? await initialize();
      if (!activeKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      console.log("[fluent zerodev] sendTransaction", {
        smartAccountAddress: activeKernel.smartAccountAddress,
        to: request.to,
        hasData: Boolean(request.data && request.data !== "0x"),
        value: (request.value ?? 0n).toString(),
      });
      try {
        const hash = await activeKernel.client.sendTransaction({
          account: activeKernel.account,
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
    [error, initialize, kernel],
  );

  const sendCalls = useCallback(
    async (calls: Array<{ to: Address; data?: Hex; value?: bigint }>): Promise<Hash> => {
      const activeKernel = kernel ?? await initialize();
      if (!activeKernel) throw new Error(error?.message ?? "ZeroDev smart account is not ready");
      console.log("[fluent zerodev] sendCalls", {
        smartAccountAddress: activeKernel.smartAccountAddress,
        calls: calls.map((call) => ({
          to: call.to,
          hasData: Boolean(call.data && call.data !== "0x"),
          value: (call.value ?? 0n).toString(),
        })),
      });
      try {
        const userOpHash = await activeKernel.client.sendUserOperation({
          account: activeKernel.account,
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data ?? "0x",
            value: call.value ?? 0n,
          })),
        });
        console.log("[fluent zerodev] sendCalls userOp submitted", { userOpHash });
        const receipt = await activeKernel.client.waitForUserOperationReceipt({
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
    [error, initialize, kernel],
  );

  return {
    smartAccountEnabled: Boolean(FLUENT_CONNECT_ZERODEV_PROJECT_ID),
    smartAccountReady,
    smartAccountAddress: kernel?.smartAccountAddress,
    signerAddress: embeddedWallet?.address as Address | undefined,
    privyReady: ready,
    privyAuthenticated: authenticated,
    embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
    kernel,
    error,
    sendTransaction,
    sendCalls,
    refresh: () => initialize({ throwOnError: true }),
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

async function createFluentZeroDevKernel(wallet: PrivyEthereumWallet): Promise<FluentZeroDevKernel> {
  if (!FLUENT_CONNECT_ZERODEV_PROJECT_ID) throw new Error("Fluent ZeroDev project is not configured");

  console.log("[fluent zerodev] ensuring Fluent Testnet");
  await ensureWalletOnFluentTestnet(wallet);
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
  const signer = toPrivyLocalAccount(wallet);
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
  const paymaster = createZeroDevPaymasterClient({
    chain: fluentTestnet,
    transport: http(zeroDevRpcUrl),
  });
  const client = createKernelAccountClient({
    account,
    chain: fluentTestnet,
    bundlerTransport: http(zeroDevRpcUrl),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        paymaster.sponsorUserOperation({
          userOperation: withoutChainMetadata(userOperation),
        }),
    },
  });

  return {
    account,
    client,
    publicClient,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
  };
}

function toPrivyLocalAccount(wallet: PrivyEthereumWallet) {
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

function withoutChainMetadata(userOperation: unknown): SponsorUserOperation {
  const { chain: _chain, ...cleanUserOperation } = userOperation as Record<string, unknown>;
  return cleanUserOperation as SponsorUserOperation;
}
