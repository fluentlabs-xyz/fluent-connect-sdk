// The builder-facing documents of `@fluent.xyz/connect` as text, for the tests that check them:
// `README.md`, `INTEGRATION.md` and `docs/**/*.md`, the files the package ships. Each helper
// reads Markdown the way GitHub renders it, as far as the checks need: fenced blocks, headings
// and their anchors, relative links. The paths and the compiler options here are shared with
// `scripts/api-doc.ts`, which runs under `node --experimental-strip-types`: this file imports
// nothing relative and uses only the TypeScript syntax that mode strips.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The package's root directory. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The repository's root directory. */
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

/**
 * The generated reference, from the package root (`scripts/api-doc.ts` writes it): its
 * declarations are tagged `ts declaration`, and its examples are checked like any other.
 */
export const API_DOC = "docs/api.md";

/** The compiler options of the package's own `tsconfig.json`. */
export function packageCompilerOptions(): ts.CompilerOptions {
  const tsconfig = path.join(PACKAGE_ROOT, "tsconfig.json");
  return ts.parseJsonConfigFileContent(
    ts.readConfigFile(tsconfig, ts.sys.readFile).config,
    ts.sys,
    PACKAGE_ROOT,
  ).options;
}

/** The upgrade guide, the one document that may name a removed export. */
export const UPGRADE_DOC = "docs/upgrading-0.5.md";

/** Every Markdown file the package ships under `docs/`, from the package root, sorted. */
export function docsFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(PACKAGE_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(relative);
      return entry.name.endsWith(".md") ? [relative] : [];
    });
  return walk("docs").sort();
}

/** `README.md`, `INTEGRATION.md` and every file of `docs/`, from the package root. */
export function shippedDocs(): string[] {
  return ["README.md", "INTEGRATION.md", ...docsFiles()];
}

/** A shipped document's text, by its path from the package root. */
export function readDoc(relative: string): string {
  return readFileSync(path.join(PACKAGE_ROOT, relative), "utf8");
}

export type FencedBlock = {
  /** The info string's words: the language first (`ts`, `tsx`), then any flags (`skip-check`). */
  info: string[];
  code: string;
  /** The 1-based line of the opening fence. */
  line: number;
  /** The 1-based line of the closing fence, one past the last line if the block never closes. */
  end: number;
};

/** The fenced code blocks of a Markdown text, in order. */
export function fencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*(.*)$/.exec(lines[i] ?? "");
    if (!open) continue;
    const [, , fence = "```", info = ""] = open;
    const start = i;
    const code: string[] = [];
    for (i++; i < lines.length; i++) {
      if ((lines[i] ?? "").trim().startsWith(fence)) break;
      code.push(lines[i] ?? "");
    }
    const words = info.trim().split(/\s+/).filter(Boolean);
    blocks.push({ info: words, code: code.join("\n"), line: start + 1, end: i + 1 });
  }
  return blocks;
}

/** A Markdown text with its fenced blocks blanked, so prose checks skip the code. */
export function proseOf(text: string): string {
  const lines = text.split("\n");
  for (const block of fencedBlocks(text)) lines.fill("", block.line - 1, block.end);
  return lines.join("\n");
}

/** GitHub's anchor for a heading's text. */
export function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The anchors of a Markdown text's headings, with GitHub's `-1`, `-2` for repeats. */
export function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of proseOf(text).split("\n")) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slugOf(heading[1] ?? "");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** The text of a section: from the heading `start` matches to the next heading of its level. */
export function sectionOf(text: string, start: RegExp): string {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => start.test(line));
  if (from < 0) return "";
  const level = /^(#+)/.exec(lines[from] ?? "")?.[1]?.length ?? 1;
  const end = new RegExp(`^#{1,${level}}\\s`);
  const to = lines.findIndex((line, index) => index > from && end.test(line));
  return lines.slice(from, to < 0 ? undefined : to).join("\n");
}

/** Whether a backticked span of `text` holds `token` as a whole identifier. */
export function spanHolds(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`[^`\\n]*(?<![\\w$-])" + escaped + "(?![\\w$-])[^`\\n]*`").test(text);
}
