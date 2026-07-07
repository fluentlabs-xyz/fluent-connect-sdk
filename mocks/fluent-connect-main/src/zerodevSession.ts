import { usePrivy, useWallets } from "@privy-io/react-auth";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import { CallPolicyVersion, CallType, toCallPolicy } from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  http,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fluentTestnet } from "viem/chains";

import { ZERODEV_PROJECT_ID } from "./const";

type KernelAccount = Awaited<ReturnType<typeof createKernelAccount>>;
type KernelClient = ReturnType<typeof createKernelAccountClient>;
type SponsorUserOperation = Parameters<
  ReturnType<typeof createZeroDevPaymasterClient>["sponsorUserOperation"]
>[0]["userOperation"];

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

export function useFluentZeroDevAccount() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const [kernel, setKernel] = useState<FluentZeroDevKernel | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [smartAccountReady, setSmartAccountReady] = useState(false);
  const initPromise = useRef<Promise<FluentZeroDevKernel | null> | null>(null);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");

  const initialize = useCallback(async () => {
    console.log("[fluent zerodev][hosted] initialize requested", {
      ready,
      authenticated,
      walletCount: wallets.length,
      embeddedWalletCount: wallets.filter((wallet) => wallet.walletClientType === "privy").length,
      embeddedWallet: embeddedWallet?.address,
      hasKernel: Boolean(kernel),
      initInFlight: Boolean(initPromise.current),
      hasProjectId: Boolean(ZERODEV_PROJECT_ID),
    });
    if (kernel) {
      console.log("[fluent zerodev][hosted] using cached kernel", {
        smartAccountAddress: kernel.smartAccountAddress,
      });
      return kernel;
    }
    if (!authenticated || !embeddedWallet) {
      console.warn("[fluent zerodev][hosted] initialize blocked", {
        authenticated,
        hasEmbeddedWallet: Boolean(embeddedWallet),
      });
      return null;
    }
    if (initPromise.current) {
      console.log("[fluent zerodev][hosted] joining in-flight initialization");
      return initPromise.current;
    }
    if (!ZERODEV_PROJECT_ID) {
      setKernel(null);
      setSmartAccountReady(false);
      setError(null);
      console.warn("[fluent zerodev][hosted] initialize blocked: project id missing");
      return null;
    }

    setSmartAccountReady(false);
    setError(null);

    initPromise.current = (async () => {
      console.log("[fluent zerodev][hosted] requesting embedded provider", {
        signerAddress: embeddedWallet.address,
      });
      const provider = await embeddedWallet.getEthereumProvider();
      const nextKernel = await createFluentZeroDevKernel(provider as unknown as EIP1193Provider);
      console.log("[fluent zerodev][hosted] kernel ready", {
        signerAddress: embeddedWallet.address,
        smartAccountAddress: nextKernel.smartAccountAddress,
      });
      setKernel(nextKernel);
      setSmartAccountReady(true);
      return nextKernel;
    })();

    try {
      return await initPromise.current;
    } catch (error) {
      console.error("[fluent zerodev][hosted] initialization failed", error);
      setKernel(null);
      setSmartAccountReady(false);
      setError(error instanceof Error ? error : new Error("Failed to create ZeroDev account"));
      return null;
    } finally {
      initPromise.current = null;
    }
  }, [authenticated, embeddedWallet, kernel, ready, wallets]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setKernel(null);
      setSmartAccountReady(false);
      setError(null);
      initPromise.current = null;
      return;
    }
    void initialize();
  }, [authenticated, initialize, ready]);

  const sendTransaction = useCallback(
    async (request: { to: Address; data?: Hex; value?: bigint }): Promise<Hash> => {
      if (!kernel) throw new Error("ZeroDev smart account is not ready");
      return kernel.client.sendTransaction({
        account: kernel.account,
        chain: fluentTestnet,
        to: request.to,
        data: request.data ?? "0x",
        value: request.value ?? 0n,
      });
    },
    [kernel],
  );

  const sendCalls = useCallback(
    async (calls: Array<{ to: Address; data?: Hex; value?: bigint }>): Promise<Hash> => {
      if (!kernel) throw new Error("ZeroDev smart account is not ready");
      const userOpHash = await kernel.client.sendUserOperation({
        account: kernel.account,
        calls: calls.map((call) => ({
          to: call.to,
          data: call.data ?? "0x",
          value: call.value ?? 0n,
        })),
      });
      const receipt = await kernel.client.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      return receipt.receipt.transactionHash;
    },
    [kernel],
  );

  return {
    smartAccountEnabled: Boolean(ZERODEV_PROJECT_ID),
    smartAccountReady,
    smartAccountAddress: kernel?.smartAccountAddress,
    signerAddress: embeddedWallet?.address as Address | undefined,
    kernel,
    error,
    sendTransaction,
    sendCalls,
    refresh: initialize,
  };
}

export async function createFluentZeroDevPermissionSession(params: {
  kernel: FluentZeroDevKernel;
  sessionPrivateKey: Hex;
  calls: Array<{ target: Address; selector: Hex; valueLimit?: bigint; callType?: CallType }>;
}): Promise<FluentZeroDevPermissionSession> {
  const sessionAccount = privateKeyToAccount(params.sessionPrivateKey);
  const signer = await toECDSASigner({ signer: sessionAccount });
  const permissionPlugin = await toPermissionValidator(params.kernel.publicClient, {
    signer,
    policies: [
      toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_5,
        permissions: params.calls.map((call) => ({
          target: call.target,
          selector: call.selector,
          callType: call.callType,
          valueLimit: call.valueLimit ?? 0n,
        })),
      }),
    ],
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

async function createFluentZeroDevKernel(signer: EIP1193Provider): Promise<FluentZeroDevKernel> {
  if (!ZERODEV_PROJECT_ID) throw new Error("Fluent ZeroDev project is not configured");

  console.log("[fluent zerodev][hosted] create kernel", {
    chainId: fluentTestnet.id,
    hasProjectId: Boolean(ZERODEV_PROJECT_ID),
  });
  const zeroDevRpcUrl = `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${fluentTestnet.id}`;
  const publicClient = createPublicClient({
    chain: fluentTestnet,
    transport: http(fluentTestnet.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");
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

function withoutChainMetadata(userOperation: unknown): SponsorUserOperation {
  const { chain: _chain, ...cleanUserOperation } = userOperation as Record<string, unknown>;
  return cleanUserOperation as SponsorUserOperation;
}
