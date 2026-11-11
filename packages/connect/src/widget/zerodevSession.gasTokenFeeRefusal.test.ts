/**
 * Replays the Gas token cases of `zerodevSession.gasTokenFee.test.ts` with another ZeroDev
 * refusal, a fee below the paymaster's minimum: a first such refusal may spend the send's fee
 * retry, and a final one still rejects with `paymaster_rejected`.
 *
 * Fakes: those of `zerodevSession.gasTokenFee.test.ts`, with the refusal text of the paymaster's
 * `fetch` answers replaced.
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
