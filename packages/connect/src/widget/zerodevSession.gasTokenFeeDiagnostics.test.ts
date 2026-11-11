/**
 * Replays the Gas token cases of `zerodevSession.gasTokenFee.test.ts` with debug logging on and an
 * App's `console.warn` that throws: a failing diagnostic leaves the operation intact
 * (`docs/standards/widget-runtime.md` R4).
 *
 * Fakes: those of `zerodevSession.gasTokenFee.test.ts`, and `console.warn`, which throws.
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
