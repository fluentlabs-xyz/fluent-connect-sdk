/**
 * `0x83Fed707…42D8E`, with the whole string kept for the `title`.
 *
 * A regex over the value rather than a slice of it, because the strings this page shortens
 * are usually a sentence with an address inside — `decided_by`, an `approve` call — and the
 * words around the address are the part worth keeping.
 */
export function shortenHex(value: string) {
  return value.replace(/0x[0-9a-fA-F]{40}/g, (hex) => `${hex.slice(0, 8)}…${hex.slice(-4)}`);
}

/**
 * The service's answer, indented — or exactly as it arrived, when it is not JSON.
 *
 * This block is the one place on the page where nothing is rounded, renamed or summarised,
 * so re-serialising has to be provably lossless: `JSON.parse` then `JSON.stringify` changes
 * whitespace and key order only, and any input it cannot parse is passed through untouched
 * rather than repaired. An error body — the gate answers `origin not allowed` in plain text
 * — must still be readable here, because that sentence is the diagnosis.
 *
 * The one thing it does not preserve is a number's original spelling. Nothing in today's
 * verdict is at risk — every field is a bool, a string or an array of them — but a field
 * sent as a bare integer past 2^53 would round here, and would have to be read raw.
 */
export function formatVerdict(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
