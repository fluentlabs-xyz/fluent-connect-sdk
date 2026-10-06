import { Buffer } from "buffer";

/**
 * Privy's embedded wallet calls `Buffer.from(...)` while signing, and a browser has no
 * `Buffer`: without this module the first signature fails with Privy's
 * `BUFFER_NOT_DEFINED`. The SDK provides the global so host apps need no polyfill of
 * their own.
 *
 * An existing `Buffer` is never replaced. The host app may have polyfilled it already,
 * and two implementations in one page are worse than either one.
 *
 * The assignment below is this module's whole purpose, so the module must survive a
 * consumer's production tree-shaking: it is listed in the package's `sideEffects` and
 * `tsup.config.ts` keeps it a live `import` in `dist/index.js` rather than inlining it.
 */
const globalWithBuffer = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};

if (globalWithBuffer.Buffer === undefined) {
  globalWithBuffer.Buffer = Buffer;
}
