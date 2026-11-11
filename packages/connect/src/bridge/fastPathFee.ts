import type { Address, PublicClient } from "viem";

import { fastPathPortalAbi } from "./abi";

/** The portal's payload type for a plain token transfer. */
const TOKEN_PAYLOAD_TYPE = 0;

/**
 * The floors, in wei per destination chain id, that the Portal's `getFastPathFee.ts` applies to
 * the quoted fee for Ethereum → Fluent: a quote below the floor can be too low to relay, so the
 * fee is never taken below it.
 */
const FAST_PATH_FEE_FLOOR_WEI: Record<number, bigint> = {
  25363: 284_853_250_305_024n,
};

/**
 * Reads what the fast-path portal charges to carry a token to `destinationChainId`, in the
 * Portal's three steps: the short `quote`, then `quote` with the default adapter when that
 * reverts, then the floor when both do. Throws the last read's error when both fail and the
 * chain has no floor.
 */
export async function readFastPathFeeWei(
  client: PublicClient,
  portal: Address,
  destinationChainId: number,
): Promise<bigint> {
  const floor = FAST_PATH_FEE_FLOOR_WEI[destinationChainId];
  const withFloor = (fee: bigint) => (floor !== undefined && fee < floor ? floor : fee);

  try {
    const fee = await client.readContract({
      address: portal,
      abi: fastPathPortalAbi,
      functionName: "quote",
      args: [destinationChainId, TOKEN_PAYLOAD_TYPE],
    });
    return withFloor(fee);
  } catch {
    // fall through to the adapter-qualified quote
  }

  try {
    const adapter = await client.readContract({
      address: portal,
      abi: fastPathPortalAbi,
      functionName: "defaultBridgeAdapter",
      args: [destinationChainId],
    });
    const fee = await client.readContract({
      address: portal,
      abi: fastPathPortalAbi,
      functionName: "quote",
      args: [destinationChainId, TOKEN_PAYLOAD_TYPE, adapter],
    });
    return withFloor(fee);
  } catch (error) {
    if (floor !== undefined) return floor;
    throw error;
  }
}
