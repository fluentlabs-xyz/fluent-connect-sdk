import { decodeFunctionData, getAddress, parseEther, parseUnits, zeroAddress } from "viem";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import { fluentSwapRouterAbi } from "./abi";
import { buildFluentSwapCalls } from "./calls";
import { getFluentSwapContracts } from "./contracts";
import { applyFluentSwapSlippage } from "./slippage";
import { findFluentSwapToken, type FluentSwapToken } from "./tokens";
import type { FluentSwapQuote } from "./quote";

const contracts = getFluentSwapContracts("mainnet")!;
const recipient = getAddress("0x1111111111111111111111111111111111111111");

const eth = findFluentSwapToken("mainnet", "ETH")!;
const usdnr = findFluentSwapToken("mainnet", "USDnr")!;
const blend = findFluentSwapToken("mainnet", "BLEND")!;

function quoteFor({
  tokenIn,
  tokenOut,
  amountIn,
  amountOut,
  hops = 1,
}: {
  tokenIn: FluentSwapToken;
  tokenOut: FluentSwapToken;
  amountIn: bigint;
  amountOut: bigint;
  hops?: 1 | 2;
}): FluentSwapQuote {
  const pathIn = tokenIn.address ?? contracts.weth9;
  const pathOut = tokenOut.address ?? contracts.weth9;
  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    route:
      hops === 1
        ? [{ tokenIn: pathIn, tokenOut: pathOut, fee: 3_000 }]
        : [
            { tokenIn: pathIn, tokenOut: contracts.weth9, fee: 3_000 },
            { tokenIn: contracts.weth9, tokenOut: pathOut, fee: 500 },
          ],
  };
}

/** The inner calls of the router's own `multicall`, decoded. */
function innerCalls(args: readonly unknown[]) {
  const [batch] = args as readonly [readonly Hex[]];
  return batch.map((data) => decodeFunctionData({ abi: fluentSwapRouterAbi, data }));
}

describe("buildFluentSwapCalls", () => {
  it("sends the coin with the call when the input is ETH, and asks for no allowance", () => {
    const amountIn = parseEther("0.01");
    const { calls, minimumOut } = buildFluentSwapCalls({
      quote: quoteFor({ tokenIn: eth, tokenOut: usdnr, amountIn, amountOut: 30_000_000n }),
      contracts,
      recipient,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe(contracts.router);
    expect(calls[0]?.value).toBe(amountIn);
    expect(calls[0]?.method).toBe("exactInputSingle");
    expect(minimumOut).toBe(applyFluentSwapSlippage(30_000_000n, 50n));
  });

  it("approves exactly what the router will pull, before the swap", () => {
    const amountIn = parseUnits("25", usdnr.decimals);
    const { calls } = buildFluentSwapCalls({
      quote: quoteFor({ tokenIn: usdnr, tokenOut: blend, amountIn, amountOut: parseEther("4") }),
      contracts,
      recipient,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.to).toBe(usdnr.address);
    expect(calls[0]?.method).toBe("approve");
    expect(calls[0]?.args).toEqual([contracts.router, amountIn]);
    // An ERC-20 input carries no coin with it.
    expect(calls[1]?.value).toBe(0n);
    expect(calls[1]?.to).toBe(contracts.router);
  });

  it("uses the path form once a route needs a hop", () => {
    const { calls } = buildFluentSwapCalls({
      quote: quoteFor({
        tokenIn: usdnr,
        tokenOut: blend,
        amountIn: parseUnits("25", usdnr.decimals),
        amountOut: parseEther("4"),
        hops: 2,
      }),
      contracts,
      recipient,
    });

    expect(calls[1]?.method).toBe("exactInput");
  });

  it("keeps a native output at the router and unwraps it to the recipient", () => {
    const amountOut = parseEther("0.01");
    const { calls, minimumOut } = buildFluentSwapCalls({
      quote: quoteFor({
        tokenIn: usdnr,
        tokenOut: eth,
        amountIn: parseUnits("30", usdnr.decimals),
        amountOut,
      }),
      contracts,
      recipient,
    });

    const router = calls[1];
    expect(router?.method).toBe("multicall");
    const decoded = innerCalls(router?.args ?? []);
    expect(decoded.map((call) => call.functionName)).toEqual([
      "exactInputSingle",
      "unwrapWETH9",
    ]);
    // The pool pays in WETH9, so the swap's own recipient is the router.
    const [swapParams] = decoded[0]?.args as readonly [{ recipient: string }];
    expect(swapParams.recipient).toBe(zeroAddress);
    expect(decoded[1]?.args).toEqual([minimumOut, recipient]);
  });
});
