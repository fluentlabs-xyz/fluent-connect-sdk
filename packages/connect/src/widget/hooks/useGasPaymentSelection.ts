import { useMemo } from "react";
import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { getFluentDefaultWidgetGasTokens } from "@fluent.xyz/connect-sdk";

import type { FluentWidgetNetwork } from "../../core/network";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentSigningMode, FluentWidgetGasPayment } from "../batchOperation";

/**
 * Resolves the selected gas payment symbol to the `{ symbol, token, decimals }` an execution pays
 * with. Native ETH has no token address; a symbol `availableTokens` lacks gets 0 decimals, or 18
 * for ETH.
 */
export function resolveGasPaymentSelection(params: {
  gasPaymentToken: FluentGasTokenSymbol;
  availableTokens: readonly FluentTokenDefinition[];
}): FluentWidgetGasPayment {
  const selected = params.availableTokens.find((token) => token.symbol === params.gasPaymentToken);
  return {
    symbol: params.gasPaymentToken,
    token: selected && "address" in selected ? selected.address : undefined,
    decimals: selected?.decimals ?? (params.gasPaymentToken === "ETH" ? 18 : 0),
  };
}

/**
 * Returns the Gas payment token executions use and the default signing mode: Silent mode when
 * Quick sign is on, else Prompt mode.
 */
export function useGasPaymentSelection(params: {
  gasPaymentToken: FluentGasTokenSymbol;
  network: FluentWidgetNetwork;
  silentSigningEnabled: boolean;
}) {
  const { gasPaymentToken, network, silentSigningEnabled } = params;
  // Fluent's own Gas tokens only, never the App's token list: this picks the address the
  // paymaster charges, and an Integrator token sharing a Gas token's symbol must not redirect fees.
  const availableTokens = useMemo(() => getFluentDefaultWidgetGasTokens(network), [network]);
  const selectedGasPaymentToken = useMemo(
    () => resolveGasPaymentSelection({ gasPaymentToken, availableTokens }),
    [gasPaymentToken, availableTokens],
  );
  const defaultSigningMode: FluentSigningMode = silentSigningEnabled ? "silent" : "prompt";
  return { selectedGasPaymentToken, defaultSigningMode };
}
