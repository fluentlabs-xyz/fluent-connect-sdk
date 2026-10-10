import { isFluentNativeToken, type FluentDisplayToken } from "@fluent.xyz/connect-sdk";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, parseUnits, type Address, type Chain } from "viem";

import {
  FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES,
  type FluentGasPaymentEthRates,
} from "../../core/gasPayment";
import { createFluentRpcTransport } from "../../core/rpc";
import { debugError } from "../../core/debugLogger";
import { fluentTransferAbi } from "../tokenTransfer";

/** Typing pauses this long before the chain is asked again. */
const ESTIMATE_DEBOUNCE_MS = 300;

export type FluentTransferFeeEstimate =
  /** Nothing to estimate yet: no account, no recipient, or no valid amount. */
  | { status: "idle" }
  | { status: "loading" }
  /** What the network would charge, in wei of the chain's own currency. */
  | { status: "ready"; wei: bigint }
  /** The chain refused to estimate — most often a transfer that would revert. */
  | { status: "failed" };

/**
 * What the network charges to run a transfer, as the Bridge page estimates a
 * deposit: the call's gas at the current gas price, read off the chain the
 * moment the form holds something sendable.
 *
 * This is the call's own cost. A Fluent ID sends it inside a user operation,
 * whose validation and paymaster overhead sit on top, so the figure reads as
 * an estimate and the review carries the exact amount.
 */
export function useTransferFeeEstimate(params: {
  chain: Chain;
  /** The account the transfer leaves. Without it nothing is estimated. */
  account?: string;
  token?: FluentDisplayToken;
  /** A checked recipient; null while the field holds nothing usable. */
  to: Address | null;
  /** A checked amount in base units; null while the field holds nothing usable. */
  amount: bigint | null;
}): FluentTransferFeeEstimate {
  const { chain, account, token, to, amount } = params;
  const [estimate, setEstimate] = useState<FluentTransferFeeEstimate>({ status: "idle" });

  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  const tokenAddress = token?.address;
  const native = token ? isFluentNativeToken(token) : false;

  useEffect(() => {
    if (!account || !token || to === null || amount === null || (!native && !tokenAddress)) {
      setEstimate({ status: "idle" });
      return;
    }

    let cancelled = false;
    setEstimate({ status: "loading" });
    const timer = setTimeout(() => {
      void (async () => {
        const from = account as Address;
        const [gas, gasPrice] = await Promise.all([
          native
            ? publicClient.estimateGas({ account: from, to, value: amount })
            : publicClient.estimateContractGas({
                account: from,
                address: tokenAddress as Address,
                abi: fluentTransferAbi,
                functionName: "transfer",
                args: [to, amount],
              }),
          publicClient.getGasPrice(),
        ]);
        return gas * gasPrice;
      })().then(
        (wei) => {
          if (!cancelled) setEstimate({ status: "ready", wei });
        },
        (error: unknown) => {
          if (cancelled) return;
          debugError("[FluentWidget] Transfer fee estimate failed", error);
          setEstimate({ status: "failed" });
        },
      );
    }, ESTIMATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [publicClient, account, token, native, tokenAddress, to, amount]);

  return estimate;
}

/**
 * A fee in wei, restated in the token it will be charged in. Needs that
 * token's ETH rate — the App's `gasPayment.ethValueByToken`, or the one the
 * widget derives from prices — and returns undefined without one, so the
 * caller can fall back to showing the fee in the chain's own currency.
 */
export function convertFluentFeeToGasToken(params: {
  wei: bigint;
  feeToken: FluentDisplayToken;
  ethValueByToken?: FluentGasPaymentEthRates;
}): bigint | undefined {
  const { wei, feeToken, ethValueByToken } = params;
  const rates: FluentGasPaymentEthRates = {
    ...FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES,
    ...ethValueByToken,
  };
  const rate = rates[feeToken.symbol];
  if (!rate) return undefined;
  const rateWei = parseUnits(rate, 18);
  if (rateWei === 0n) return undefined;
  return (wei * 10n ** BigInt(feeToken.decimals)) / rateWei;
}
