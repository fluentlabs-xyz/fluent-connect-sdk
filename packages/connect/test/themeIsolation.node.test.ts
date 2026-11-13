// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const distCss = readFileSync(
  fileURLToPath(new URL("../dist/fluent-connect.css", import.meta.url)),
  "utf8",
);
const widgetTheme = readFileSync(
  fileURLToPath(new URL("../src/styles/theme.css", import.meta.url)),
  "utf8",
);
const tailwindTheme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
const portalContainer = readFileSync(
  fileURLToPath(new URL("../src/widget/portalContainer.tsx", import.meta.url)),
  "utf8",
);

const declaredNames = (css: string) =>
  [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);

/**
 * Tailwind's theme and the widget's `@theme` use the names a host's own tokens use, and a
 * host's unlayered declaration of one of them beats anything in this package's layers. So
 * the theme is imported `theme(reference inline)`: utilities carry the values, and nothing is
 * written on `:root` for a host to override or to be overridden by. Whatever the built CSS
 * still reads by `var()` is redeclared on `.fluent-root` (`theme.css`). The one thing no scope
 * can hold is the `rem`, which resolves against the host's `html`, so the widget sets every
 * length in px instead. Reads the built sheet, as the entry import test does: CI builds `dist`
 * before the test step.
 */
describe("built stylesheet", () => {
  it("writes no theme on :root", () => {
    expect(distCss).not.toMatch(/:root,:host\{/);
  });

  it("states every length in px, which a host's root font size cannot scale", () => {
    const rems = [...distCss.matchAll(/[\d.]+rem\b/g)].map((match) => match[0]);
    expect([...new Set(rems)]).toEqual([]);
  });

  it("scopes every theme value it reads by name", () => {
    const widgetThemeBlocks = [...widgetTheme.matchAll(/@theme[^{]*\{([^}]*)\}/g)].map(
      (block) => block[1],
    );
    const themeNames = new Set([
      ...declaredNames(tailwindTheme),
      ...widgetThemeBlocks.flatMap(declaredNames),
    ]);
    const read = new Set([...distCss.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    const scoped = new Set(
      [...distCss.matchAll(/\.fluent-root\{([^}]*)\}/g)].flatMap((block) =>
        declaredNames(block[1]),
      ),
    );

    const unscoped = [...read].filter((name) => themeNames.has(name) && !scoped.has(name));
    expect(unscoped).toEqual([]);
  });
});

/**
 * A host's own rules are unlayered, and an unlayered rule beats every layered one whatever its
 * specificity: with the utilities in a layer, a host's `button { color: inherit }` turned the
 * primary button's text white on its white fill. So the utilities sit in no layer, nested under
 * `.fluent-root`, where (0,2,0) outranks the element and pseudo-class selectors host resets use.
 */
describe("built utilities", () => {
  it("sit in no cascade layer", () => {
    expect(distCss).not.toMatch(/@layer utilities\b/);
  });

  it("apply only inside .fluent-root", () => {
    expect(distCss).toContain(".fluent-root .text-primary-foreground{");
    expect(distCss).toContain(".fluent-root .outline-none{");
    expect(distCss).not.toMatch(/(?:^|[{}])\.text-primary-foreground\{/);
  });

  it("restate every utility a scope root carries on the root itself", () => {
    const scopes = [...portalContainer.matchAll(/STYLE_SCOPE = "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(scopes.length).toBeGreaterThan(1);
    const rootUtilities = new Set(
      scopes
        .flatMap((scope) => scope.split(/\s+/))
        .filter((c) => c !== "fluent-root" && c !== "dark"),
    );
    const missing = [...rootUtilities].filter((c) => !distCss.includes(`.fluent-root.${c}{`));
    expect(missing).toEqual([]);
  });
});
