import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { appBackend } from "./server/appBackend";

// `http://localhost:5173` is the only localhost origin this Privy client allows: on any other port
// Direct login fails with `invalid_origin` and the login button does nothing. The other demos
// share the port, so run one at a time.
const DEFAULT_PORT = 5173;

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), appBackend()],
  resolve: {
    alias: {
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/connect/styles.css": fileURLToPath(
        new URL("../../packages/connect/src/styles/globals.css", import.meta.url),
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
