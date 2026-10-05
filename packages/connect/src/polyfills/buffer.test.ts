import { describe, expect, it, vi } from "vitest";

/**
 * Pins what the SDK promises about the `Buffer` global: importing the polyfill, or the package
 * entry that imports it, defines `globalThis.Buffer` when the host has none, and never replaces
 * a `Buffer` the host put there itself.
 *
 * The cases arrange the global, reset the module registry and import — in that order, because
 * the assignment under test is a module's top-level statement, which runs once per registry.
 * Each case puts the worker's own `Buffer` back afterwards, so no case can shape the next.
 *
 * `vitest.config.ts` explains why this file needs the `threads` pool and the one inlined
 * dependency. Under Node, `import { Buffer } from "buffer"` yields Node's own `Buffer` rather
 * than the npm package's: these cases pin the guard, and the npm implementation reaching a
 * browser bundle is what the Issue's packed-consumer fixture covers.
 */
/** `globalThis` as these cases treat it: a `Buffer` that may or may not be there, of any shape. */
const globalWithBuffer = globalThis as unknown as { Buffer?: unknown };

/** The `Buffer` the guard is expected to have left in the global. */
function polyfilledBuffer(): typeof Buffer {
  return globalWithBuffer.Buffer as typeof Buffer;
}

async function observing(arrange: () => void, observe: () => Promise<void>): Promise<void> {
  const workerBuffer = globalWithBuffer.Buffer;
  vi.resetModules();
  arrange();
  try {
    await observe();
  } finally {
    globalWithBuffer.Buffer = workerBuffer;
    vi.resetModules();
  }
}

const deleteGlobalBuffer = () => {
  delete globalWithBuffer.Buffer;
};

describe("the Buffer polyfill", () => {
  it("defines globalThis.Buffer when the host has none", async () => {
    await observing(deleteGlobalBuffer, async () => {
      await import("./buffer");

      // Presence alone would not do: Privy signs by calling `Buffer.from`, so the global has
      // to be a working implementation.
      expect(typeof globalWithBuffer.Buffer).toBe("function");
      expect(polyfilledBuffer().from("fluent", "utf8").toString("hex")).toBe("666c75656e74");
    });
  });

  it("leaves an existing globalThis.Buffer in place", async () => {
    // A host app that polyfilled Buffer itself keeps its own: two implementations in one page
    // are worse than either one.
    const hostBuffer = { from: () => "the host's own Buffer" };

    await observing(
      () => {
        globalWithBuffer.Buffer = hostBuffer;
      },
      async () => {
        await import("./buffer");

        expect(globalWithBuffer.Buffer).toBe(hostBuffer);
      },
    );
  });

  it("is reached by importing the package entry", async () => {
    // What a host app actually imports is the entry, so the entry is what has to define the
    // global: this case fails if `src/index.ts` loses its polyfill import.
    await observing(deleteGlobalBuffer, async () => {
      await import("../index");

      expect(typeof globalWithBuffer.Buffer).toBe("function");
      expect(polyfilledBuffer().from("fluent", "utf8").toString("hex")).toBe("666c75656e74");
    });
  });
});
