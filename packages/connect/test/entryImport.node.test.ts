// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const distEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The package entry must stay importable where no bundler sits in front of it
 * — SSR, plain Node scripts, Jest (FLU-1559). Vitest itself cannot prove that:
 * Vite transforms whatever these tests import and would quietly absorb a CSS
 * specifier, so the import under test runs in a child Node process instead.
 * CI builds `dist` before the test step (`turbo`'s `test` depends on `build`).
 */
describe("package entry in plain Node", () => {
  it("imports without a bundler", { timeout: 60_000 }, () => {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(distEntry).href)});`],
      { stdio: "pipe" },
    );
  });

  // The same 60 s as the import above, and for the same reason: this one also spawns Node and
  // loads the whole built entry, which is slower than Vitest's default five seconds under load.
  it("exports the config error a builder branches on", { timeout: 60_000 }, () => {
    // `FluentWidgetConfigError` is public API (FLU-1591): a host that passes an unsupported
    // `execution` value catches it and reads `code`, so the name has to be on the built entry
    // and not only in `src/index.ts`.
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const entry = await import(${JSON.stringify(pathToFileURL(distEntry).href)});
         const error = new entry.FluentWidgetConfigError("invalid_fee_source", "nope");
         console.log([typeof entry.FluentWidgetConfigError, error.name, error.code].join(" "));`,
      ],
      { stdio: "pipe", encoding: "utf8", timeout: 60_000 },
    );
    expect(output.trim().split("\n").at(-1)).toBe(
      "function FluentWidgetConfigError invalid_fee_source",
    );
  });

  it("carries no stylesheet import", () => {
    // The specifier itself is the regression: Node dies on it before the
    // module even runs, and Jest tries to parse the CSS file as JavaScript.
    const entry = readFileSync(distEntry, "utf8");
    expect(entry).not.toMatch(/import\s*["'][^"']*\.css["']|from\s*["'][^"']*\.css["']/);
  });
});
