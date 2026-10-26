import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/styles.css": fileURLToPath(
        new URL("../../packages/connect/src/styles/globals.css", import.meta.url),
      ),
      // Internals of the package, outside its public entry: the demo reaches them by name.
      "@fluent.xyz/connect/internal/config": fileURLToPath(
        new URL("../../packages/connect/src/core/config.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/gasPayment": fileURLToPath(
        new URL("../../packages/connect/src/core/gasPayment.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/zerodevPaymaster": fileURLToPath(
        new URL("../../packages/connect/src/core/zerodevPaymaster.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/zerodevSession": fileURLToPath(
        new URL("../../packages/connect/src/widget/zerodevSession.ts", import.meta.url),
      ),
      "@fluent.xyz/connect": fileURLToPath(
        new URL("../../packages/connect/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/registry": fileURLToPath(
        new URL("../../packages/registry/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    // 5173 is the only localhost origin allowed to frame Privy, which the widget's in-page sign-in needs.
    port: 5173,
    strictPort: true,
    proxy: {
      "/chess-bot": {
        target: "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chess-bot/, ""),
      },
    },
  },
});
