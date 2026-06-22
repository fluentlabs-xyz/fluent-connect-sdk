import {
  fluentZeroDevChainIds,
  getZeroDevRpcUrl,
  isFluentZeroDevChain,
} from "@fluent/registry";

export {
  fluentZeroDevChainIds,
  getZeroDevRpcUrl,
  isFluentZeroDevChain,
};

export type FluentZeroDevChainId = (typeof fluentZeroDevChainIds)[number];

export function assertFluentZeroDevChain(chainId: number): void {
  if (!isFluentZeroDevChain(chainId)) {
    throw new Error(
      `Chain ${chainId} is not configured for ZeroDev on Fluent. Supported: ${fluentZeroDevChainIds.join(", ")}`,
    );
  }
}
