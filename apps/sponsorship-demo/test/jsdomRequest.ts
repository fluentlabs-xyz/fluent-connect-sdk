/**
 * Lets viem's `http()` transport run under jsdom: it builds a `Request` with a jsdom
 * `AbortSignal`, which Node 24's `Request` refuses. Tests fake `fetch`, so nothing needs
 * aborting; the signal is dropped only on a Node that refuses it. The demo-app copy of the
 * same stand-in in `packages/connect/test/jsdomPolyfills.ts`, which this app has no setup file
 * to load.
 */
const NativeRequest = globalThis.Request;
const requestTakesJsdomSignal = (() => {
  try {
    new NativeRequest("http://localhost/", { signal: new AbortController().signal });
    return true;
  } catch {
    return false;
  }
})();
if (!requestTakesJsdomSignal) {
  globalThis.Request = class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init?.signal ? { ...init, signal: undefined } : init);
    }
  };
}
