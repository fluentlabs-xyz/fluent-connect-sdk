import { useMemo } from "react";
import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { getFluentDefaultWidgetGasTokens } from "@fluent.xyz/connect-sdk";

import type { FluentWidgetNetwork } from "../../core/network";
import type { FluentGasTokenSymbol } from "../../core/gasPayment";
import type { FluentBatchConfirmationMode, FluentWidgetGasPayment } from "../batchOperation";

/**
 * Resolve the widget-selected gas symbol to a concrete `{ symbol, token, decimals }`.
 * Native (ETH) has no token address and defaults to 18 decimals; an unknown
 * symbol falls back to 0 decimals. Pure — see `useGasPaymentSelection` for the
 * memoized hook wrapper.
 */
export function resolveGasPaymentSelection(params: {
  gasPaymentToken: FluentGasTokenSymbol;
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
  gasPaymentToken: FluentGasTokenSymbol;
  network: FluentWidgetNetwork;
  silentSigningEnabled: boolean;
}) {
  const { gasPaymentToken, network, silentSigningEnabled } = params;
  // This resolves the address the paymaster is asked to charge, and the gas set
  // is closed — integrators extend the *display* list only. So the candidates
  // are always Fluent's own gas tokens, never the integrator prop: matching
  // against the prop let a builder passing `{ symbol: "BLEND", address: theirs }`
  // redirect fees to their own contract, and narrowing the prop instead left an
  // empty list whenever the prop held only the extra tokens it is meant to hold.
  const availableTokens = useMemo(
    () => getFluentDefaultWidgetGasTokens(network),
    [network],
  );
  const selectedGasPaymentToken = useMemo(
    () => resolveGasPaymentSelection({ gasPaymentToken, availableTokens }),
    [gasPaymentToken, availableTokens],
  );
  const defaultConfirmationMode: FluentBatchConfirmationMode = silentSigningEnabled
    ? "session"
    : "always";
  return { selectedGasPaymentToken, defaultConfirmationMode };
}
