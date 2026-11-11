import { Buffer } from "buffer";

/**
 * Installs the `buffer` package's `Buffer` as the global when the page has none. Privy's
 * embedded wallet calls `Buffer.from(...)` while signing, and a browser has no `Buffer`: without
 * this module the first signature fails with Privy's `BUFFER_NOT_DEFINED`. It must run before
 * any Privy or ZeroDev module does, so it is the first import of `src/index.ts`, and an App
 * needs no polyfill of its own.
 *
 * An existing `Buffer` is never replaced: the App may have polyfilled it already, and two
 * implementations in one page are worse than either one.
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
