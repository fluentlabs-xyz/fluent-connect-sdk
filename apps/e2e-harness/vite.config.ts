import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/*
 * Packages resolve to their source, as in the other demos, and the stylesheet to the
 * built `dist/fluent-connect.css`, the file integrators install: build
 * `@fluent.xyz/connect` first. The port is free to choose: nothing here reaches
 * Privy, so the 5173 origin allow-list never applies.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["@privy-io/react-auth"],
    alias: {
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/styles.css": fileURLToPath(
        new URL("../../packages/connect/dist/fluent-connect.css", import.meta.url),
      ),
      "@fluent.xyz/connect": fileURLToPath(
        new URL("../../packages/connect/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/registry": fileURLToPath(
        new URL("../../packages/registry/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { port: 5190, strictPort: true },
  preview: { port: 5190, strictPort: true },
});
