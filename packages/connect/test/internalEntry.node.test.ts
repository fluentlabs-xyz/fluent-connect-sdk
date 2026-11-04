// @vitest-environment node
/**
 * The Internal entry, `@fluent.xyz/connect/internal`, is importable in plain Node and carries
 * the helpers `docs/internal.md` lists (ADR 0008). Not a lock: the list below changes together
 * with `src/internal.ts` and the guide, and says what a host finds there today. Like
 * `entryImport.node.test.ts`, the import runs in a child Node process, so no bundler can absorb
 * a specifier the entry cannot resolve; CI builds `dist` before the test step. Nothing is faked.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const distEntry = fileURLToPath(new URL("../dist/internal.js", import.meta.url));
const distTypes = fileURLToPath(new URL("../dist/internal.d.ts", import.meta.url));
const manifest = fileURLToPath(new URL("../package.json", import.meta.url));

/** The values the entry exports today, and what the guide's table names. */
const VALUES = [
  "buildFluentBridgeUrl",
  "buildFluentTransferCall",
  "createFluentFamiliesClient",
  "fluentMainnetTokenDefaults",
  "fluentTestnetTokenDefaults",
  "fluentTokenIdentity",
  "fluentTransferAbi",
  "getFluentDefaultWidgetDisplayTokens",
  "getFluentExplorerBaseUrl",
  "getFluentTokenDefaultsForNetwork",
  "isFaucetNetwork",
  "isFluentNativeToken",
  "normalizeFluentWidgetNetwork",
  "parseFluentTransferAmount",
  "parseFluentTransferRecipient",
  "readFluentTokenBalances",
];

describe("the Internal entry in plain Node", () => {
  it("is the ./internal subpath of the package", () => {
    const { exports } = JSON.parse(readFileSync(manifest, "utf8")) as {
      exports: Record<string, { types?: string; import?: string }>;
    };
    expect(exports["./internal"]).toEqual({
      types: "./dist/internal.d.ts",
      import: "./dist/internal.js",
    });
    expect(existsSync(distTypes)).toBe(true);
  });

  const slow = { timeout: 60_000 };
  it("imports without a bundler and exports the helpers the guide lists", slow, () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const entry = await import(${JSON.stringify(pathToFileURL(distEntry).href)});
         console.log(JSON.stringify(Object.keys(entry).sort()));`,
      ],
      { stdio: "pipe", encoding: "utf8", timeout: 60_000 },
    );
    expect(JSON.parse(output.trim())).toEqual(VALUES);
  });

  it("needs no Buffer global, so it imports no polyfill", () => {
    expect(readFileSync(distEntry, "utf8")).not.toContain("polyfills/buffer");
  });
});
