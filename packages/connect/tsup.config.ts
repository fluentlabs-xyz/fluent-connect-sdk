import { defineConfig, type Options } from "tsup";
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
  "posthog-js",
];

/** The source specifier of the Buffer polyfill, and the dist file it must point at. */
const POLYFILL_SPECIFIER = /^\.\/polyfills\/buffer$/;
const POLYFILL_DIST_SPECIFIER = "./polyfills/buffer.js";

/**
 * Keeps `src/polyfills/buffer.ts` a separate dist file that `dist/index.js` imports for its
 * side effect, instead of inlining its code into the entry bundle.
 *
 * Inlined, the top-level `globalThis.Buffer` assignment sits inside a bundle the package
 * declares side-effect-free, and a consumer's production tree-shaking is free to drop it —
 * which is the bug the polyfill exists to fix (FLU-1524). Marking the import external keeps
 * it a live `import "./polyfills/buffer.js"` in the output; the second entry below builds
 * the file it resolves to, and `sideEffects` in `package.json` protects that file.
 */
const livePolyfillImport: NonNullable<Options["esbuildPlugins"]>[number] = {
  name: "fluent-live-polyfill-import",
  setup(build) {
    build.onResolve({ filter: POLYFILL_SPECIFIER }, () => ({
      path: POLYFILL_DIST_SPECIFIER,
      external: true,
    }));
  },
};

const isWatch =
  process.env.npm_lifecycle_event === "dev" || process.argv.includes("--watch");

export default defineConfig({
  entry: ["src/index.ts", "src/polyfills/buffer.ts"],
  format: ["esm"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external,
  noExternal: ["@fluent.xyz/connect-sdk", "@fluent.xyz/registry"],
  esbuildPlugins: [livePolyfillImport],
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
