import { useCallback, useEffect, useRef, useState } from "react";

import { FluentGasPaymentError } from "../core/zerodevPaymaster";
import type { FluentBatchApi } from "./batchOperation";
import type { FluentTokenTransferRequest } from "./tokenTransfer";

/** Returns the text the widget's flows show when the Gas token cannot pay an operation's fee. */
export function fluentInsufficientGasTokenMessage(symbol: string): string {
  return `Not enough ${symbol} to pay the network fee. Pay the fee in ETH or add ${symbol}.`;
}

/** Reports whether `error` is `execute()` rejecting because the Gas token cannot pay the fee. */
export function isFluentInsufficientGasToken(error: unknown): boolean {
  return error instanceof FluentGasPaymentError && error.code === "insufficient_gas_token";
}

/**
 * Returns the text shown for an operation the widget itself executed and `execute()` rejected:
 * the fixed copy for `insufficient_gas_token`, naming `gasSymbol`, the Gas token the flow paid
 * in, and otherwise the error's own message, or `fallback` for a thrown value that is not an
 * `Error`.
 */
export function describeFluentExecutionFailure(
  error: unknown,
  gasSymbol: string,
  fallback: string,
): string {
  if (isFluentInsufficientGasToken(error)) return fluentInsufficientGasTokenMessage(gasSymbol);
  return error instanceof Error ? error.message : fallback;
}

/**
 * Returns `api` as an App receives it: every Batch operation's `execute()` that rejects with
 * `insufficient_gas_token` also hands `notify` the widget's copy for it, naming the Gas token the
 * operation was paid in, and rejects with the same error. The App's Review closes on Confirm,
 * before the operation is prepared, so without this the person would see nothing of the failure.
 */
export function withFluentInsufficientGasTokenNotice(
  api: FluentBatchApi,
  notify: (message: string) => void,
): FluentBatchApi {
  return {
    ...api,
    createBatchOp: (input) => {
      const operation = api.createBatchOp(input);
      return {
        ...operation,
        execute: async (options) => {
          try {
            return await operation.execute(options);
          } catch (error) {
            if (isFluentInsufficientGasToken(error)) {
              const symbol = options?.gasPayment?.symbol ?? api.gasPayment.symbol;
              try {
                notify(fluentInsufficientGasTokenMessage(symbol));
              } catch {
                // The notice is worth less than the App receiving its rejection.
              }
            }
            throw error;
          }
        },
      };
    },
  };
}

/** A Send the person asked to open again with its fee in the native token. */
export type FluentSendRetry = { key: number; request: FluentTokenTransferRequest };

/**
 * Holds the Send refused for its Gas token, for the Send page to open with again, as long as
 * `account`, the account that sent it, stays current. `payFeeInNative` is the failure toast's
 * offer: called from a toast shown
 * for another account than the current one, it does nothing; otherwise it holds the request and
 * calls `open`. A change of `account` drops the held request.
 */
export function useFluentSendRetry(account: string | undefined, open: () => void) {
  const [sendRetry, setSendRetry] = useState<FluentSendRetry | null>(null);
  const currentAccount = useRef(account);
  useEffect(() => {
    currentAccount.current = account;
    setSendRetry(null);
  }, [account]);
  const payFeeInNative = useCallback(
    (request: FluentTokenTransferRequest) => {
      // The toast keeps the callback of the render that sent: `account` is the Send's account.
      if (currentAccount.current !== account) return;
      setSendRetry({ key: Date.now(), request });
      open();
    },
    [account, open],
  );
  const clearSendRetry = useCallback(() => setSendRetry(null), []);
  return { sendRetry, payFeeInNative, clearSendRetry };
}
