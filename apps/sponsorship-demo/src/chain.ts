import { createPublicClient, http } from "viem";

import { CHAIN } from "./consts";

/**
 * The page's one read-only client. The widget does not expose its own, and every chain fact the
 * bench states is read rather than inferred.
 */
// Deliberately un-annotated: viem infers the chain-bound client type here, and widening it
// to `PublicClient` would drop the chain and stop the SDK's readers from accepting it.
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
});
