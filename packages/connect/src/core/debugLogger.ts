/**
 * Gated console logging for the widget.
 *
 * The widget's internals log a fair amount of connect / smart-account / signing
 * state that is useful when diagnosing an integration but noisy (and mildly
 * identifier-leaking) in production host consoles. All of it is routed through
 * these helpers so a single `debugLogging` prop on `<FluentWidget>` controls it.
 *
 * The flag is a module-level singleton because non-React modules
 * (`zerodevSession`, `copyAddress`, …) also log and have no access to props.
 * `<FluentWidget>` sets it from its `debugLogging` prop; defaults to `false`.
 */
let debugLoggingEnabled = false;

/** Enable/disable all widget debug logging. Called by `<FluentWidget>`. */
export function setDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;
}

/** Whether widget debug logging is currently on. */
export function isDebugLoggingEnabled(): boolean {
  return debugLoggingEnabled;
}

/** `console.log`, emitted only when debug logging is enabled. */
export function debugLog(...args: unknown[]): void {
  if (debugLoggingEnabled) console.log(...args);
}

/** `console.warn`, emitted only when debug logging is enabled. */
export function debugWarn(...args: unknown[]): void {
  if (debugLoggingEnabled) console.warn(...args);
}

/** `console.error`, emitted only when debug logging is enabled. */
export function debugError(...args: unknown[]): void {
  if (debugLoggingEnabled) console.error(...args);
}
