import { BaseError, HttpRequestError, decodeErrorResult, isHex, type Hex } from "viem";

/**
 * Why an operation was not sponsored, and the `code` of a `FluentSponsorshipFallbackError`.
 * `not_requested` is the only one that is not a failure: the caller asked to pay its own gas,
 * so the sponsorship paymaster was never contacted. For the same reason it is never the error's
 * code, which is thrown only after a sponsored attempt failed: the error carries one of the
 * other four.
 */
export type FluentSponsorshipReason =
  | "no_token"
  | "denied"
  | "unauthorized"
  | "unreachable"
  | "not_requested";

export type FluentSponsorshipFailure = {
  reason: FluentSponsorshipReason;
  /**
   * Whether the widget should stop trying for the rest of its life. Only a 403 says
   * something durable about the *App* ("not sponsored here"). A 401 says only that this
   * bearer was not accepted, and the bearer is the short-lived Fluent token from
   * `getAuthToken()`: the caller answers it by forcing one fresh token and retrying the
   * operation once (`sendWithSponsorship`). Latching on a 401 would leave a long-lived tab
   * paying its own gas over a token that the next exchange replaces.
   */
  disableSponsorship: boolean;
};

/**
 * Both the sponsored submission and the fallback, the account paying its own gas, failed.
 * `code` (equal to `sponsorshipReason`) says why Sponsorship was refused: `no_token`, `denied`,
 * `unauthorized` or `unreachable`, never `not_requested`. `fallbackError` is what the own-gas
 * submission failed with, and `cause` the sponsored submission's error.
 *
 * Neither is the error that was thrown. Each is a plain object `{ name, message, status? }`:
 * `name` is the thrown error's name (`"Error"` for a thrown value that is not an `Error`),
 * `message` the text of the innermost error along its `cause` chain that has any (an
 * `AggregateError` gives the texts of its first four `errors`), and `status` the first integer
 * `status` along that chain, such as an HTTP status, present only when there is one; the chain
 * itself is not kept. A thrown value that cannot be read without an exception is summarized as
 * `{ name: "Error", message: "[unreadable error]" }`.
 *
 * In `message`, here and in each of the two, a balanced `{…}` or `[…]` span becomes `[body]`, a
 * `scheme://` URL `[url]`, a `Bearer` token or a JWT `[token]`, a `did:` id or a UUID `[id]`, an
 * email address `[email]`, and `0x` with 40 or 64 hex digits `[address]` or `[hash]`. Any other
 * `0x` run of 40 or more hex digits becomes `[data 0x…]` with its first four bytes, and the
 * reason of an `Error(string)` revert is decoded and redacted in the same way.
 */
export class FluentSponsorshipFallbackError extends Error {
  readonly code: FluentSponsorshipReason;
  readonly sponsorshipReason: FluentSponsorshipReason;
  readonly fallbackError: unknown;

  constructor(params: {
    sponsorshipReason: FluentSponsorshipReason;
    /** The sponsored submission's error, retained as `cause` once summarized. */
    sponsorshipError: unknown;
    /** The own-gas submission's error, retained as `fallbackError` once summarized. */
    fallbackError: unknown;
  }) {
    const sponsorshipError = summarizeSubmissionError(params.sponsorshipError);
    const fallbackError = summarizeSubmissionError(params.fallbackError);
    super(
      `Gas sponsorship failed: ${sponsorshipError.message}\n` +
        `Paying gas from the smart account also failed: ${fallbackError.message}`,
      { cause: sponsorshipError },
    );
    this.name = "FluentSponsorshipFallbackError";
    this.code = params.sponsorshipReason;
    this.sponsorshipReason = params.sponsorshipReason;
    this.fallbackError = fallbackError;
  }
}

/**
 * A submission error as a host may read it: the vendor errors under a submission carry the
 * request they failed on (the RPC URL with its project key, the request body with the account's
 * address and signature) and whatever text the vendor echoed back, and a host logs `cause` and
 * `fallbackError` whole (FLU-1637).
 */
type SubmissionErrorSummary = { name: string; message: string; status?: number };

/**
 * How many links of a cause chain are read, how many errors of an `AggregateError`, and how
 * deep `AggregateError`s nest before their errors are no longer read.
 */
const MAX_CHAIN = 16;
const MAX_AGGREGATED = 4;
const MAX_AGGREGATE_DEPTH = 2;

/**
 * Never throws: every read below can run a vendor's getter or proxy trap, and an error escaping
 * from here would replace this one, unredacted and without its `code`.
 */
function summarizeSubmissionError(error: unknown): SubmissionErrorSummary {
  try {
    const chain = causeChain(error);
    const summary: SubmissionErrorSummary = {
      name: redactVendorText(errorName(error)),
      message: redactVendorText(chainText(chain)),
    };
    const status = firstStatus(chain);
    if (status !== undefined) summary.status = status;
    return summary;
  } catch {
    return { name: "Error", message: "[unreadable error]" };
  }
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "Error";
  const name: unknown = Reflect.get(error, "name");
  return typeof name === "string" ? name : "Error";
}

/** The error and its `cause`s, outermost first, ending at a repeat or after `MAX_CHAIN`. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && chain.length < MAX_CHAIN && !chain.includes(current)) {
    chain.push(current);
    current = isObject(current) ? Reflect.get(current, "cause") : undefined;
  }
  return chain;
}

/** The innermost link that has any text: the vendor's own sentence sits deepest. */
function chainText(chain: unknown[], depth = 0): string {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const text = linkText(chain[index], depth);
    if (text) return text;
  }
  return "";
}

function linkText(link: unknown, depth: number): string {
  if (typeof link === "string") return link;
  if (typeof link === "number" || typeof link === "boolean" || typeof link === "bigint") {
    return String(link);
  }
  if (!isObject(link)) return "";
  if (link instanceof BaseError) {
    // viem's RPC wrappers put the provider's actual message in `details`; their
    // `message` also contains request arguments, URLs and library metadata.
    const details: unknown = Reflect.get(link, "details");
    if (typeof details === "string" && details) return detailsText(details);
    const shortMessage: unknown = Reflect.get(link, "shortMessage");
    return typeof shortMessage === "string" ? shortMessage : "";
  }
  if (
    depth < MAX_AGGREGATE_DEPTH &&
    typeof AggregateError === "function" &&
    link instanceof AggregateError
  ) {
    const errors: unknown = Reflect.get(link, "errors");
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .slice(0, MAX_AGGREGATED)
        .map((inner) => chainText(causeChain(inner), depth + 1))
        .filter(Boolean)
        .join("; ");
    }
  }
  const message: unknown = Reflect.get(link, "message");
  return typeof message === "string" ? message : "";
}

/**
 * viem's `http()` stringifies a non-JSON-RPC error body into `details`: a plain-text body arrives
 * quoted, and of a JSON object only its `message` says anything a host can act on.
 */
function detailsText(details: string): string {
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed === "string") return parsed;
    const message: unknown = isObject(parsed) ? Reflect.get(parsed, "message") : undefined;
    return typeof message === "string" ? message : details;
  } catch {
    return details;
  }
}

/** The first integer `status` along the chain: viem's `HttpRequestError` sits anywhere. */
function firstStatus(chain: unknown[]): number | undefined {
  for (const link of chain) {
    const status: unknown = isObject(link) ? Reflect.get(link, "status") : undefined;
    if (typeof status === "number" && Number.isInteger(status)) return status;
  }
  return undefined;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Each `{…}` or `[…]` span that balances, read as JSON would be: brackets inside a double-quoted
 * string do not count. Each balanced span is replaced on its own, so the text between two bodies
 * survives; an opening bracket that never closes is kept as text.
 */
function redactBodies(text: string): string {
  const closing: Record<string, string> = { "{": "}", "[": "]" };
  const spans: Array<[number, number]> = [];
  const open: number[] = [];
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"' && open.length > 0) {
      inString = true;
    } else if (char === "{" || char === "[") {
      open.push(index);
    } else if (char === "}" || char === "]") {
      const start = open.at(-1);
      if (start !== undefined && closing[text.charAt(start)] === char) {
        open.pop();
        // An inner span is dropped once its enclosing span closes around it.
        while (spans.length > 0 && (spans.at(-1)?.[0] ?? -1) > start) spans.pop();
        spans.push([start, index + 1]);
      } else {
        open.length = 0;
      }
    }
  }
  let redacted = text;
  for (const [start, end] of spans.reverse()) {
    redacted = `${redacted.slice(0, start)}[body]${redacted.slice(end)}`;
  }
  return redacted;
}

/**
 * Bodies go first, so a URL or address inside one does not survive as a fragment; the
 * placeholders are bracketed, which no later pattern matches. No pattern waits for a word
 * boundary: `id_token_eyJ…` and `auth=Bearer%20…` put a word character right before the secret.
 */
const VENDOR_TEXT_REDACTIONS: Array<[RegExp, string]> = [
  // Every character RFC 3986 allows in a URL, the apostrophe and the brackets included.
  [/[a-z][a-z\d+.-]*:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/gi, "[url]"],
  [/Bearer(?:\s|%20|\+)+(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gi, "[token]"],
  // A JWT: three base64url segments, the first a JSON header of at least 16 characters.
  [/[\w-]{16,}\.[\w-]{2,}\.[\w-]*/g, "[token]"],
  [/did:[a-z\d]+:[\w.:%-]+/gi, "[id]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi, "[id]"],
];

const ERROR_STRING_SELECTOR = "0x08c379a0";

/**
 * An address is 40 hex digits, a hash 64; any other run this long is call data, a signature or
 * revert data, of which the 4-byte selector names the error and identifies nobody. The reason of
 * an `Error(string)` is decoded and redacted like any vendor text; a custom error's arguments
 * are not decoded, so an address among them stays hidden.
 */
function hexPlaceholder(match: string): string {
  if (match.length === 42) return "[address]";
  if (match.length === 66) return "[hash]";
  const selector = match.slice(0, 10).toLowerCase();
  return `[data ${selector}${selector === ERROR_STRING_SELECTOR ? errorStringReason(match) : ""}]`;
}

function errorStringReason(data: string): string {
  if (!isHex(data)) return "";
  try {
    const { args } = decodeErrorResult({ data: toLowerHex(data) });
    const reason: unknown = args?.[0];
    return typeof reason === "string" ? `: ${redactVendorText(reason)}` : "";
  } catch {
    return "";
  }
}

function toLowerHex(data: Hex): Hex {
  return `0x${data.slice(2).toLowerCase()}`;
}

function redactVendorText(text: string): string {
  let redacted = redactBodies(text);
  for (const [pattern, placeholder] of VENDOR_TEXT_REDACTIONS) {
    redacted = redacted.replace(pattern, placeholder);
  }
  return redacted.replace(/0x[\da-f]{40,}/gi, hexPlaceholder).trim();
}

/**
 * A policy denial arrives as an RPC error; the proxy's own 401/403/502 arrive as HTTP
 * errors. Same fallback, different reason. 401 and 403 share the reason and are told apart by
 * `disableSponsorship`, which is also what marks the 401 as the one failure a fresh Fluent
 * token can fix.
 */
export function getSponsorshipFailure(err: unknown): FluentSponsorshipFailure {
  const httpError =
    err instanceof BaseError
      ? (err.walk((e) => e instanceof HttpRequestError) as HttpRequestError | null)
      : null;
  if (!httpError) return { reason: "denied", disableSponsorship: false };
  if (httpError.status === 403) return { reason: "unauthorized", disableSponsorship: true };
  if (httpError.status === 401) return { reason: "unauthorized", disableSponsorship: false };
  return { reason: "unreachable", disableSponsorship: false };
}
