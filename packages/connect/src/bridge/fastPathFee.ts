import type { Address, PublicClient } from "viem";

import { fastPathPortalAbi } from "./abi";

/** The portal's payload type for a plain token transfer. */
const TOKEN_PAYLOAD_TYPE = 0;

/**
 * Floors, in wei, the Portal applies to the quoted fee for Ethereum → Fluent:
 * the quote has come back too low to be relayed, so it is never trusted below
 * this. Lifted verbatim from the Portal's `getFastPathFee.ts`.
 */
const FAST_PATH_FEE_FLOOR_WEI: Record<number, bigint> = {
  25363: 284_853_250_305_024n,
};

/**
 * What the fast-path portal charges to carry a token to `destinationChainId`.
 * Same three-step read as the Portal: the short `quote`, then `quote` with the
 * default adapter when that reverts, then the floor when both do.
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
