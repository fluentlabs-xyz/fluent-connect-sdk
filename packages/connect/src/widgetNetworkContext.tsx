import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { createContext, useContext, type ReactNode } from "react";
import type { Chain } from "viem";

import { getFluentChainForNetwork, type FluentWidgetNetwork } from "./network";

export type FluentWidgetNetworkContextValue = {
  network: FluentWidgetNetwork;
  chain: Chain;
};

const defaultValue: FluentWidgetNetworkContextValue = {
  network: "testnet",
  chain: fluentTestnet,
};

export const FluentWidgetNetworkContext =
  createContext<FluentWidgetNetworkContextValue>(defaultValue);

export function FluentWidgetNetworkProvider({
  network,
  children,
}: {
  network: FluentWidgetNetwork;
  children: ReactNode;
}) {
  const value: FluentWidgetNetworkContextValue = {
    network,
    chain: getFluentChainForNetwork(network),
  };

  return (
    <FluentWidgetNetworkContext.Provider value={value}>
      {children}
    </FluentWidgetNetworkContext.Provider>
  );
}

export function useFluentWidgetNetwork() {
  return useContext(FluentWidgetNetworkContext);
}
