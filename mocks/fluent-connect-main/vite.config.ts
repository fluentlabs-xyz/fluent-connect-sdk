import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@fluent/wallet-sdk": fileURLToPath(
        new URL("../../packages/wallet-sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
});
