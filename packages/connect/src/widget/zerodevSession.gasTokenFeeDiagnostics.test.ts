/**
 * Replays the Gas token cases of `zerodevSession.gasTokenFee.test.ts` (a zero-start operation is
 * sponsored, neither the Gas token's `balanceOf` nor `stackup_getERC20TokenQuotes` is requested
 * before the sponsorship, a refusal keeps its code and `cause`) with debug logging on and a
 * host's `console.warn` that throws. The imported harness mirrors viem 2.52.0 and ZeroDev SDK
 * 5.5.10; `console.warn` is the only additional external fake. R4 requires a failing diagnostic
 * to leave execution intact.
 */
import { afterEach, beforeEach, vi } from "vitest";

import "./zerodevSession.gasTokenFee.test";

beforeEach(async () => {
  const { setDebugLogging } = await import("../core/debugLogger");
  setDebugLogging(true);
  vi.spyOn(console, "warn").mockImplementation(() => {
    throw new Error("the host's console.warn failed");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
