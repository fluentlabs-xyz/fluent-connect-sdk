// Prepends `"use client";` to the built entries, because tsup cannot: its `banner` goes to
// esbuild, user plugins run before its tree-shaking pass, and that pass re-emits every chunk
// through Rollup, which strips module-level directives. Runs from tsup's `onSuccess`, after
// that pass, on every build and watch rebuild.
//
// Without the directive a Next.js App Router build evaluates the entry in its React Server
// Components graph and dies on `createContext`, so the widget cannot render on a server.
// `test/serverRender.node.test.ts` pins the result.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIRECTIVE = '"use client";\n';

// The two public entries. `dist/polyfills/buffer.js` needs none: it is only reached through
// `dist/index.js`, which this directive already places in the client graph.
const entries = ["../dist/index.js", "../dist/internal.js"];

for (const relative of entries) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const code = readFileSync(path, "utf8");
  // A watch rebuild rewrites the file, but keep the idempotence explicit: a doubled
  // directive is harmless to a bundler and baffling to a reader.
  if (code.startsWith(DIRECTIVE)) continue;
  writeFileSync(path, DIRECTIVE + code);

  // The directive is one generated line the map knows nothing about; an unmapped line at
  // the front of `mappings` (`;` separates generated lines) shifts the rest down past it.
  const mapPath = `${path}.map`;
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  map.mappings = `;${map.mappings}`;
  writeFileSync(mapPath, JSON.stringify(map));
}
