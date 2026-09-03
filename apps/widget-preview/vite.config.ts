import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@fluent.xyz/connect/styles.css": fileURLToPath(
        new URL("../../packages/connect/src/styles/globals.css", import.meta.url),
      ),
      // Wallet menu internals are not part of the public entry point, so the
      // preview reaches them through explicit aliases.
      "@fluent.xyz/connect/internal/WalletMenuActionCard": fileURLToPath(
        new URL("../../packages/connect/src/components/WalletMenuActionCard.tsx", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/FluentAccountDrawer": fileURLToPath(
        new URL("../../packages/connect/src/widget/components/FluentAccountDrawer.tsx", import.meta.url),
      ),
      // Overlays need the widget's portal root. Without it base-ui falls back to
      // a container of its own outside the React root, where React's delegated
      // events never fire and every control in a dialog is inert.
      "@fluent.xyz/connect/internal/drawer": fileURLToPath(
        new URL("../../packages/connect/src/components/ui/drawer.tsx", import.meta.url),
      ),
      "@fluent.xyz/connect/internal/portalContainer": fileURLToPath(
        new URL("../../packages/connect/src/widget/portalContainer.tsx", import.meta.url),
      ),
      // Directory alias: resolves any `internal/ui/<component>` import.
      "@fluent.xyz/connect/internal/ui": fileURLToPath(
        new URL("../../packages/connect/src/components/ui", import.meta.url),
      ),
      "@fluent.xyz/connect": fileURLToPath(
        new URL("../../packages/connect/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/connect-sdk": fileURLToPath(
        new URL("../../packages/connect-sdk/src/index.ts", import.meta.url),
      ),
      "@fluent.xyz/registry": fileURLToPath(
        new URL("../../packages/registry/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { port: 8070 },
});
