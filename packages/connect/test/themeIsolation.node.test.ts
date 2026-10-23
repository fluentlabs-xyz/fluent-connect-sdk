// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const distCss = readFileSync(fileURLToPath(new URL("../dist/fluent-connect.css", import.meta.url)), "utf8");
const widgetTheme = readFileSync(fileURLToPath(new URL("../src/styles/theme.css", import.meta.url)), "utf8");
const tailwindTheme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");

const declaredNames = (css: string) => [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);

/**
 * Tailwind's theme and the widget's `@theme` use the names a host's own tokens use, and a
 * host's unlayered declaration of one of them beats anything in this package's layers. So
 * the theme is imported `theme(reference inline)`: utilities carry the values, and nothing is
 * written on `:root` for a host to override or to be overridden by. Whatever the built CSS
 * still reads by `var()` is redeclared on `.fluent-root` (`theme.css`). Reads the built sheet,
 * as the entry import test does: CI builds `dist` before the test step.
 */
describe("built stylesheet", () => {
  it("writes no theme on :root", () => {
    expect(distCss).not.toMatch(/:root,:host\{/);
  });

  it("scopes every theme value it reads by name", () => {
    const widgetThemeBlock = widgetTheme.match(/@theme[^{]*\{([^}]*)\}/)?.[1] ?? "";
    const themeNames = new Set([...declaredNames(tailwindTheme), ...declaredNames(widgetThemeBlock)]);
    const read = new Set([...distCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    const scoped = new Set(
      [...distCss.matchAll(/\.fluent-root\{([^}]*)\}/g)].flatMap((block) => declaredNames(block[1])),
    );

    const unscoped = [...read].filter((name) => themeNames.has(name) && !scoped.has(name));
    expect(unscoped).toEqual([]);
  });
});
