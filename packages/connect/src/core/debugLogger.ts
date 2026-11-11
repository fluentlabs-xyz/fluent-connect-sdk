/**
 * Whether the widget's debug logs reach the console. They carry connect, account and signing
 * state: useful when diagnosing an integration, noisy and partly identifying in an App's
 * production console.
 *
 * A module-level flag rather than a prop, because modules outside React (`zerodevSession`,
 * `copyAddress`, …) log too. `<FluentWidget>` sets it from its `debugLogging` prop.
 */
let debugLoggingEnabled = false;

/** Turns the widget's debug logging on or off; `<FluentWidget>` calls it on every render. */
export function setDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;
}

/** Reports whether the widget's debug logging is on. */
export function isDebugLoggingEnabled(): boolean {
  return debugLoggingEnabled;
}

/** Calls `console.log` with `args` when debug logging is on. */
export function debugLog(...args: unknown[]): void {
  if (debugLoggingEnabled) console.log(...args);
}

/** Calls `console.warn` with `args` when debug logging is on. */
export function debugWarn(...args: unknown[]): void {
  if (debugLoggingEnabled) console.warn(...args);
}

/** Calls `console.error` with `args` when debug logging is on. */
export function debugError(...args: unknown[]): void {
  if (debugLoggingEnabled) console.error(...args);
}
