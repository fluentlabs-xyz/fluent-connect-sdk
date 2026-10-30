// @vitest-environment node
/**
 * The demos under `apps/` import only what `@fluent.xyz/connect` exports (FLU-1622, criterion
 * 2.21), and reach anything else through an internal alias both their `tsconfig.json` and their
 * `vite.config.ts` declare.
 *
 * Demos are not the public API, so this check lives outside the lock tests: a demo added,
 * removed or reshaped changes this file, never the lock. The exported names are the census's
 * (`test/apiCensus.ts`), which `exports.test.ts` holds to the kept list; the demos are read as
 * source with the TypeScript parser. Nothing is faked.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus } from "./apiCensus";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let exported = new Set<string>();

// Building the program over the package takes several seconds, more under load.
beforeAll(() => {
  exported = new Set(apiCensus().map((row) => row.name));
}, 180_000);

/** Every source file of one demo, `.d.ts` excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") out.push(...sourceFiles(full));
    } else if (/\.(m?tsx?|m?jsx?)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every module specifier a file reaches — static imports, re-exports and dynamic `import()` —
 * with the names it takes from each (`*` for a namespace or `export *`).
 */
function importsOf(file: string): Array<{ specifier: string; names: string[] }> {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Array<{ specifier: string; names: string[] }> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const names: string[] = [];
        if (ts.isImportDeclaration(node)) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              names.push((element.propertyName ?? element.name).text);
            }
          }
          if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
          if (node.importClause?.name) names.push("default");
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            names.push((element.propertyName ?? element.name).text);
          }
        } else {
          names.push("*");
        }
        out.push({ specifier: node.moduleSpecifier.text, names });
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push({ specifier: node.arguments[0].text, names: ["*"] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The `paths` target a specifier resolves to through an app's tsconfig.json, if any. */
function pathsTarget(
  paths: Record<string, string[]>,
  appDir: string,
  specifier: string,
): string | undefined {
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target) continue;
    if (key === specifier) return path.resolve(appDir, target);
    if (key.endsWith("/*") && specifier.startsWith(key.slice(0, -1))) {
      return path.resolve(appDir, target.replace("*", specifier.slice(key.length - 1)));
    }
  }
  return undefined;
}

/** A key of the `resolve.alias` object of a demo's `vite.config.ts`. */
const INTERNAL_ALIAS_KEY = /"(@fluent\.xyz\/connect\/internal\/[^"]+)"\s*:/g;

/** Whether a vite alias key resolves the specifier: exactly, or as the directory above it. */
function viteAliased(keys: string[], specifier: string): boolean {
  return keys.some((key) => key === specifier || specifier.startsWith(`${key}/`));
}

/** The seven demos the Issue names as importing removed names at a733e95. */
const DEMOS_TO_MOVE = [
  "auth-demo",
  "chess",
  "erc4626-vault",
  "paymaster-transfer",
  "sdk-showcase",
  "sponsorship-demo",
  "widget-preview",
];

describe("criterion 2.21: the demos under apps/", () => {
  it("import only exported names, and anything else through an internal alias", () => {
    const appsDir = path.join(ROOT, "apps");
    const connectDir = path.join(ROOT, "packages/connect");
    const connectSrc = path.join(connectDir, "src");
    const problems: string[] = [];
    const importing = new Set<string>();
    for (const app of readdirSync(appsDir)) {
      const appDir = path.join(appsDir, app);
      const src = path.join(appDir, "src");
      if (!existsSync(src)) continue;
      const tsconfig = JSON.parse(readFileSync(path.join(appDir, "tsconfig.json"), "utf8")) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      const paths = tsconfig.compilerOptions?.paths ?? {};
      const viteConfig = readFileSync(path.join(appDir, "vite.config.ts"), "utf8");
      const aliasKeys = [...viteConfig.matchAll(INTERNAL_ALIAS_KEY)].map((match) => match[1] ?? "");
      for (const file of sourceFiles(src)) {
        const where = path.relative(ROOT, file);
        for (const { specifier, names } of importsOf(file)) {
          if (specifier === "@fluent.xyz/connect") {
            importing.add(app);
            for (const name of names) {
              if (!exported.has(name)) problems.push(`${where} imports ${name}`);
            }
          } else if (specifier === "@fluent.xyz/connect/styles.css") {
            continue;
          } else if (specifier.startsWith("@fluent.xyz/connect/internal/")) {
            const target = pathsTarget(paths, appDir, specifier);
            if (!target) problems.push(`${where}: ${specifier} is not in tsconfig.json paths`);
            else if (
              !target.startsWith(`${connectSrc}${path.sep}`) ||
              !["", ".ts", ".tsx"].some((extension) => existsSync(`${target}${extension}`))
            ) {
              problems.push(`${where}: ${specifier} resolves to no module under connect's src`);
            }
            if (!viteAliased(aliasKeys, specifier)) {
              problems.push(`${where}: ${specifier} is not a vite.config.ts alias`);
            }
          } else if (specifier.startsWith("@fluent.xyz/connect/")) {
            problems.push(`${where}: ${specifier} is no published path and no internal alias`);
          } else if (
            specifier.startsWith(".") &&
            path.resolve(path.dirname(file), specifier).startsWith(`${connectDir}${path.sep}`)
          ) {
            problems.push(`${where}: ${specifier} reaches the package's source by a relative path`);
          }
        }
      }
    }
    expect(DEMOS_TO_MOVE.filter((app) => !importing.has(app))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
