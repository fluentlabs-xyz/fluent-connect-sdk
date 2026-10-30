import { encodeFunctionData, erc20Abi, zeroAddress, type Address } from "viem";

import { formatAmount } from "../components/AmountForm";
import type { FluentBatchCallInput } from "../widget/batchOperation";
import { fluentSwapRouterAbi } from "./abi";
import {
  FLUENT_SWAP_DEADLINE_MINUTES,
  FLUENT_SWAP_SLIPPAGE_BPS,
  type FluentSwapContracts,
} from "./contracts";
import { encodeFluentSwapPath } from "./path";
import type { FluentSwapQuote } from "./quote";
import { applyFluentSwapSlippage, getFluentSwapDeadline } from "./slippage";
import { isNativeFluentSwapToken } from "./tokens";

/**
 * Names the batch operation a Fluent swap builds, the way
 * `FLUENT_SEND_TOKEN_OP_ID` names a Send: every widget operation reaches the
 * chain through the same `createBatchOp`, and the id is how one of them can be
 * told from a host app's afterwards.
 */
export const FLUENT_SWAP_OP_ID = "fluent-swap";

export type FluentSwapCalls = {
  /** The approval, where the input is an ERC-20, followed by the router call. */
  calls: FluentBatchCallInput[];
  /** The least the swap may deliver; below it the router reverts. */
  minimumOut: bigint;
};

/**
 * The calls that execute `quote` for `recipient`, in the order one UserOperation
 * runs them: an allowance for exactly what the router is about to pull, then the
 * swap.
 *
 * A native output cannot be sent straight to `recipient` — the pool pays in
 * WETH9 — so the swap keeps its output at the router (`address(0)`) and
 * `unwrapWETH9` forwards the coin on, both inside the router's own `multicall`
 * so the pair cannot come apart.
 */
export function buildFluentSwapCalls({
  quote,
  contracts,
  recipient,
  slippageBps = FLUENT_SWAP_SLIPPAGE_BPS,
  deadlineMinutes = FLUENT_SWAP_DEADLINE_MINUTES,
}: {
  quote: FluentSwapQuote;
  contracts: FluentSwapContracts;
  /** Who the bought token is credited to — the Fluent ID holding the input. */
  recipient: Address;
  slippageBps?: bigint;
  deadlineMinutes?: number;
}): FluentSwapCalls {
  const { tokenIn, tokenOut, amountIn, route } = quote;
  const nativeIn = isNativeFluentSwapToken(tokenIn);
  const nativeOut = isNativeFluentSwapToken(tokenOut);
  const minimumOut = applyFluentSwapSlippage(quote.amountOut, slippageBps);
  const deadline = getFluentSwapDeadline(deadlineMinutes);
  const swapRecipient = nativeOut ? zeroAddress : recipient;

  const [single] = route;
  const swap =
    route.length === 1 && single
      ? ({
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: single.tokenIn,
              tokenOut: single.tokenOut,
              fee: single.fee,
              recipient: swapRecipient,
              deadline,
              amountIn,
              amountOutMinimum: minimumOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
        } as const)
      : ({
          functionName: "exactInput",
          args: [
            {
              path: encodeFluentSwapPath(route),
              recipient: swapRecipient,
              deadline,
              amountIn,
              amountOutMinimum: minimumOut,
            },
          ],
        } as const);

  const sold = `${formatAmount(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`;
  const label = `Swap ${sold} for ${tokenOut.symbol}`;
  const routerCall: FluentBatchCallInput = nativeOut
    ? {
        id: FLUENT_SWAP_OP_ID,
        label,
        to: contracts.router,
        value: nativeIn ? amountIn : 0n,
        abi: fluentSwapRouterAbi,
        method: "multicall",
        args: [
          [
            encodeFunctionData({ abi: fluentSwapRouterAbi, ...swap }),
            encodeFunctionData({
              abi: fluentSwapRouterAbi,
              functionName: "unwrapWETH9",
              args: [minimumOut, recipient],
            }),
          ],
        ],
      }
    : {
        id: FLUENT_SWAP_OP_ID,
        label,
        to: contracts.router,
        value: nativeIn ? amountIn : 0n,
        abi: fluentSwapRouterAbi,
        method: swap.functionName,
        args: swap.args,
      };

  if (nativeIn || !tokenIn.address) {
    return { calls: [routerCall], minimumOut };
  }

  // Exactly what the router is about to pull, never a blanket maximum: the
  // habit a widget teaches is the habit its users keep.
  const approval: FluentBatchCallInput = {
    id: FLUENT_SWAP_OP_ID,
    label: `Approve ${sold}`,
    to: tokenIn.address,
    abi: erc20Abi,
    method: "approve",
    args: [contracts.router, amountIn],
  };

  return { calls: [approval, routerCall], minimumOut };
}
