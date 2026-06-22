import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { useMemo, useState, type ReactNode } from "react";
import type { Chain } from "viem";
import { fluentTestnet } from "@fluent/chains";

import { FluentConnectContext } from "./context.js";
import type { FluentBridgeAdapter } from "./bridge.js";
import type { FluentKernelAccountClient } from "./kernel-account.js";
import { getFluentPrivyConfig, type FluentPrivyConfigOptions } from "./privy-config.js";

export type FluentConnectProviderProps = {
  children: ReactNode;
  privyAppId: string;
  /** Optional. Required only when the app needs ZeroDev Kernel smart accounts. */
  zeroDevProjectId?: string;
  chain?: Chain;
  fluentRpcUrl?: string;
  bridgeAdapter?: FluentBridgeAdapter;
  privy?: FluentPrivyConfigOptions;
  /** Extra Privy config merged after Fluent defaults */
  privyConfig?: Partial<PrivyClientConfig>;
};

/**
 * Fluent Connect stack: Privy (auth + embedded EOA) + ZeroDev (Kernel smart account on Fluent).
 *
 * Wrap your app root with this provider, then use {@link useFluentSmartAccount} after login.
 */
export function FluentConnectProvider({
  children,
  privyAppId,
  zeroDevProjectId,
  chain = fluentTestnet,
  fluentRpcUrl,
  bridgeAdapter,
  privy,
  privyConfig,
}: FluentConnectProviderProps) {
  const [kernel, setKernel] = useState<FluentKernelAccountClient | null>(null);
  const [kernelReady, setKernelReady] = useState(false);
  const [kernelError, setKernelError] = useState<Error | null>(null);

  const mergedPrivyConfig = useMemo(() => {
    const fluentDefaults = getFluentPrivyConfig({
      ...privy,
      defaultChain: privy?.defaultChain ?? chain,
    });
    return {
      ...fluentDefaults,
      ...privyConfig,
      defaultChain: privyConfig?.defaultChain ?? fluentDefaults.defaultChain,
      supportedChains:
        privyConfig?.supportedChains ?? fluentDefaults.supportedChains,
      embeddedWallets: {
        ...fluentDefaults.embeddedWallets,
        ...privyConfig?.embeddedWallets,
      },
    } satisfies PrivyClientConfig;
  }, [chain, privy, privyConfig]);

  const contextValue = useMemo(
    () => ({
      chain,
      zeroDevProjectId,
      fluentRpcUrl,
      bridgeAdapter,
      kernel,
      kernelReady,
      kernelError,
      setKernel,
      setKernelReady,
      setKernelError,
    }),
    [chain, zeroDevProjectId, fluentRpcUrl, bridgeAdapter, kernel, kernelReady, kernelError],
  );

  return (
    <PrivyProvider appId={privyAppId} config={mergedPrivyConfig}>
      <FluentConnectContext.Provider value={contextValue}>
        {children}
      </FluentConnectContext.Provider>
    </PrivyProvider>
  );
}
