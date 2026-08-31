import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/*
 * No Tailwind plugin, and the app ships no reset of its own: browser defaults are
 * the control group, and a reset here would hide the leaks this app exists to
 * show. `styles.css` resolves to the built `dist/fluent-connect.css` because that
 * is what integrators install — rebuild it after changing any stylesheet.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
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
  server: { port: 5180 },
});
