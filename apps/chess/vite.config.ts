import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@fluent/react": fileURLToPath(
        new URL("../../packages/react/src/index.ts", import.meta.url),
      ),
      "@fluent/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent/registry": fileURLToPath(
        new URL("../../packages/registry/src/index.ts", import.meta.url),
      ),
      "@fluent/wallet-sdk": fileURLToPath(
        new URL("../../packages/wallet-sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 8050,
    proxy: {
      "/chess-bot": {
        target: "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chess-bot/, ""),
      },
    },
  },
});
