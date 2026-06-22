import { fluentMainnet, fluentTestnet } from "@fluent/chains";
import { getZerodevIntegration } from "@fluent/registry";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import type { Chain } from "viem";

const zerodev = getZerodevIntegration();

export type FluentPrivyConfigOptions = {
  /** Default Fluent chain for embedded wallet / transactions */
  defaultChain?: Chain;
  /** Chains shown in Privy (must include defaultChain) */
  supportedChains?: Chain[];
  loginMethods?: PrivyClientConfig["loginMethods"];
  appearance?: PrivyClientConfig["appearance"];
  /** Merge on top of Fluent defaults */
  config?: Partial<PrivyClientConfig>;
};

/**
 * PrivyProvider config aligned with Fluent Connect (embedded wallet + Fluent L2s).
 * Pair with ZeroDev via {@link FluentConnectProvider} or {@link createFluentKernelAccountClient}.
 */
export function getFluentPrivyConfig(
  options: FluentPrivyConfigOptions = {},
): PrivyClientConfig {
  const defaultChain = options.defaultChain ?? fluentTestnet;
  const supportedChains = options.supportedChains ?? [
    fluentTestnet,
    fluentMainnet,
  ];

  if (!supportedChains.some((c) => c.id === defaultChain.id)) {
    supportedChains.unshift(defaultChain);
  }

  const base: PrivyClientConfig = {
    defaultChain,
    supportedChains,
    loginMethods: options.loginMethods ?? ["email", "google", "wallet"],
    appearance: options.appearance,
    embeddedWallets: {
      createOnLogin: zerodev.privy.embeddedWalletCreateOnLogin as "users-without-wallets",
      showWalletUIs: true,
    },
  };

  return {
    ...base,
    ...options.config,
    defaultChain: options.config?.defaultChain ?? base.defaultChain,
    supportedChains: options.config?.supportedChains ?? base.supportedChains,
    embeddedWallets: {
      ...base.embeddedWallets,
      ...options.config?.embeddedWallets,
    },
  };
}
