import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef } from "react";
import type { EIP1193Provider, Hash } from "viem";

import { useFluentConnect } from "../context.js";
import {
  createFluentKernelAccountClient,
  type FluentKernelAccountClient,
} from "../kernel-account.js";

export type UseFluentSmartAccountResult = {
  /** Privy finished loading */
  privyReady: boolean;
  /** User authenticated with Privy */
  authenticated: boolean;
  /** Kernel client initialized (or failed) */
  smartAccountReady: boolean;
  /** Whether ZeroDev smart account creation is configured */
  smartAccountEnabled: boolean;
  smartAccountAddress: `0x${string}` | undefined;
  signerAddress: `0x${string}` | undefined;
  kernel: FluentKernelAccountClient | null;
  error: Error | null;
  /** Send a sponsored user operation via ZeroDev */
  sendTransaction: (request: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
  }) => Promise<Hash>;
  /** Re-initialize smart account after login */
  refresh: () => Promise<void>;
};

/**
 * Initializes a ZeroDev Kernel smart account from the Privy embedded wallet on Fluent.
 * Mount inside {@link FluentConnectProvider} after the user logs in.
 */
export function useFluentSmartAccount(): UseFluentSmartAccountResult {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const {
    chain,
    zeroDevProjectId,
    fluentRpcUrl,
    kernel,
    kernelReady,
    kernelError,
    setKernel,
    setKernelReady,
    setKernelError,
  } = useFluentConnect();

  const initInFlight = useRef(false);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const smartAccountEnabled = Boolean(zeroDevProjectId);

  const initialize = useCallback(async () => {
    if (!authenticated || !embeddedWallet || initInFlight.current) return;
    if (!zeroDevProjectId) {
      setKernel(null);
      setKernelReady(false);
      setKernelError(null);
      return;
    }

    initInFlight.current = true;
    setKernelReady(false);
    setKernelError(null);

    try {
      const provider = await embeddedWallet.getEthereumProvider();
      const client = await createFluentKernelAccountClient({
        chain,
        zeroDevProjectId,
        signer: provider as unknown as EIP1193Provider,
        fluentRpcUrl,
      });
      setKernel(client);
      setKernelReady(true);
    } catch (err) {
      setKernel(null);
      setKernelReady(false);
      setKernelError(
        err instanceof Error ? err : new Error("Failed to create smart account"),
      );
    } finally {
      initInFlight.current = false;
    }
  }, [
    authenticated,
    embeddedWallet,
    chain,
    zeroDevProjectId,
    fluentRpcUrl,
    setKernel,
    setKernelReady,
    setKernelError,
  ]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setKernel(null);
      setKernelReady(false);
      setKernelError(null);
      return;
    }
    void initialize();
  }, [ready, authenticated, initialize, setKernel, setKernelReady, setKernelError]);

  const sendTransaction = useCallback(
    async (request: {
      to: `0x${string}`;
      data?: `0x${string}`;
      value?: bigint;
    }): Promise<Hash> => {
      if (!kernel) {
        throw new Error("Smart account not ready");
      }
      return kernel.kernelClient.sendTransaction({
        account: kernel.account,
        chain,
        to: request.to,
        data: request.data ?? "0x",
        value: request.value ?? 0n,
      });
    },
    [kernel, chain],
  );

  return {
    privyReady: ready,
    authenticated,
    smartAccountReady: kernelReady,
    smartAccountEnabled,
    smartAccountAddress: kernel?.smartAccountAddress,
    signerAddress: embeddedWallet?.address as `0x${string}` | undefined,
    kernel,
    error: kernelError,
    sendTransaction,
    refresh: initialize,
  };
}
