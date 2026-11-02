/**
 * The version a promoted stable artifact reports in analytics. The release run under test
 * promotes 0.6.0-rc.1 to 0.6.0; this test takes the manifest from the archive npm received,
 * rebuilds the package's analytics module from this repository's source with that manifest
 * (esbuild, as tsup builds the package) and records the event the module emits.
 *
 * Fakes: the release boundaries of `test/fakes.ts`, and `posthog-js`, replaced in the rebuilt
 * copy's `node_modules` by a module whose `init` returns a client that records `capture` calls
 * (posthog-js 1.x: `posthog.init(token, config, name)` returns the named instance).
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync,
  writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createWorld } from "./test/fixtures.ts";
import { dispatch, REPO_ROOT } from "./test/workflow.ts";

const PACKAGE_DIR = join(REPO_ROOT, "packages/connect");

type Captured = Array<{ name: string; props: Record<string, unknown> }>;

/** Rebuilds `src/core/analytics.ts` against `manifest` and returns the emitted events. */
async function emitWith(manifest: string): Promise<Captured> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sdk-version-")));
  const copy = join(root, "packages/connect");
  mkdirSync(copy, { recursive: true });
  cpSync(join(PACKAGE_DIR, "src"), join(copy, "src"), { recursive: true });
  writeFileSync(join(copy, "package.json"), manifest);
  for (const sibling of ["connect-sdk", "registry"]) {
    symlinkSync(join(REPO_ROOT, "packages", sibling), join(root, "packages", sibling));
  }
  mkdirSync(join(copy, "node_modules"));
  for (const name of readdirSync(join(PACKAGE_DIR, "node_modules"))) {
    if (name === "posthog-js" || name.startsWith(".")) continue;
    symlinkSync(join(PACKAGE_DIR, "node_modules", name), join(copy, "node_modules", name));
  }
  const fake = join(copy, "node_modules/posthog-js");
  mkdirSync(fake);
  writeFileSync(join(fake, "package.json"),
    JSON.stringify({ name: "posthog-js", type: "module", main: "index.js" }));
  writeFileSync(join(fake, "index.js"), [
    "const captured = (globalThis.__fluentReleaseCaptured ??= []);",
    "const capture = (name, props) => captured.push({ name, props });",
    "export default { init: () => ({ capture }) };",
  ].join("\n"));

  const tsup = createRequire(join(PACKAGE_DIR, "package.json")).resolve("tsup");
  const esbuild = createRequire(tsup)("esbuild") as typeof import("esbuild");
  const outfile = join(copy, "out/analytics.mjs");
  await esbuild.build({
    entryPoints: [join(copy, "src/core/analytics.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    alias: {
      "@fluent.xyz/connect-sdk": join(root, "packages/connect-sdk/src/index.ts"),
      "@fluent.xyz/registry": join(root, "packages/registry/src/index.ts"),
    },
    loader: { ".svg": "dataurl", ".png": "dataurl" },
    logLevel: "error",
  });

  // A separate Node process imports the rebuilt module, as a consumer's runtime would; the
  // test runner's own module loader does not serve files outside the repository.
  const probe = join(copy, "out/probe.mjs");
  writeFileSync(probe, [
    `import { createTracker } from ${JSON.stringify(pathToFileURL(outfile).href)};`,
    "globalThis.__fluentReleaseCaptured = [];",
    "const track = createTracker({ appId: \"release-test\", network: \"testnet\",",
    "  analyticsHost: \"https://analytics.invalid\", disableAnalytics: false });",
    "track(\"sdk_version_probe\");",
    "// posthog-js is imported on demand; the event leaves once that import settles.",
    "const deadline = Date.now() + 10000;",
    "while (globalThis.__fluentReleaseCaptured.length === 0 && Date.now() < deadline) {",
    "  await new Promise((resolve) => setImmediate(resolve));",
    "}",
    "process.stdout.write(JSON.stringify(globalThis.__fluentReleaseCaptured));",
  ].join("\n"));
  const output = execFileSync(process.execPath, [probe], { encoding: "utf8" });
  return JSON.parse(output) as Captured;
}

describe("SDK-VERSION", () => {
  it("an analytics event from the promoted stable artifact reports the promoted version",
    async () => {
      const world = createWorld({ version: "0.6.0-rc.1", approvals: ["approve", "approve"] });
      await dispatch(world, { inputs: { expected_version: "0.6.0-rc.1", dry_run: false } });
      const published = world.trace.find(
        (m) => m.kind === "npm_publish" && m.detail.version === "0.6.0");
      const archive = world.packs.find((p) => p.integrity === published?.detail.integrity)
        ?.archive;
      expect(archive?.version).toBe("0.6.0");
      const manifest = archive?.buildInput["packages/connect/package.json"] ?? "";

      const events = await emitWith(manifest);
      expect(events[0]?.props.sdk_version).toBe("0.6.0");
      expect(events[0]?.props.sdk_version).toBe(
        (JSON.parse(manifest) as { version: string }).version);
    });
});
