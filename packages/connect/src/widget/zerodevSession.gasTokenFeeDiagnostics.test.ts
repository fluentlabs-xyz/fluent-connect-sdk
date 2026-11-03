/**
 * Replays the frozen unreadable-balance/quote criteria when a host's console throws.
 * The imported harness mirrors viem 2.52.0 and ZeroDev SDK 5.5.10. The only additional
 * external fake is console.warn: R4 requires diagnostic failures to leave execution intact,
 * including when debugLogging is enabled.
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
