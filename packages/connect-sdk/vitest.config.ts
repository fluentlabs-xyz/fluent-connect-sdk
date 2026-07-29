import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fluent.xyz/registry": fileURLToPath(new URL("../registry/src/index.ts", import.meta.url)),
    },
  },
});
