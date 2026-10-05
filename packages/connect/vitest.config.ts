import { defineConfig } from "vitest/config";

/**
 * The suite ran on Vitest's defaults until the Buffer polyfill arrived (FLU-1524). Its tests
 * (`src/polyfills/buffer.test.ts`) delete `globalThis.Buffer` and then import the SDK, and two
 * defaults stand in the way of that; both options below exist for those tests, and the other
 * 585 tests pass with or without them.
 */
export default defineConfig({
  test: {
    /**
     * The default `forks` pool cannot run with `Buffer` deleted: it fetches every module its
     * workers load over an IPC channel whose `v8.deserialize` reads the `Buffer` global, so the
     * import under test never returns, and its error serializer dies on `val instanceof Buffer`
     * when a stand-in sits in the global's place. The `threads` pool talks to its workers over a
     * `MessagePort` and leaves the global alone.
     */
    pool: "threads",
    server: {
      deps: {
        /**
         * `@swapper-finance/deposit-sdk@0.2.14` is an ESM package whose files import each other
         * without file extensions (`export { SwapperIframe } from "./SwapperIframe"`), which
         * Node's ESM resolver rejects. Vitest externalizes dependencies to Node by default, so
         * importing `src/index.ts` — which reaches the package through `WalletMenuActionCard` —
         * failed on that specifier. Inlining hands the package to Vite, which resolves it the way
         * every consumer's bundler does.
         */
        inline: ["@swapper-finance/deposit-sdk"],
      },
    },
  },
});
