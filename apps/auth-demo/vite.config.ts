import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { partnerBackend } from "./server/partnerBackend";

// `http://localhost:5173` is the only localhost origin allowed for this Privy client, so
// this default is load-bearing rather than a preference: on any other port direct auth
// fails with `invalid_origin`, and it fails silently — the login button simply no-ops.
// `apps/erc4626-vault` and `apps/chess` share the port. Run one of them at a time; do not
// resolve the clash by picking a free port, because a free port is what breaks login.
const DEFAULT_PORT = 5173;

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), partnerBackend()],
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
