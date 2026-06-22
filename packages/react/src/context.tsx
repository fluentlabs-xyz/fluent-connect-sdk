import { createContext, useContext } from "react";
import type { Chain } from "viem";

import type { FluentBridgeAdapter } from "./bridge.js";
import type { FluentKernelAccountClient } from "./kernel-account.js";

export type FluentConnectContextValue = {
  chain: Chain;
  zeroDevProjectId?: string;
  fluentRpcUrl?: string;
  bridgeAdapter?: FluentBridgeAdapter;
  kernel: FluentKernelAccountClient | null;
  kernelReady: boolean;
  kernelError: Error | null;
  setKernel: (kernel: FluentKernelAccountClient | null) => void;
  setKernelReady: (ready: boolean) => void;
  setKernelError: (error: Error | null) => void;
};

export const FluentConnectContext = createContext<
  FluentConnectContextValue | undefined
>(undefined);

export function useFluentConnect(): FluentConnectContextValue {
  const ctx = useContext(FluentConnectContext);
  if (!ctx) {
    throw new Error("useFluentConnect must be used within FluentConnectProvider");
  }
  return ctx;
}
