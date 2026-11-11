/**
 * Shortens every address in a string to the form `0x83Fed707…42D8E`. A regex rather than a
 * slice, because the strings are usually a sentence with an address inside (`decided_by`, an
 * `approve` call), and the words around it are worth keeping.
 */
export function shortenHex(value: string) {
  return value.replace(/0x[0-9a-fA-F]{40}/g, (hex) => `${hex.slice(0, 8)}…${hex.slice(-4)}`);
}

/**
 * Returns the service's answer indented, or exactly as it arrived when it is not JSON, such as
 * the gate's plain-text `origin not allowed`. It is the page's one unrounded view: re-serialising
 * changes only whitespace and key order, though an integer past 2^53 would round.
 */
export function formatVerdict(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
