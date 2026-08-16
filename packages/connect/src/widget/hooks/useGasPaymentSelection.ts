import { useMemo } from "react";
import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { getFluentDefaultGasTokens, type FluentWidgetNetwork } from "../../core/network";
import type { FluentGasPaymentSymbol } from "../../core/gasPayment";
import type { FluentBatchConfirmationMode, FluentWidgetGasPayment } from "../batchOperation";

/**
 * Resolve the widget-selected gas symbol to a concrete `{ symbol, token, decimals }`.
 * Native (ETH) has no token address and defaults to 18 decimals; an unknown
 * symbol falls back to 0 decimals. Pure — see `useGasPaymentSelection` for the
 * memoized hook wrapper.
 */
export function resolveGasPaymentSelection(params: {
  gasPaymentToken: FluentGasPaymentSymbol;
  availableTokens: readonly FluentTokenDefinition[];
}): FluentWidgetGasPayment {
  const selected = params.availableTokens.find(
    (token) => token.symbol === params.gasPaymentToken,
  );
  return {
    symbol: params.gasPaymentToken,
    token: selected && "address" in selected ? selected.address : undefined,
    decimals: selected?.decimals ?? (params.gasPaymentToken === "ETH" ? 18 : 0),
  };
}

/**
 * Derives the gas-payment token passed to executions and the default
 * confirmation mode (silent signing → session, otherwise per-tx review).
 */
export function useGasPaymentSelection(params: {
  gasPaymentToken: FluentGasPaymentSymbol;
  tokens?: readonly FluentTokenDefinition[];
  network: FluentWidgetNetwork;
  silentSigningEnabled: boolean;
}) {
  const { gasPaymentToken, tokens, network, silentSigningEnabled } = params;
  const defaultGasTokens = useMemo(
    () => getFluentDefaultGasTokens(network),
    [network],
  );
  const selectedGasPaymentToken = useMemo(
    () =>
      resolveGasPaymentSelection({
        gasPaymentToken,
        availableTokens: tokens ?? defaultGasTokens,
      }),
    [gasPaymentToken, tokens, defaultGasTokens],
  );
  const defaultConfirmationMode: FluentBatchConfirmationMode = silentSigningEnabled
    ? "session"
    : "always";
  return { selectedGasPaymentToken, defaultConfirmationMode };
}
