import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// `http://localhost:5173` is the only localhost origin this Privy client allows: on any other port
// Direct login fails with `invalid_origin` and the login button does nothing. The other demos
// share the port, so run one at a time.
const DEFAULT_PORT = 5173;

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    // One copy of Privy: with `@fluent.xyz/connect` aliased to source, the widget's
    // `PrivyProvider` and this app's `usePrivy` would resolve from different `node_modules`, and
    // `usePrivy()` would throw "wrap your application with <PrivyProvider>".
    dedupe: ["@privy-io/react-auth"],
    alias: {
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/styles.css": fileURLToPath(
        new URL("../../packages/connect/src/styles/globals.css", import.meta.url),
      ),
      // Internals of the package, outside its public entry: the demo reaches them by name.
      "@fluent.xyz/connect/internal/network": fileURLToPath(
        new URL("../../packages/connect/src/core/network.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/zerodevPaymaster": fileURLToPath(
        new URL("../../packages/connect/src/core/zerodevPaymaster.ts", import.meta.url),
      ),
      "@fluent.xyz/connect": fileURLToPath(
        new URL("../../packages/connect/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/registry": fileURLToPath(
        new URL("../../packages/registry/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { port: Number(process.env.VITE_PORT ?? DEFAULT_PORT) },
});
