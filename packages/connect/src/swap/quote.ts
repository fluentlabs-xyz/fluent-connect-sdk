import type { Address, PublicClient } from "viem";

import type { FluentWidgetNetwork } from "../core/network";
import { fluentSwapQuoterAbi } from "./abi";
import {
  FLUENT_SWAP_FEE_TIERS,
  type FluentSwapContracts,
  type FluentSwapFeeTier,
} from "./contracts";
import { encodeFluentSwapPath, type FluentSwapHop } from "./path";
import {
  findFluentSwapToken,
  FLUENT_SWAP_ROUTE_HOP_SYMBOLS,
  getFluentSwapPathAddress,
  type FluentSwapToken,
} from "./tokens";

/**
 * Why a Fluent swap cannot be quoted or built. Carried as a `code` so a caller
 * branches on the reason rather than on the message, the shape
 * `FluentSettingsError` set for errors this package raises.
 */
export type FluentSwapErrorCode = "unsupported_network" | "same_token" | "no_route";

export class FluentSwapError extends Error {
  readonly code: FluentSwapErrorCode;

  constructor(code: FluentSwapErrorCode, message: string) {
    super(message);
    this.name = "FluentSwapError";
    this.code = code;
  }
}

/** What a given input buys right now, and through which pools. */
export type FluentSwapQuote = {
  tokenIn: FluentSwapToken;
  tokenOut: FluentSwapToken;
  amountIn: bigint;
  /** What the pools would hand out at the price they stand at; not a guarantee. */
  amountOut: bigint;
  route: readonly FluentSwapHop[];
};

/**
 * Every pool path worth asking about: each fee tier of the direct pair, then
 * each pair of fee tiers through one hop token. The quoter prices them all in
 * one request, so breadth costs a bigger multicall rather than more round trips.
 */
function buildCandidateRoutes(
  network: FluentWidgetNetwork,
  contracts: FluentSwapContracts,
  tokenIn: Address,
  tokenOut: Address,
): FluentSwapHop[][] {
  const routes: FluentSwapHop[][] = FLUENT_SWAP_FEE_TIERS.map((fee) => [
    { tokenIn, tokenOut, fee },
  ]);

  for (const symbol of FLUENT_SWAP_ROUTE_HOP_SYMBOLS) {
    const hopToken = findFluentSwapToken(network, symbol);
    if (!hopToken) continue;
    const hop = getFluentSwapPathAddress(hopToken, contracts);
    if (hop === tokenIn || hop === tokenOut) continue;

    for (const firstFee of FLUENT_SWAP_FEE_TIERS) {
      for (const secondFee of FLUENT_SWAP_FEE_TIERS) {
        routes.push([
          { tokenIn, tokenOut: hop, fee: firstFee },
          { tokenIn: hop, tokenOut, fee: secondFee },
        ]);
      }
    }
  }

  return routes;
}

function buildQuoteCall(
  quoter: Address,
  route: readonly FluentSwapHop[],
  amountIn: bigint,
) {
  const [single] = route;
  if (route.length === 1 && single) {
    return {
      address: quoter,
      abi: fluentSwapQuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: single.tokenIn,
          tokenOut: single.tokenOut,
          amountIn,
          fee: single.fee as FluentSwapFeeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
    } as const;
  }
  return {
    address: quoter,
    abi: fluentSwapQuoterAbi,
    functionName: "quoteExactInput",
    args: [encodeFluentSwapPath(route), amountIn],
  } as const;
}

/**
 * Prices `amountIn` of `tokenIn` in `tokenOut` and returns the best route of
 * those FluxFlow has a pool for.
 *
 * @throws {FluentSwapError} `same_token` when both sides are the same token,
 * and `no_route` when no candidate pool answered — a pair FluxFlow has no
 * liquidity for, which is a true answer and not a failed request.
 */
export async function getFluentSwapQuote({
  client,
  network,
  contracts,
  tokenIn,
  tokenOut,
  amountIn,
}: {
  client: PublicClient;
  network: FluentWidgetNetwork;
  contracts: FluentSwapContracts;
  tokenIn: FluentSwapToken;
  tokenOut: FluentSwapToken;
  amountIn: bigint;
}): Promise<FluentSwapQuote> {
  if (tokenIn.symbol === tokenOut.symbol) {
    throw new FluentSwapError("same_token", `${tokenIn.symbol} cannot be swapped for itself`);
  }

  const pathIn = getFluentSwapPathAddress(tokenIn, contracts);
  const pathOut = getFluentSwapPathAddress(tokenOut, contracts);
  const routes = buildCandidateRoutes(network, contracts, pathIn, pathOut);
  const results = await client.multicall({
    allowFailure: true,
    multicallAddress: contracts.multicall,
    contracts: routes.map((route) => buildQuoteCall(contracts.quoter, route, amountIn)),
  });

  let best: { route: readonly FluentSwapHop[]; amountOut: bigint } | undefined;

  results.forEach((result, index) => {
    const route = routes[index];
    if (!route || result.status !== "success") return;
    // Both quote functions answer with the amount first; what follows differs
    // between them and is not read, so only the first position is named.
    const [amountOut] = result.result as readonly [bigint, ...unknown[]];
    if (amountOut <= 0n) return;
    if (!best || amountOut > best.amountOut) {
      best = { route, amountOut };
    }
  });

  if (!best) {
    throw new FluentSwapError(
      "no_route",
      `There is no ${tokenIn.symbol} to ${tokenOut.symbol} liquidity on Fluent right now`,
    );
  }

  return { tokenIn, tokenOut, amountIn, amountOut: best.amountOut, route: best.route };
}
