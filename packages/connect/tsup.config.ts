import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

const connectSdkEntry = fileURLToPath(
  new URL("../connect-sdk/src/index.ts", import.meta.url),
);
const registryEntry = fileURLToPath(
  new URL("../registry/src/index.ts", import.meta.url),
);

const external = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@privy-io/react-auth",
  "@zerodev/sdk",
  "@zerodev/ecdsa-validator",
  "@zerodev/permissions",
  "@zerodev/permissions/policies",
  "@reown/appkit",
  "@reown/appkit-adapter-wagmi",
  "@swapper-finance/deposit-sdk",
  "@tanstack/react-query",
  "wagmi",
  "viem",
  "radix-ui",
  "@base-ui/react",
  "lucide-react",
];

const isWatch =
  process.env.npm_lifecycle_event === "dev" || process.argv.includes("--watch");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external,
  noExternal: ["@fluent.xyz/connect-sdk", "@fluent.xyz/registry"],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      "@fluent.xyz/connect-sdk": connectSdkEntry,
      "@fluent.xyz/registry": registryEntry,
    };
    options.loader = {
      ...(options.loader ?? {}),
      ".svg": "dataurl",
      ".png": "dataurl",
    };
  },
});
