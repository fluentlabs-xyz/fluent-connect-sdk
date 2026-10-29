// Census of the public API of @fluent.xyz/connect, adapted from the census of the public API
// review (FLU-1622). The lock tests beside it (exports, closure and vendorMarkers) import it:
// every name the TypeScript checker reports as an export of packages/connect/src/index.ts (the
// `export *` lines resolved) becomes one row with its kind, declaration, `@experimental`-style
// tags, the declarations its signature reaches (`closure`), the packages outside `packages/*` it
// reaches (`externals`), its members and, for a union of string literals, the literals.
//
// It lives under packages/connect/test, not the repository's scripts/ that criterion 1.1 names:
// only this package uses it, and turbo hashes a package's own files only, so an edit here has to
// invalidate the cached `@fluent.xyz/connect#test` result.
//
// The program is built over `packages/connect/tsconfig.json`, which maps the two private
// packages to their `src`, so no build is needed. Building it takes several seconds; it is built
// once per process and entry, and shared by every call.

import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_ENTRY = "packages/connect/src/index.ts";

/**
 * One declaration under `packages/*` a signature reaches, and the name the entry exports it as.
 */
export type CensusRef = { name: string; at: string; exportedAs: string | null };

export type CensusParameter = {
  name: string;
  optional: boolean;
  /** The annotation as written, or the checker's text when there is none. */
  typeText: string;
};

export type CensusMember = {
  /** `<row name>.<member>[.<nested member>]`, for a member of an inline object type. */
  path: string;
  /**
   * Where the member is declared: `<declaring type>.<member>`, which differs from `path` for a
   * member an intersection brings in. A constructor parameter property is `<class>.<member>`.
   */
  declaredAs: string;
  name: string;
  optional: boolean;
  tags: string[];
  tsdoc: string;
  /** The member's own source text, its leading comments included. */
  text: string;
  /** The annotation as written, or the checker's text when there is none. */
  typeText: string;
  /** The parameters of the member's first call signature, or `null` when it is not callable. */
  parameters: CensusParameter[] | null;
  closure: CensusRef[];
  externals: string[];
};

export type CensusRow = {
  name: string;
  kind: "value" | "type";
  declaration: {
    /** `path:line` of the declaration statement, or `<package> (re-export)`. */
    at: string | null;
    /** The TSDoc and the declaration, in full; a function value ends at its body (`{ … }`). */
    text: string;
    tsdoc: string;
  };
  /** `experimental`, `deprecated`, `internal`, `beta`, `alpha` that open a line of the TSDoc. */
  tags: string[];
  closure: CensusRef[];
  /**
   * The packages under `node_modules` the signature reaches, by package name, and any other
   * declaration file outside `packages/`, by its path from the repository root. The platform's
   * own types (`typescript`'s lib, `@types/node`, Bun's) are built-ins and never listed.
   */
  externals: string[];
  /**
   * The properties of the declared type (a class: of its instances; a union: of every arm),
   * recursively into inline object types.
   */
  members: CensusMember[];
  /** The string literals of a type that is a union of them, sorted; empty otherwise. */
  literals: string[];
};

export type CensusOptions = {
  /**
   * Members, by `declaredAs`, whose types the closure walk follows only up to the exported names
   * they reach: those names are recorded but not entered, and everything else the member's type
   * reaches still counts. For the one listed vendor seam: the externals a name reaches apart
   * from the exported seam type, which a widened annotation of the member cannot hide.
   */
  opaque?: readonly string[];
  /**
   * The module whose exports become the rows, from the repository root or absolute;
   * `packages/connect/src/index.ts` when omitted. Any other entry (a test fixture of the census
   * itself) is built on its own with the package's compiler options, and the census throws
   * when it does not compile.
   */
  entry?: string;
};

// Only a tag that opens a line of the TSDoc: the same word in prose or an example is not a tag.
const TAG = /^[ \t]*(?:\/\*\*|\*)?[ \t]*@(experimental|deprecated|internal|beta|alpha)\b/gm;
const MAX_MEMBER_DEPTH = 4;
// The deepest nesting the kept API reaches is far below this; a walk that goes deeper is a
// census defect, and it throws rather than return a closure cut short.
const MAX_WALK_DEPTH = 40;

type Program = {
  checker: ts.TypeChecker;
  exportsOfEntry: ts.Symbol[];
  exportedByTarget: Map<ts.Symbol, string>;
};

const programs = new Map<string, Program>();

function program(entry: string): Program {
  const entryPath = path.resolve(ROOT, entry);
  const known = programs.get(entryPath);
  if (known) return known;
  const tsconfigPath = path.join(ROOT, "packages/connect/tsconfig.json");
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
    ts.sys,
    path.dirname(tsconfigPath),
  );
  const isDefault = entryPath === path.join(ROOT, DEFAULT_ENTRY);
  // Another entry sits outside the tsconfig's `include`, and a census over code that does not
  // compile would report what the checker guessed.
  const built = ts.createProgram({
    rootNames: isDefault ? parsed.fileNames : [entryPath],
    options: parsed.options,
  });
  if (!isDefault) {
    const errors = ts
      .getPreEmitDiagnostics(built)
      .filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      throw new Error(
        `census entry does not compile: ${ts.formatDiagnostics(errors, {
          getCanonicalFileName: (f) => f,
          getCurrentDirectory: () => ROOT,
          getNewLine: () => "\n",
        })}`,
      );
    }
  }
  const checker = built.getTypeChecker();
  const source = built.getSourceFile(entryPath);
  if (!source) throw new Error(`entry not in program: ${entryPath}`);
  const entrySymbol = checker.getSymbolAtLocation(source);
  if (!entrySymbol) throw new Error("entry has no module symbol");
  const exportsOfEntry = checker.getExportsOfModule(entrySymbol);
  const exportedByTarget = new Map<ts.Symbol, string>();
  for (const s of exportsOfEntry) exportedByTarget.set(resolveAlias(checker, s), s.name);
  const made = { checker, exportsOfEntry, exportedByTarget };
  programs.set(entryPath, made);
  return made;
}

function resolveAlias(checker: ts.TypeChecker, s: ts.Symbol): ts.Symbol {
  return s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
}

const rel = (file: string) => path.relative(ROOT, file);

function isInPackages(file: string): boolean {
  const r = rel(file);
  return r.startsWith("packages/") && !r.includes("node_modules");
}

/**
 * Where a declaration outside `packages/` comes from: its package under `node_modules`, or its
 * path from the repository root for any other file; `null` for the platform's built-in types.
 */
function externalOrigin(file: string): string | null {
  const i = file.lastIndexOf("node_modules/");
  if (i < 0) return isInPackages(file) ? null : rel(file);
  const parts = file.slice(i + "node_modules/".length).split("/");
  const first = parts[0] ?? "";
  const name = first.startsWith("@") ? `${first}/${parts[1] ?? ""}` : first;
  // Lib types are built-ins, not dependencies.
  if (["typescript", "@types/node", "bun-types", "@types/bun"].includes(name)) return null;
  return name;
}

/** A re-exported vendor declaration: its package, never a file path of this repository. */
function externalPackage(file: string): string | null {
  return file.includes("node_modules/") ? externalOrigin(file) : null;
}

// `ts.Type` offers guards for unions, literals, type parameters and interfaces only; these
// read the same flags the checker sets for the kinds it does not guard.
function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.flags & ts.TypeFlags.Object) !== 0;
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return isObjectType(type) && (type.objectFlags & ts.ObjectFlags.Reference) !== 0;
}

function isConditionalType(type: ts.Type): type is ts.ConditionalType {
  return (type.flags & ts.TypeFlags.Conditional) !== 0;
}

function isIndexedAccessType(type: ts.Type): type is ts.IndexedAccessType {
  return (type.flags & ts.TypeFlags.IndexedAccess) !== 0;
}

function isTemplateLiteralType(type: ts.Type): type is ts.TemplateLiteralType {
  return (type.flags & ts.TypeFlags.TemplateLiteral) !== 0;
}

function isSubstitutionType(type: ts.Type): type is ts.SubstitutionType {
  return (type.flags & ts.TypeFlags.Substitution) !== 0;
}

function isStringMappingType(type: ts.Type): type is ts.StringMappingType {
  return (type.flags & ts.TypeFlags.StringMapping) !== 0;
}

function statementOf(decl: ts.Node): ts.Node {
  if (ts.isVariableDeclaration(decl)) return decl.parent.parent;
  return decl;
}

function tsdocOf(node: ts.Node): string {
  const sf = node.getSourceFile();
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  const docs = ranges.filter((r) => sf.text.startsWith("/**", r.pos));
  const last = docs[docs.length - 1];
  return last ? sf.text.slice(last.pos, last.end) : "";
}

function tagsOf(tsdoc: string): string[] {
  return [...new Set([...tsdoc.matchAll(TAG)].map((m) => m[1] ?? ""))];
}

/** The function a `const` holds, directly or as the argument of a wrapper (`forwardRef(…)`). */
function functionOf(init: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  while (
    ts.isAsExpression(init) ||
    ts.isSatisfiesExpression(init) ||
    ts.isParenthesizedExpression(init)
  ) {
    init = init.expression;
  }
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  if (ts.isCallExpression(init)) {
    for (const a of init.arguments) {
      if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) return a;
    }
  }
  return undefined;
}

/** The declaration's own text: a function value ends at its body, so it is a signature. */
function signatureText(decl: ts.Node): string {
  const sf = decl.getSourceFile();
  const stmt = statementOf(decl);
  let end = stmt.getEnd();
  let body: ts.Node | undefined;
  if (ts.isFunctionDeclaration(decl)) body = decl.body;
  else if (ts.isVariableDeclaration(decl) && decl.initializer) {
    body = functionOf(decl.initializer)?.body;
  }
  if (body && ts.isBlock(body)) end = body.getStart(sf) + 1;
  return sf.text.slice(stmt.getStart(sf), end) + (end < stmt.getEnd() ? " … }" : "");
}

function lineOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * The declaration that says whose a symbol is. One outside `packages/` wins: a module or global
 * augmentation under `packages/` adds members to a vendor's or the platform's interface, which
 * stays the vendor's.
 */
function primaryDeclaration(s: ts.Symbol): ts.Declaration | undefined {
  const decls = s.declarations ?? [];
  return decls.find((d) => !isInPackages(d.getSourceFile().fileName)) ?? decls[0];
}

/** `FluentWidgetConfig.gasPayment.ethValueByToken` for that property's declaration. */
function declaredAsOf(decl: ts.Node): string {
  const names: string[] = [];
  let node: ts.Node | undefined = decl;
  while (node && !ts.isSourceFile(node)) {
    if (
      (ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isParameterPropertyDeclaration(node, node.parent)) &&
      node.name
    ) {
      names.unshift(node.name.getText());
    } else if (
      (ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name
    ) {
      names.unshift(node.name.text);
      break;
    }
    node = node.parent;
  }
  return names.join(".");
}

// ---------- closure: a semantic walk of the types a declaration reaches ----------

type Verdict = "internal" | "external" | "boundary" | "none";

/**
 * `stopAtExported`: the walk of an opaque member, which records an exported name it reaches
 * but does not enter it; that name's own row is checked on its own.
 */
function closureFrom(
  p: Program,
  roots: { types: ts.Type[]; nodes: ts.Node[]; self?: ts.Symbol },
  opaque: ReadonlySet<string>,
  stopAtExported = false,
): { refs: CensusRef[]; externals: string[] } {
  const { checker, exportedByTarget } = p;
  const refs = new Map<string, CensusRef>();
  const externals = new Set<string>();
  const seenTypes = new Set<ts.Type>();
  const seenSymbols = new Set<ts.Symbol>(roots.self ? [roots.self] : []);
  const seenOpaque = new Set<ts.Node>();
  const pending: ts.Symbol[] = [];
  const typeLike =
    ts.SymbolFlags.TypeAlias |
    ts.SymbolFlags.Interface |
    ts.SymbolFlags.Class |
    ts.SymbolFlags.Enum;

  const isOpaqueMember = (decl: ts.Node) => opaque.size > 0 && opaque.has(declaredAsOf(decl));

  function record(sym: ts.Symbol, decl: ts.Declaration): void {
    const at = `${rel(decl.getSourceFile().fileName)}:${lineOf(decl)}`;
    refs.set(`${sym.name}@${at}`, {
      name: sym.name,
      at,
      exportedAs: exportedByTarget.get(sym) ?? null,
    });
  }

  /**
   * `viaTypeof`: a signature names the symbol with `typeof`, so a value is part of it, exported
   * or not; otherwise only a type-like declaration is recorded.
   */
  function noteSymbol(sym: ts.Symbol | undefined, viaTypeof = false): Verdict {
    if (!sym) return "none";
    const decl = primaryDeclaration(sym);
    if (!decl) return "none";
    const file = decl.getSourceFile().fileName;
    if (isInPackages(file)) {
      const named = viaTypeof ? sym.flags & ts.SymbolFlags.Value : sym.flags & typeLike;
      if (sym !== roots.self && !sym.name.startsWith("__") && named) record(sym, decl);
      if (stopAtExported && exportedByTarget.has(sym)) return "boundary";
      if (!seenSymbols.has(sym)) {
        seenSymbols.add(sym);
        pending.push(sym);
      }
      return "internal";
    }
    // An augmentation under `packages/` of a declaration outside it: its own syntax is walked.
    const augmented = (sym.declarations ?? []).some((d) =>
      isInPackages(d.getSourceFile().fileName),
    );
    if (augmented && !seenSymbols.has(sym)) {
      seenSymbols.add(sym);
      pending.push(sym);
    }
    const origin = externalOrigin(file);
    if (origin) {
      externals.add(origin);
      return "external";
    }
    return "none";
  }

  /** An opaque member's type, walked as `stopAtExported` describes, into this closure. */
  function walkOpaque(decl: ts.Node, type: ts.Type): void {
    if (seenOpaque.has(decl)) return;
    seenOpaque.add(decl);
    const inner = closureFrom(p, { types: [type], nodes: [decl] }, new Set(), true);
    for (const ref of inner.refs) refs.set(`${ref.name}@${ref.at}`, ref);
    for (const pkg of inner.externals) externals.add(pkg);
  }

  function walk(type: ts.Type, depth: number): void {
    if (seenTypes.has(type)) return;
    if (depth > MAX_WALK_DEPTH) {
      throw new Error(
        `census: the type walk is ${depth} levels deep at ${checker.typeToString(type)}`,
      );
    }
    seenTypes.add(type);
    const next = (t: ts.Type | undefined) => {
      if (t) walk(t, depth + 1);
    };
    // An alias's arguments are part of the type whoever declares the alias:
    // `Dispatch<SetStateAction<FluentX>>` reaches FluentX, `UseQueryResult<VendorT>` a vendor.
    const aliasVerdict = noteSymbol(type.aliasSymbol);
    for (const a of type.aliasTypeArguments ?? []) next(a);
    if (aliasVerdict === "external" || aliasVerdict === "boundary") return;
    // A type parameter promises its constraint and default; the deferred kinds below are made
    // of the types they hold until an argument resolves them.
    if (type.isTypeParameter()) {
      next(type.getConstraint());
      next(checker.getDefaultFromTypeParameter(type));
    }
    if (isConditionalType(type)) {
      next(type.checkType);
      next(type.extendsType);
      next(type.resolvedTrueType);
      next(type.resolvedFalseType);
      // The branches as instantiated, which the public API exposes only through the constraint,
      // and as written.
      next(checker.getBaseConstraintOfType(type));
      next(checker.getTypeFromTypeNode(type.root.node.trueType));
      next(checker.getTypeFromTypeNode(type.root.node.falseType));
      if (isInPackages(type.root.node.getSourceFile().fileName)) walkAst(type.root.node);
    }
    if (isIndexedAccessType(type)) {
      next(type.objectType);
      next(type.indexType);
    }
    if (type.isIndexType()) next(type.type);
    if (isTemplateLiteralType(type)) for (const t of type.types) next(t);
    if (isStringMappingType(type)) next(type.type);
    if (isSubstitutionType(type)) {
      next(type.baseType);
      next(type.constraint);
    }
    const symbol = type.getSymbol();
    const symVerdict = aliasVerdict === "internal" ? "internal" : noteSymbol(symbol);
    if (symVerdict === "boundary") return;
    if (symVerdict === "external" && aliasVerdict !== "internal") {
      // An external generic over an internal argument (Promise<FluentX>, Pick<VendorX, ...>).
      if (isTypeReference(type)) for (const a of checker.getTypeArguments(type)) next(a);
      return;
    }
    const anonymous = isObjectType(type) && (type.objectFlags & ts.ObjectFlags.Anonymous) !== 0;
    if (symVerdict === "none" && aliasVerdict === "none" && symbol && !anonymous) {
      // Lib types such as Promise, Array, Record: only their arguments matter.
      if (isTypeReference(type)) for (const a of checker.getTypeArguments(type)) next(a);
      if (!(symbol.flags & (ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.ObjectLiteral))) return;
    }
    if (type.isUnionOrIntersection()) for (const t of type.types) next(t);
    if (isObjectType(type)) {
      if (isTypeReference(type)) for (const a of checker.getTypeArguments(type)) next(a);
      if (type.isClassOrInterface()) for (const t of type.typeParameters ?? []) next(t);
      for (const prop of checker.getPropertiesOfType(type)) {
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        if (decl && !isInPackages(decl.getSourceFile().fileName)) {
          const origin = externalOrigin(decl.getSourceFile().fileName);
          if (origin) externals.add(origin);
          continue; // inherited from an external base (Error, React props)
        }
        if (decl && isOpaqueMember(decl)) {
          walkOpaque(decl, checker.getTypeOfSymbol(prop));
          continue;
        }
        next(checker.getTypeOfSymbol(prop));
      }
      for (const sig of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        for (const t of sig.getTypeParameters() ?? []) next(t);
        for (const param of sig.getParameters()) next(checker.getTypeOfSymbol(param));
        next(sig.getReturnType());
      }
      for (const info of checker.getIndexInfosOfType(type)) next(info.type);
    }
  }

  /** A name a type node refers to, and for a value named by `typeof`, the value's type. */
  function noteName(at: ts.Node, viaTypeof: boolean): void {
    const sym = checker.getSymbolAtLocation(at);
    if (!sym) return;
    const resolved = resolveAlias(checker, sym);
    if (
      noteSymbol(resolved, viaTypeof) === "internal" &&
      resolved.flags & ts.SymbolFlags.Value &&
      !(resolved.flags & ts.SymbolFlags.Type)
    ) {
      walk(checker.getTypeOfSymbol(resolved), 0);
    }
  }

  const rightmost = (name: ts.EntityName) => (ts.isQualifiedName(name) ? name.right : name);

  /**
   * An un-annotated `const`'s initializer, for what inference flattens away (an alias inside a
   * union): the annotations of the function it holds and the type it is asserted `as`, never a
   * function body.
   */
  function walkInitializer(init: ts.Expression): void {
    if (ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init)) {
      walkInitializer(init.expression);
    } else if (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init)) {
      // `as const` keeps the expression's own type; any other assertion replaces it.
      const isConst =
        ts.isTypeReferenceNode(init.type) &&
        ts.isIdentifier(init.type.typeName) &&
        init.type.typeName.text === "const";
      if (isConst) walkInitializer(init.expression);
      else walkAst(init.type);
    } else {
      const fn = functionOf(init);
      if (!fn) return;
      for (const t of fn.typeParameters ?? []) walkAst(t);
      for (const param of fn.parameters) walkAst(param);
      if (fn.type) walkAst(fn.type);
    }
  }

  // The semantic walk loses an alias TypeScript flattens into a union, and an alias of a
  // primitive; so every declaration reached is also walked as written: each type reference in
  // its annotations, never a function body.
  function walkAst(node: ts.Node): void {
    if (ts.isBlock(node)) return;
    if (ts.isVariableDeclaration(node) && !node.type) {
      if (node.initializer) walkInitializer(node.initializer);
      return;
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && isOpaqueMember(node)) {
      walkOpaque(node, checker.getTypeAtLocation(node));
      return;
    }
    if (ts.isTypeReferenceNode(node)) noteName(rightmost(node.typeName), false);
    else if (ts.isExpressionWithTypeArguments(node)) noteName(node.expression, false);
    else if (ts.isTypeQueryNode(node)) noteName(rightmost(node.exprName), true);
    else if (ts.isImportTypeNode(node)) {
      // `import("pkg").T`, or `typeof import("pkg")` for the module itself.
      if (node.qualifier) noteName(rightmost(node.qualifier), node.isTypeOf);
      else walk(checker.getTypeFromTypeNode(node), 0);
    }
    ts.forEachChild(node, walkAst);
  }

  for (const node of roots.nodes) walkAst(node);
  for (const type of roots.types) walk(type, 0);
  for (let sym = pending.shift(); sym; sym = pending.shift()) {
    for (const d of sym.declarations ?? []) {
      if (isInPackages(d.getSourceFile().fileName)) walkAst(d);
    }
    if (sym.flags & ts.SymbolFlags.Type) walk(checker.getDeclaredTypeOfSymbol(sym), 0);
  }
  return {
    refs: [...refs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    externals: [...externals].sort(),
  };
}

// ---------- members ----------

function isInlineObject(type: ts.Type): boolean {
  if (!isObjectType(type) || type.aliasSymbol) return false;
  if (!(type.objectFlags & ts.ObjectFlags.Anonymous)) return false;
  if (type.getCallSignatures().length || type.getConstructSignatures().length) return false;
  const symbol = type.getSymbol();
  return Boolean(symbol && symbol.flags & ts.SymbolFlags.TypeLiteral);
}

/** A member type the members walk enters: an inline object, or a union of inline objects. */
function isInlineShape(type: ts.Type): boolean {
  if (isInlineObject(type)) return true;
  return type.isUnion() && !type.aliasSymbol && type.types.every(isInlineObject);
}

function annotationText(decl: ts.Node, fallback: () => string): string {
  if (
    (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) &&
    decl.type
  ) {
    return decl.type.getText();
  }
  if (ts.isMethodSignature(decl) || ts.isMethodDeclaration(decl)) return decl.getText();
  return fallback();
}

/**
 * A union's own properties are only those every arm shares, and a member of one arm is still
 * part of the type a host reads: the shared ones come first, as the checker reports them, then
 * each declaration of a member only some arms have.
 */
function propertiesOf(checker: ts.TypeChecker, type: ts.Type): ts.Symbol[] {
  const own = checker.getPropertiesOfType(type);
  if (!type.isUnion()) return own;
  const shared = new Set(own.map((prop) => prop.name));
  const seen = new Set<ts.Node | ts.Symbol>();
  const armOnly: ts.Symbol[] = [];
  for (const arm of type.types) {
    for (const prop of checker.getPropertiesOfType(arm)) {
      const key = prop.valueDeclaration ?? prop.declarations?.[0] ?? prop;
      if (shared.has(prop.name) || seen.has(key)) continue;
      seen.add(key);
      armOnly.push(prop);
    }
  }
  return [...own, ...armOnly];
}

function membersOf(
  p: Program,
  type: ts.Type,
  prefix: string,
  depth: number,
  opaque: ReadonlySet<string>,
): CensusMember[] {
  const { checker } = p;
  const members: CensusMember[] = [];
  for (const prop of propertiesOf(checker, type)) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl || !isInPackages(decl.getSourceFile().fileName)) continue;
    const memberType = checker.getTypeOfSymbol(prop);
    const nonNullable = checker.getNonNullableType(memberType);
    const signature = nonNullable.getCallSignatures()[0];
    const parameters = signature
      ? signature.getParameters().map((param): CensusParameter => {
          const pd = param.valueDeclaration;
          const optional =
            !!pd &&
            ts.isParameter(pd) &&
            Boolean(pd.questionToken || pd.initializer || pd.dotDotDotToken);
          return {
            name: param.name,
            optional,
            typeText: pd
              ? annotationText(pd, () => checker.typeToString(checker.getTypeOfSymbol(param)))
              : checker.typeToString(checker.getTypeOfSymbol(param)),
          };
        })
      : null;
    const tsdoc = tsdocOf(decl);
    const sf = decl.getSourceFile();
    const closure = closureFrom(p, { types: [memberType], nodes: [decl] }, opaque);
    const path = `${prefix}.${prop.name}`;
    members.push({
      path,
      declaredAs: declaredAsOf(decl),
      name: prop.name,
      optional: Boolean(prop.flags & ts.SymbolFlags.Optional),
      tags: tagsOf(tsdoc),
      tsdoc,
      text: sf.text.slice(decl.getFullStart(), decl.getEnd()).trim(),
      typeText: annotationText(decl, () => checker.typeToString(memberType)),
      parameters,
      closure: closure.refs,
      externals: closure.externals,
    });
    if (depth < MAX_MEMBER_DEPTH && isInlineShape(nonNullable)) {
      members.push(...membersOf(p, nonNullable, path, depth + 1, opaque));
    }
  }
  return members;
}

function literalsOf(type: ts.Type): string[] {
  const parts = type.isUnion() ? type.types : [type];
  const literals = parts.flatMap((t) => (t.isStringLiteral() ? [t.value] : []));
  return literals.length === parts.length ? literals.sort() : [];
}

// ---------- rows ----------

/**
 * One row per export of the entry (`packages/connect/src/index.ts` unless `options.entry` names
 * another), sorted by name.
 *
 * @example
 * ```ts
 * const rows = apiCensus();
 * const props = rows.find((row) => row.name === "FluentWidgetProps");
 * ```
 */
export function apiCensus(options: CensusOptions = {}): CensusRow[] {
  const p = program(options.entry ?? DEFAULT_ENTRY);
  const { checker, exportsOfEntry } = p;
  const opaque = new Set(options.opaque ?? []);
  const rows = exportsOfEntry.map((exp): CensusRow => {
    const target = resolveAlias(checker, exp);
    const spec = exp.declarations?.find((d): d is ts.ExportSpecifier => ts.isExportSpecifier(d));
    const typeOnly = !!spec && (spec.isTypeOnly || spec.parent.parent.isTypeOnly);
    const kind: "value" | "type" =
      !typeOnly && target.flags & ts.SymbolFlags.Value ? "value" : "type";
    const decl = primaryDeclaration(target);
    const declFile = decl ? decl.getSourceFile().fileName : "";
    const external = decl ? externalPackage(declFile) : null;
    const stmt = decl ? statementOf(decl) : undefined;
    const tsdoc = stmt && !external ? tsdocOf(stmt) : "";
    const sig = decl && !external ? signatureText(decl) : "";
    const ownNodes = (target.declarations ?? []).filter((d) =>
      isInPackages(d.getSourceFile().fileName),
    );
    const roots: ts.Type[] = [
      kind === "type" ? checker.getDeclaredTypeOfSymbol(target) : checker.getTypeOfSymbol(target),
    ];
    // A class exported as a value: its instance side is part of its signature.
    if (kind === "value" && target.flags & ts.SymbolFlags.Class) {
      roots.push(checker.getDeclaredTypeOfSymbol(target));
    }
    const closure = closureFrom(p, { types: roots, nodes: ownNodes, self: target }, opaque);
    const declaredType =
      target.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Class)
        ? checker.getDeclaredTypeOfSymbol(target)
        : undefined;
    return {
      name: exp.name,
      kind,
      declaration: {
        at: decl
          ? external
            ? `${external} (re-export)`
            : `${rel(declFile)}:${lineOf(stmt ?? decl)}`
          : null,
        text: external ? `re-exported from ${external}` : (tsdoc ? `${tsdoc}\n` : "") + sig,
        tsdoc,
      },
      tags: tagsOf(tsdoc),
      closure: closure.refs,
      externals: external ? [external] : closure.externals,
      members: declaredType && !external ? membersOf(p, declaredType, exp.name, 0, opaque) : [],
      literals:
        declaredType && target.flags & ts.SymbolFlags.TypeAlias ? literalsOf(declaredType) : [],
    };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
