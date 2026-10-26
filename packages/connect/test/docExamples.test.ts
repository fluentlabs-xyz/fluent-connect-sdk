// @vitest-environment node
/**
 * Every example a builder can copy compiles against the public API (FLU-1622, criterion 5.13).
 *
 * Each fenced block tagged `ts` or `tsx` in `README.md` and `docs/**` is a complete module, and
 * this case typechecks all of them in memory with the TypeScript compiler, under the package's
 * own `tsconfig.json`, `@fluent.xyz/connect` mapped to `src/index.ts`: no build is needed, and
 * an example that reaches a removed name, leaves out `network` or `config`, or passes a wrong
 * shape fails here. A block that cannot be a complete module (a backend snippet that needs a
 * library this repository does not install) is tagged `ts skip-check` and says why on its
 * first line; the case prints that list. `docs/api.md`'s examples, the TSDoc `@example` blocks
 * of `src`, are checked too; its declarations, tagged `ts declaration` by `scripts/api-doc.ts`,
 * are not: they are the source the build already typechecks. Any other block is `bash` or
 * `json`; a block with another tag or none fails, so no example escapes the check by its tag.
 * Examples use literals, never `import.meta.env` or `process.env`. Nothing is faked.
 */
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  API_DOC,
  fencedBlocks,
  PACKAGE_ROOT,
  packageCompilerOptions,
  readDoc,
  shippedDocs,
} from "./docsText";

const CHECKED = new Set(["ts", "tsx"]);

/** Every info string a block may carry, `ts declaration` in `docs/api.md` aside. */
const TAGS = new Set(["ts", "tsx", "ts skip-check", "bash", "json"]);

type Example = { file: string; line: number; virtual: string; code: string };

function collect(): {
  examples: Example[];
  skipped: string[];
  envReads: string[];
  badTags: string[];
} {
  const examples: Example[] = [];
  const skipped: string[] = [];
  const envReads: string[] = [];
  const badTags: string[] = [];
  for (const file of shippedDocs()) {
    for (const block of fencedBlocks(readDoc(file))) {
      const [lang = "", ...flags] = block.info;
      const tag = block.info.join(" ");
      const at = `${file}:${block.line}`;
      if (file === API_DOC && tag === "ts declaration") continue;
      if (!TAGS.has(tag)) badTags.push(`${at}: \`\`\`${tag}`);
      if (!CHECKED.has(lang)) continue;
      if (/import\.meta\.env|process\.env/.test(block.code)) envReads.push(at);
      if (flags.includes("skip-check")) {
        const reason = /^\s*\/\/\s*(\S.*)$/.exec(block.code.split("\n")[0] ?? "")?.[1];
        skipped.push(`${at}: ${reason ?? "(no reason on its first line)"}`);
        continue;
      }
      const virtual = path.join(
        PACKAGE_ROOT,
        "docs-examples",
        `${file.replace(/[/.]/g, "_")}_${block.line}.${lang}`,
      );
      examples.push({ file, line: block.line, virtual, code: block.code });
    }
  }
  return { examples, skipped, envReads, badTags };
}

function typecheck(examples: Example[]): string[] {
  const own = packageCompilerOptions();
  const options: ts.CompilerOptions = {
    ...own,
    noEmit: true,
    // Every block is a module of its own, whether or not it imports anything.
    moduleDetection: ts.ModuleDetectionKind.Force,
    paths: {
      ...own.paths,
      "@fluent.xyz/connect": [path.join(PACKAGE_ROOT, "src/index.ts")],
    },
  };
  const byPath = new Map(examples.map((example) => [example.virtual, example]));
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => byPath.has(file) || fileExists.call(host, file);
  host.readFile = (file) => byPath.get(file)?.code ?? readFile.call(host, file);
  host.getSourceFile = (file, language, onError, shouldCreate) => {
    const example = byPath.get(file);
    return example
      ? ts.createSourceFile(file, example.code, language, true)
      : getSourceFile.call(host, file, language, onError, shouldCreate);
  };
  const program = ts.createProgram({ rootNames: [...byPath.keys()], options, host });
  return examples.flatMap((example) => {
    const source = program.getSourceFile(example.virtual);
    if (!source) return [`${example.file}:${example.line}: not compiled`];
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
    return diagnostics.map((d) => {
      const line = d.start === undefined ? 0 : source.getLineAndCharacterOfPosition(d.start).line;
      // The block's first code line is one below its opening fence.
      const at = `${example.file}:${example.line + 1 + line}`;
      return `${at}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
    });
  });
}

describe("criterion 5.13: the examples of README.md and docs/", () => {
  const { examples, skipped, envReads, badTags } = collect();

  it("include the README's quickstart and every guide's examples", () => {
    expect(examples.some((example) => example.file === "README.md")).toBe(true);
    expect(examples.length).toBeGreaterThan(10);
  });

  it("tag each block ts, tsx, ts skip-check, bash or json", () => {
    expect(badTags).toEqual([]);
  });

  it("read no environment variable: the Network and the ids are literals", () => {
    expect(envReads).toEqual([]);
  });

  it("state why on the first line of each block that skips the check", () => {
    if (skipped.length > 0) console.info(`skip-check blocks:\n  ${skipped.join("\n  ")}`);
    expect(skipped.filter((line) => line.endsWith("(no reason on its first line)"))).toEqual([]);
  });

  it(
    "each typecheck as a complete module against src/index.ts",
    () => {
      expect(typecheck(examples)).toEqual([]);
    },
    // One program over the package and every example takes several seconds, more under load.
    180_000,
  );
});
