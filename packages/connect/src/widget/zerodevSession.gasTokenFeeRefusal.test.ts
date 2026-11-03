/**
 * Replays the frozen Gas token criteria with another ZeroDev refusal: a fee below the
 * paymaster's minimum. The imported harness mirrors viem 2.52.0 and ZeroDev SDK 5.5.10.
 * Its external boundaries stay the same; only the HTTP and JSON-RPC refusal text changes.
 * A first refusal may trigger the existing fee retry, but a final refusal still belongs to
 * the public `paymaster_rejected` contract of FLU-1711.
 */
import { beforeEach, vi } from "vitest";

import "./zerodevSession.gasTokenFee.test";

beforeEach(() => {
  const paymasterFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await paymasterFetch(...args);
    const body = await response.text();
    return new Response(
      body.replaceAll(
        "gas token is not supported by this paymaster",
        "maxFeePerGas must be at least 2000000000",
      ),
      { status: response.status, headers: response.headers },
    );
  });
});
