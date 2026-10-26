// Generates packages/connect/docs/api.md, the reference of every export of
// `@fluent.xyz/connect`, from the census `test/apiCensus.ts` builds with the TypeScript checker.
// The TSDoc in `src` is the source of the reference: edit it there, then run
// `pnpm --filter @fluent.xyz/connect docs:api`. `test/apiDoc.test.ts` fails when the file and a
// fresh generation differ.
//
// The census is only read here (docs/standards/public-api.md A8). A census name with no group
// below throws, so a new export forces a decision about where the reference shows it.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { apiCensus, type CensusMember, type CensusRow } from "../test/apiCensus.ts";
import { API_DOC, PACKAGE_ROOT, packageCompilerOptions, REPO_ROOT } from "../test/docsText.ts";

const EXPERIMENTAL_GROUP = "Experimental";

/** The groups of the reference, in the order it shows them, and every export each holds. */
const GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "Widget and hooks",
    [
      "FluentWidget",
      "FluentWidgetProps",
      "FluentWidgetRenderContext",
      "FluentWidgetConnectButtonRenderContext",
      "useFluentWidget",
      "FluentWidgetStatus",
      "FluentWidgetSession",
      "FluentWidgetAccount",
      "FluentAccountType",
      "FluentAccountCapabilities",
      "FluentWidgetExecutionStatus",
      "AccountAvatar",
      "AccountAvatarProps",
    ],
  ],
  [
    "Config",
    ["FluentWidgetConfig", "FluentWidgetNetwork", "FluentWidgetAuthMethod", "FluentWidgetAssets"],
  ],
  [
    "Batch operations",
    [
      "FluentBatchApi",
      "FluentBatchOperationInput",
      "FluentBatchCallInput",
      "FluentBatchOperation",
      "FluentBatchOperationExecuteOptions",
      "FluentEncodedBatchCall",
      "FluentExecuteResult",
      "FluentGasPayment",
      "FluentWidgetGasPayment",
      "FluentGasTokenSymbol",
    ],
  ],
  ["Signing", ["FluentSignApi", "FluentSigningMode"]],
  [
    "Auth and errors",
    [
      "FluentAuthError",
      "FluentAuthErrorCode",
      "FluentWidgetConfigError",
      "FluentWidgetConfigErrorCode",
      "FluentReviewRejectedError",
      "FluentReviewRejectedErrorCode",
      "FluentSponsorshipFallbackError",
      "FluentSponsorshipReason",
    ],
  ],
  ["Link X", ["useLinkX", "FluentLinkXStatus", "FluentLinkXResult", "FluentXAccount"]],
  ["Iframe", ["useFluentIframeBridge", "UseFluentIframeBridgeOptions", "FluentIframeElement"]],
  [
    "Chains and tokens",
    [
      "fluentMainnet",
      "fluentTestnet",
      "getFluentChainByChainId",
      "getFluentChainForNetwork",
      "FluentChainDefinition",
      "FluentTokenDefinition",
    ],
  ],
  [
    EXPERIMENTAL_GROUP,
    [
      "FluentPrivyAdapter",
      "FluentExternalWalletState",
      "FluentWalletChoice",
      "FluentWidgetExecution",
      "FluentWidgetExecutionSource",
      "FluentUserOperationGas",
      "FluentUserOperationGasError",
      "FluentUserOperationGasErrorCode",
      "FluentFixedAccountGas",
      "FluentFixedPaymasterGas",
      "FluentExecuteTiming",
      "FluentExecuteTimingInstants",
      "FluentGasPaymentEthRates",
    ],
  ],
];

/** The lines of a TSDoc comment without its `/**`, `*` and `*\/` markers. */
function docLines(tsdoc: string): string[] {
  if (!tsdoc) return [];
  const lines = tsdoc
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd());
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  return lines.map((line) => line.replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, "`$1`"));
}

/** A tag that opens a TSDoc line, as the reference shows it. */
function tagLabel(tag: string): string {
  switch (tag) {
    case "experimental":
      return "**Experimental.**";
    case "throws":
      return "**Throws**";
    case "returns":
      return "**Returns**";
    case "param":
      return "**Parameter**";
    case "deprecated":
      return "**Deprecated.**";
    case "example":
      return "**Example**";
    default:
      return `**@${tag}**`;
  }
}

/** A TSDoc comment as Markdown: prose kept, tags made bold, fenced examples kept. */
function docMarkdown(tsdoc: string): string {
  let inFence = false;
  return docLines(tsdoc)
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence || /^\s*```/.test(line)) return line;
      const tag = /^@(\w+)\s?(.*)$/.exec(line);
      if (!tag) return line;
      const [, name = "", rest = ""] = tag;
      return name === "example" ? `\n${tagLabel(name)}\n` : `\n${tagLabel(name)} ${rest}`.trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A member's TSDoc in one table cell: its fenced examples split out, the rest on one line. */
function docCell(tsdoc: string): { cell: string; examples: string[] } {
  const examples: string[] = [];
  const prose: string[] = [];
  let fence: string[] | null = null;
  for (const line of docLines(tsdoc)) {
    if (/^\s*```/.test(line)) {
      if (fence) {
        fence.push(line);
        examples.push(fence.join("\n"));
        fence = null;
      } else {
        fence = [line];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const tag = /^@(\w+)\s?(.*)$/.exec(line);
    if (tag) {
      const [, name = "", rest = ""] = tag;
      if (name !== "example") prose.push(`${tagLabel(name)} ${rest}`.trimEnd());
      continue;
    }
    prose.push(line);
  }
  const cell = prose.join(" ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  return { cell: examples.length > 0 ? `${cell} (example below)`.trim() : cell, examples };
}

/** TypeScript source with its comments taken out and the lines they emptied dropped. */
function withoutComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source);
  let out = "";
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      out += "\u0000";
      continue;
    }
    out += scanner.getTokenText();
  }
  return out
    .split("\n")
    .filter((line) => !(line.includes("\u0000") && line.replace(/\u0000/g, "").trim() === ""))
    .map((line) => line.replace(/\u0000/g, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The declaration statement of a row, its TSDoc taken off (the prose above shows it). */
function declarationOf(row: CensusRow): string {
  const { text, tsdoc } = row.declaration;
  const body = tsdoc && text.startsWith(tsdoc) ? text.slice(tsdoc.length) : text;
  // A union keeps its members' TSDoc: it has no member table to show it (`membersTable`).
  if (hasUnion(row)) return body.trim();
  return withoutComments(withoutClassBodies(withoutConstInitializer(row, body)));
}

/**
 * Whether a row is a type alias of a union, or of an intersection with a union among its parts.
 * The census lists the members of every branch under one path each, so a table of them would
 * show one branch's type as the whole union's.
 */
function hasUnion(row: CensusRow): boolean {
  const file = ts.createSourceFile("declaration.ts", row.declaration.text, ts.ScriptTarget.Latest);
  const [statement] = file.statements;
  if (!statement || !ts.isTypeAliasDeclaration(statement)) return false;
  const branches = (node: ts.TypeNode): boolean => {
    let type = node;
    while (ts.isParenthesizedTypeNode(type)) type = type.type;
    if (ts.isUnionTypeNode(type)) return true;
    return ts.isIntersectionTypeNode(type) && type.types.some(branches);
  };
  return branches(statement.type);
}

let checkerOfPackage: ts.TypeChecker | null = null;
let programOfPackage: ts.Program | null = null;

/**
 * A `const` that holds no function, as `export const name: Type;`: its initializer is how the
 * value is built, which can name internal helpers, and its type is what a builder imports.
 */
function withoutConstInitializer(row: CensusRow, body: string): string {
  const file = ts.createSourceFile("declaration.ts", body, ts.ScriptTarget.Latest, true);
  const [statement] = file.statements;
  if (!statement || !ts.isVariableStatement(statement)) return body;
  const [declaration] = statement.declarationList.declarations;
  const init = declaration?.initializer;
  if (!declaration || !init || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    return body;
  }
  if (ts.isCallExpression(init) && init.arguments.some((a) => ts.isArrowFunction(a))) return body;
  const at = row.declaration.at ?? "";
  const [relative = "", line = "0"] = at.split(":");
  const source = path.join(REPO_ROOT, relative);
  if (!programOfPackage) {
    // The public entry as the root: every exported const is reachable from it, whichever file
    // declares the const the census meets first.
    programOfPackage = ts.createProgram({
      rootNames: [path.join(PACKAGE_ROOT, "src/index.ts")],
      options: packageCompilerOptions(),
    });
    checkerOfPackage = programOfPackage.getTypeChecker();
  }
  const sourceFile = programOfPackage.getSourceFile(source);
  let typeText: string | null = null;
  sourceFile?.forEachChild(function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === row.name &&
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 >= Number(line)
    ) {
      typeText = checkerOfPackage?.typeToString(checkerOfPackage.getTypeAtLocation(node)) ?? "";
      return;
    }
    node.forEachChild(visit);
  });
  if (typeText === null) throw new Error(`api-doc: no declaration of ${row.name} at ${at}`);
  return `export const ${row.name}: ${typeText};`;
}

/** A class declaration with each constructor, method and accessor body cut to `{ … }`. */
function withoutClassBodies(source: string): string {
  const file = ts.createSourceFile("declaration.ts", source, ts.ScriptTarget.Latest, true);
  const bodies: ts.Block[] = [];
  for (const statement of file.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (ts.isFunctionLike(member) && "body" in member && member.body && ts.isBlock(member.body)) {
        bodies.push(member.body);
      }
    }
  }
  let out = source;
  for (const body of bodies.reverse()) {
    out = `${out.slice(0, body.getStart(file))}{ … }${out.slice(body.getEnd())}`;
  }
  return out;
}

function typeCell(member: CensusMember): string {
  const text = withoutComments(member.typeText).replace(/\s+/g, " ").trim();
  return `\`${text.replace(/\|/g, "\\|")}\``;
}

function membersTable(row: CensusRow): string[] {
  if (row.members.length === 0 || hasUnion(row)) return [];
  const out = [
    "| Member | Type | Optional | Experimental | Description |",
    "|---|---|---|---|---|",
  ];
  const examples: string[] = [];
  for (const member of row.members) {
    const name = member.path.slice(row.name.length + 1);
    const { cell, examples: own } = docCell(member.tsdoc);
    out.push(
      `| \`${name}\` | ${typeCell(member)} | ${member.optional ? "yes" : "no"} | ` +
        `${member.tags.includes("experimental") ? "**yes**" : "no"} | ${cell} |`,
    );
    for (const example of own) examples.push(`**\`${name}\` example**`, "", example, "");
  }
  return examples.length > 0 ? [...out, "", ...examples.slice(0, -1)] : out;
}

function section(row: CensusRow): string[] {
  const experimental = row.tags.includes("experimental");
  const marker = experimental ? " · **experimental**" : "";
  const lines = [`### \`${row.name}\``, "", `*${row.kind}*${marker}`];
  const doc = docMarkdown(row.declaration.tsdoc);
  if (doc) lines.push("", doc);
  const declaration = declarationOf(row);
  // Tagged apart from the examples: `test/docExamples.test.ts` typechecks those, not these.
  if (declaration) lines.push("", "```ts declaration", declaration, "```");
  if (row.literals.length > 0) {
    lines.push("", `Literals: ${row.literals.map((literal) => `\`${literal}\``).join(", ")}.`);
  }
  const table = membersTable(row);
  if (table.length > 0) lines.push("", ...table);
  return lines;
}

/** GitHub's anchor for a heading of plain words. */
const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");

/**
 * The reference for the given census rows. Throws when a row has no group, when a group names
 * an export the rows lack, or when an export's `@experimental` tag and its group disagree.
 */
export function renderApiDoc(rows: readonly CensusRow[]): string {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const grouped = new Map<string, string>();
  for (const [group, names] of GROUPS) {
    for (const name of names) {
      if (!byName.has(name)) throw new Error(`api-doc: ${group} names ${name}, not an export`);
      grouped.set(name, group);
    }
  }
  const ungrouped = rows.filter((row) => !grouped.has(row.name)).map((row) => row.name);
  if (ungrouped.length > 0) {
    throw new Error(`api-doc: no group for ${ungrouped.join(", ")}; add each to GROUPS`);
  }
  for (const row of rows) {
    const inExperimental = grouped.get(row.name) === EXPERIMENTAL_GROUP;
    if (inExperimental !== row.tags.includes("experimental")) {
      throw new Error(
        `api-doc: ${row.name} is ${inExperimental ? "" : "not "}in ${EXPERIMENTAL_GROUP} ` +
          `but its TSDoc ${row.tags.includes("experimental") ? "tags" : "does not tag"} it`,
      );
    }
  }

  const values = rows.filter((row) => row.kind === "value").length;
  const out = [
    "# API reference",
    "",
    "<!-- Generated by `pnpm --filter @fluent.xyz/connect docs:api` from the TSDoc in `src`;",
    "     do not edit by hand. -->",
    "",
    `Every export of \`@fluent.xyz/connect\`: ${rows.length} names, ${values} values and ` +
      `${rows.length - values} types. A name or member marked **experimental** may change or be ` +
      "removed in a minor release; [experimental.md](experimental.md) explains each one. Every " +
      "other name is kept after 0.6.0.",
    "",
    "Each export shows its TSDoc, its declaration (a function's body left out), the literals of " +
      "a union of strings, and a table of its members, nested members by their dotted path; a " +
      "union of object types shows its members in its declaration instead.",
    "",
    "## Contents",
    "",
  ];
  for (const [group, names] of GROUPS) {
    out.push(`- [${group}](#${anchorOf(group)}): ${names.map((n) => `\`${n}\``).join(", ")}`);
  }
  for (const [group, names] of GROUPS) {
    out.push("", `## ${group}`);
    for (const name of names) out.push("", ...section(byName.get(name) as CensusRow));
  }
  return `${out.join("\n")}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeFileSync(path.join(PACKAGE_ROOT, API_DOC), renderApiDoc(apiCensus()));
  console.log(`wrote ${API_DOC}`);
}
