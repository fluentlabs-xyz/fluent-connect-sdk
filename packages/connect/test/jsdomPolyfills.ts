/**
 * The browser APIs jsdom does not implement, for the tests that render widget UI.
 *
 * jsdom is a DOM, not a browser: layout, media queries and element observation
 * are all missing, and the component libraries the widget is built on call them
 * unconditionally. Each one here is the smallest stand-in that lets the
 * component mount — never a behaviour a test is allowed to assert on.
 *
 * Loaded for every test file; the guard keeps it out of the way of the ones that
 * run in Node with no DOM at all.
 */
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub;
    globalThis.ResizeObserver = ResizeObserverStub;
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom ships the Popover API's attributes but not its methods, which is what
  // the anchored popups (Select, the account menu) call when they open.
  for (const method of ["showPopover", "hidePopover", "togglePopover"] as const) {
    if (!(method in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, method, {
        configurable: true,
        writable: true,
        value: () => {},
      });
    }
  }
}
