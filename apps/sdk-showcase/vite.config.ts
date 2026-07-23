import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsDir: "showcase-assets",
  },
  resolve: {
    alias: {
      "@fluent/react/styles.css": fileURLToPath(
        new URL("../../packages/react/src/styles/globals.css", import.meta.url),
      ),
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
  server: { port: 8060 },
});
