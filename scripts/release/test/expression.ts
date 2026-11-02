/**
 * The subset of GitHub Actions expressions the workflow simulation evaluates, with the runner's
 * semantics: `==` compares strings case-insensitively and coerces mismatched types to numbers, a
 * missing property is null, and `''`, `0`, `false` and null are falsy. Anything outside the
 * subset throws, so a workflow cannot pass a test through syntax the simulation does not read.
 *
 * Mirrors https://docs.github.com/en/actions/reference/workflows-and-actions/expressions as of
 * 2026-10.
 */

export type ExpressionValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: unknown }
  | unknown[];

export interface StatusFunctions {
  success(): boolean;
  failure(): boolean;
  cancelled(): boolean;
  always(): boolean;
}

type Token =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string };

const STATUS_FUNCTIONS = ["success", "failure", "cancelled", "always"];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "'") {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= source.length) throw new Error(`unterminated string in: ${source}`);
        if (source[i] === "'" && source[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (source[i] === "'") {
          i += 1;
          break;
        } else {
          value += source[i];
          i += 1;
        }
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (["==", "!=", "&&", "||", "<=", ">="].includes(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if ("!()<>,.[]".includes(char)) {
      tokens.push({ kind: "op", value: char });
      i += 1;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: "ident", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new Error(`unsupported character ${JSON.stringify(char)} in expression: ${source}`);
  }
  return tokens;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim() === "" ? 0 : Number(value);
  return Number.NaN;
}

export function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  return true;
}

function looseEquals(left: unknown, right: unknown): boolean {
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  if (typeof l === "string" && typeof r === "string") return l.toLowerCase() === r.toLowerCase();
  if (typeof l === "object" || typeof r === "object") {
    if (l === null && r === null) return true;
    if (l !== null && typeof l === "object") return l === r;
    if (r !== null && typeof r === "object") return false;
  }
  if (typeof l === typeof r) return l === r;
  const a = toNumber(l);
  const b = toNumber(r);
  return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: Record<string, unknown>,
    private readonly status: StatusFunctions,
    private readonly source: string,
  ) {}

  parse(): unknown {
    const value = this.or();
    if (this.position !== this.tokens.length) {
      throw new Error(`unexpected trailing tokens in expression: ${this.source}`);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private takeOp(value: string): boolean {
    const token = this.peek();
    if (token?.kind === "op" && token.value === value) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expectOp(value: string): void {
    if (!this.takeOp(value)) throw new Error(`expected '${value}' in expression: ${this.source}`);
  }

  private or(): unknown {
    let left = this.and();
    while (this.takeOp("||")) {
      const right = this.and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private and(): unknown {
    let left = this.comparison();
    while (this.takeOp("&&")) {
      const right = this.comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private comparison(): unknown {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || !["==", "!=", "<", ">", "<=", ">="].includes(token.value)) {
        return left;
      }
      this.position += 1;
      const right = this.unary();
      if (token.value === "==") left = looseEquals(left, right);
      else if (token.value === "!=") left = !looseEquals(left, right);
      else {
        const a = toNumber(left);
        const b = toNumber(right);
        if (token.value === "<") left = a < b;
        else if (token.value === ">") left = a > b;
        else if (token.value === "<=") left = a <= b;
        else left = a >= b;
      }
    }
  }

  private unary(): unknown {
    if (this.takeOp("!")) return !truthy(this.unary());
    return this.primary();
  }

  private primary(): unknown {
    const token = this.peek();
    if (!token) throw new Error(`unexpected end of expression: ${this.source}`);
    if (this.takeOp("(")) {
      const value = this.or();
      this.expectOp(")");
      return value;
    }
    this.position += 1;
    if (token.kind === "string" || token.kind === "number") return token.value;
    if (token.kind !== "ident") throw new Error(`unexpected '${token.value}' in: ${this.source}`);
    if (token.value === "true") return true;
    if (token.value === "false") return false;
    if (token.value === "null") return null;
    if (this.takeOp("(")) return this.call(token.value);
    let value: unknown = this.context[token.value] ?? null;
    for (;;) {
      if (this.takeOp(".")) {
        const name = this.peek();
        if (name?.kind !== "ident") throw new Error(`expected a property in: ${this.source}`);
        this.position += 1;
        value = property(value, name.value);
      } else if (this.takeOp("[")) {
        const key = this.or();
        this.expectOp("]");
        value = property(value, stringify(key));
      } else {
        return value;
      }
    }
  }

  private call(name: string): unknown {
    const args: unknown[] = [];
    if (!this.takeOp(")")) {
      do args.push(this.or());
      while (this.takeOp(","));
      this.expectOp(")");
    }
    switch (name) {
      case "success":
        return this.status.success();
      case "failure":
        return this.status.failure();
      case "cancelled":
        return this.status.cancelled();
      case "always":
        return this.status.always();
      case "contains": {
        const [haystack, needle] = args;
        if (Array.isArray(haystack)) return haystack.some((item) => looseEquals(item, needle));
        return stringify(haystack).toLowerCase().includes(stringify(needle).toLowerCase());
      }
      case "startsWith":
        return stringify(args[0]).toLowerCase().startsWith(stringify(args[1]).toLowerCase());
      case "endsWith":
        return stringify(args[0]).toLowerCase().endsWith(stringify(args[1]).toLowerCase());
      case "format":
        return stringify(args[0]).replace(/\{(\d+)\}/g, (_, index: string) =>
          stringify(args[Number(index) + 1]),
        );
      case "fromJSON":
        return JSON.parse(stringify(args[0])) as unknown;
      case "toJSON":
        return JSON.stringify(args[0]);
      default:
        throw new Error(`unsupported function ${name}() in expression: ${this.source}`);
    }
  }
}

function property(value: unknown, name: string): unknown {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (name in record) return record[name] ?? null;
  const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return match === undefined ? null : (record[match] ?? null);
}

/** Strips one `${{ }}` wrapper, which a job or step `if` may carry or omit. */
function unwrap(source: string): string {
  const match = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(source);
  return match && !/\$\{\{|\}\}/.test(match[1] as string) ? (match[1] as string) : source;
}

export function evaluate(
  source: string,
  context: Record<string, unknown>,
  status: StatusFunctions,
): unknown {
  const body = unwrap(source);
  return new Parser(tokenize(body), context, status, body).parse();
}

/** True when the condition names a status function, so GitHub adds no implicit `success()`. */
export function usesStatusFunction(source: string): boolean {
  return tokenize(unwrap(source)).some(
    (token, index, all) =>
      token.kind === "ident" &&
      STATUS_FUNCTIONS.includes(token.value) &&
      all[index + 1]?.kind === "op" &&
      all[index + 1]?.value === "(",
  );
}

/** Evaluates a job or step `if`, adding GitHub's implicit `success() &&`. */
export function condition(
  source: unknown,
  context: Record<string, unknown>,
  status: StatusFunctions,
): boolean {
  if (source === undefined || source === null) return status.success();
  if (typeof source === "boolean") return source && status.success();
  const text = String(source);
  const value = truthy(evaluate(text, context, status));
  return usesStatusFunction(text) ? value : status.success() && value;
}

/** Replaces every `${{ }}` in a string the way the runner does before a value is used. */
export function interpolate(
  text: unknown,
  context: Record<string, unknown>,
  status: StatusFunctions,
): unknown {
  if (typeof text !== "string") return text;
  const whole = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(text);
  if (whole && !/\$\{\{|\}\}/.test(whole[1] as string)) {
    return evaluate(whole[1] as string, context, status);
  }
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, body: string) =>
    stringify(evaluate(body, context, status)),
  );
}
