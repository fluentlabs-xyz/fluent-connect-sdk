import { createPublicClient, http } from "viem";

import { CHAIN } from "./consts";

/**
 * One read-only client for the whole page.
 *
 * The widget keeps its own client for the balances behind its account menu, but does not
 * expose it, and every chain fact this bench states — token balances now, smart-account
 * deployment state next — has to be read rather than inferred. One client, so the page
 * never holds two views of the same chain.
 */
// Deliberately un-annotated: viem infers the chain-bound client type here, and widening it
// to `PublicClient` would drop the chain and stop the SDK's readers from accepting it.
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
});
