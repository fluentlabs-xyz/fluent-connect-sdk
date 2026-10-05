import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/jsdomPolyfills.ts"],
    server: {
      deps: {
        // Vite's resolver, not Node's, for this one dependency: its published
        // ESM imports `./dist/SwapperIframe` without a file extension, which
        // Node refuses to resolve and the bundler every other consumer goes
        // through resolves fine. Inlining it lets the components that import it
        // be rendered in a test at all.
        inline: ["@swapper-finance/deposit-sdk"],
      },
    },
  },
});
