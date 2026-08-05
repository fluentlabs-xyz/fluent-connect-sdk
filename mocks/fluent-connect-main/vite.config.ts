import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
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
    port: 5173,
  },
});
