import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 is the only localhost origin allowed to frame Privy, which `authMode: "direct"` requires.
    port: 5173,
    strictPort: true,
    proxy: {
      "/chess-bot": {
        target: "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chess-bot/, ""),
      },
    },
  },
});
