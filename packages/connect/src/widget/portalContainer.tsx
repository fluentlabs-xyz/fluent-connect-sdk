import * as React from "react";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";

/** Colour scheme and design tokens for the widget's own UI — never around host content. */
export const WIDGET_STYLE_SCOPE = "fluent-root dark contents text-foreground";

/**
 * The top-layer host carries the same scope but must generate a real box —
 * `display: contents` would keep the `<dialog>` out of the top layer entirely.
 */
const TOP_LAYER_STYLE_SCOPE = "fluent-root dark text-foreground";

const FluentPortalContainerContext = createContext<HTMLElement | null>(null);

type FluentTopLayer = {
  element: HTMLDialogElement;
  /** Takes a hold on the top layer; returns the matching release. */
  acquire: () => () => void;
};

const FluentTopLayerContext = createContext<FluentTopLayer | null>(null);

const FluentToastLayerContext = createContext<HTMLElement | null>(null);

const FluentOpenSurfaceContext = createContext<HTMLElement | null>(null);

/** The widget surfaces a toast belongs inside while one is open. */
const OPEN_SURFACE_SELECTOR =
  '[data-slot="dialog-content"][data-open], [data-slot="drawer-popup"][data-open]';

/**
 * The topmost open dialog or drawer in the widget's own containers, or null.
 * Surfaces nest in document order, so the last match is the one in front.
 */
function findOpenSurface(roots: readonly HTMLElement[]): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const root of roots) {
    const matches = root.querySelectorAll<HTMLElement>(OPEN_SURFACE_SELECTOR);
    found = matches[matches.length - 1] ?? found;
  }
  return found;
}

/**
 * Provides the element widget overlays portal into, so they inherit the widget's
 * scope instead of landing on a bare `<body>` outside every token definition.
 *
 * The element is attached to `document.body` rather than rendered into the React
 * tree on purpose: overlays position themselves with `position: fixed`, and a
 * host mounting `<FluentWidget>` inside an element with `transform`, `filter` or
 * `contain` would turn that ancestor into their containing block and misplace
 * every one of them.
 *
 * Alongside it lives `dialog[data-fluent-top-layer]`, the host for the widget's
 * modal overlays. A host app that opens its own dialog with `showModal()` puts
 * it in the browser's top layer and makes the rest of the document inert — any
 * overlay we keep in the normal document is then covered and unclickable. Modal
 * overlays therefore portal into this `<dialog>`, and the first one to open
 * calls `showModal()` on it: it becomes the topmost modal, painted above the
 * host's dialog and exempt from its inertness. Elements in the top layer are
 * laid out against the viewport regardless of ancestors, so the `body`
 * constraint above is preserved for free.
 */
export function FluentPortalContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [topLayer, setTopLayer] = useState<FluentTopLayer | null>(null);
  const [toastLayer, setToastLayer] = useState<HTMLElement | null>(null);
  const [openSurface, setOpenSurface] = useState<HTMLElement | null>(null);
  const holdsRef = useRef(0);

  useIsomorphicLayoutEffect(() => {
    const element = document.createElement("div");
    element.setAttribute("data-fluent-portal-root", "");
    element.className = WIDGET_STYLE_SCOPE;
    document.body.appendChild(element);
    setContainer(element);

    // Toasts are passive: they must stay visible above any modal dialog without
    // claiming one themselves. A manual popover gives exactly that — top-layer
    // paint, no inertness, no light dismiss. Where the Popover API is missing
    // the attribute is ignored and the element behaves like today's plain root.
    const toasts = document.createElement("div");
    toasts.setAttribute("data-fluent-toast-layer", "");
    toasts.setAttribute("popover", "manual");
    toasts.className = TOP_LAYER_STYLE_SCOPE;
    document.body.appendChild(toasts);
    try {
      toasts.showPopover?.();
    } catch {
      /* already shown, or no Popover API */
    }
    setToastLayer(toasts);

    // The top layer paints in show order, so every `showModal()` below buries
    // the toasts; re-showing the popover puts them back on top.
    const promoteToasts = () => {
      try {
        toasts.hidePopover?.();
        toasts.showPopover?.();
      } catch {
        /* no Popover API — the layer already behaves like a plain root */
      }
    };

    const dialog = document.createElement("dialog");
    dialog.setAttribute("data-fluent-top-layer", "");
    dialog.className = TOP_LAYER_STYLE_SCOPE;
    // Esc must close the widget overlay open inside, not this host: the
    // overlay's own Esc handling closes it, and releasing the hold follows.
    const onCancel = (event: Event) => event.preventDefault();
    // Browsers may force-close a modal dialog past `cancel` (close watchers).
    // With overlays still mounted inside, losing the top layer would bury them
    // under the host's dialog again, so take it back.
    const onClose = () => {
      if (holdsRef.current > 0 && dialog.isConnected && !dialog.open) {
        try {
          dialog.showModal();
          promoteToasts();
        } catch {
          /* detached or already open — nothing to recover */
        }
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    document.body.appendChild(dialog);

    // A modal dialog makes everything outside its subtree inert, the top layer
    // included, so toasts painted above the dialog would still ignore clicks.
    // While the dialog is open the layer lives inside it, and goes back to
    // `body` before it closes. Leaving the DOM hides a popover, and showing it
    // again puts it last in the top layer, above the dialog.
    const placeToasts = (parent: HTMLElement) => {
      if (toasts.parentElement === parent) return;
      parent.appendChild(toasts);
      try {
        toasts.showPopover?.();
      } catch {
        /* already shown, or no Popover API */
      }
    };

    const acquire = () => {
      holdsRef.current += 1;
      if (holdsRef.current === 1 && dialog.isConnected && !dialog.open) {
        try {
          dialog.showModal();
          promoteToasts();
        } catch {
          /* jsdom without the polyfill, or a detached element */
        }
        placeToasts(dialog);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holdsRef.current -= 1;
        if (holdsRef.current === 0 && dialog.open) {
          // On unmount the provider tears down first: a dialog already removed
          // must not bring the removed layer back into `body`.
          if (dialog.isConnected) placeToasts(document.body);
          try {
            dialog.close();
          } catch {
            /* see above */
          }
        }
      };
    };
    setTopLayer({ element: dialog, acquire });

    // A toast raised while a dialog or drawer is open belongs inside it, not in
    // the viewport's corner beside it. Both surfaces are transformed, so the
    // toast viewport's `fixed` placement resolves against the surface once it
    // portals in there.
    const roots = [element, dialog];
    const trackOpenSurface = () => setOpenSurface(findOpenSurface(roots));
    const surfaceObserver = new MutationObserver(trackOpenSurface);
    for (const root of roots) {
      surfaceObserver.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-open"],
      });
    }

    return () => {
      surfaceObserver.disconnect();
      setOpenSurface(null);
      element.remove();
      setContainer(null);
      toasts.remove();
      setToastLayer(null);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      dialog.remove();
      setTopLayer(null);
    };
  }, []);

  return (
    <FluentPortalContainerContext.Provider value={container}>
      <FluentTopLayerContext.Provider value={topLayer}>
        <FluentToastLayerContext.Provider value={toastLayer}>
          <FluentOpenSurfaceContext.Provider value={openSurface}>
            {children}
          </FluentOpenSurfaceContext.Provider>
        </FluentToastLayerContext.Provider>
      </FluentTopLayerContext.Provider>
    </FluentPortalContainerContext.Provider>
  );
}

/** Mirrors the `container` prop base-ui portals accept. */
type PortalContainer =
  | HTMLElement
  | ShadowRoot
  | null
  | React.RefObject<HTMLElement | ShadowRoot | null>;

/**
 * Container for widget overlays. `override` wins when given; `undefined` means
 * "portal wherever you would by default", which is what components rendered
 * outside `<FluentWidget>` get.
 */
export function useFluentPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const container = useContext(FluentPortalContainerContext);
  return override ?? container ?? undefined;
}

/**
 * Container for the widget's *modal* overlays: the top-layer `<dialog>` when the
 * provider is up, falling back to the plain portal root (and from there to the
 * base-ui default) outside `<FluentWidget>`.
 */
export function useFluentModalPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const topLayer = useContext(FluentTopLayerContext);
  const container = useContext(FluentPortalContainerContext);
  return override ?? topLayer?.element ?? container ?? undefined;
}

/** The widget's top-layer host, for overlays that portal by hand. */
export function useFluentTopLayer(): FluentTopLayer | null {
  return useContext(FluentTopLayerContext);
}

/** The widget's toast layer element, for code that manages it by hand. */
export function useFluentToastLayer(): HTMLElement | null {
  return useContext(FluentToastLayerContext);
}

/** The widget dialog or drawer open in front, which toasts sit inside; null when none is. */
export function useFluentOpenSurface(): HTMLElement | null {
  return useContext(FluentOpenSurfaceContext);
}

/**
 * Container for toasts: the open widget dialog or drawer, so a toast stays
 * within it, else the always-open popover layer when the provider is up,
 * falling back like the other container hooks outside `<FluentWidget>`.
 */
export function useFluentToastPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const openSurface = useContext(FluentOpenSurfaceContext);
  const toastLayer = useContext(FluentToastLayerContext);
  const container = useContext(FluentPortalContainerContext);
  return override ?? openSurface ?? toastLayer ?? container ?? undefined;
}

/**
 * Marks its children as content of a modal overlay: holds the top-layer
 * `<dialog>` open for as long as they are mounted, and reroutes every portal
 * opened from inside them (selects, tooltips, nested dialogs) into that same
 * element — portalled to the normal root they would be inert under it.
 */
export function FluentTopLayerSlot({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const topLayer = useContext(FluentTopLayerContext);
  const active = !disabled && topLayer !== null;

  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    return topLayer.acquire();
  }, [active, topLayer]);

  if (!active) return <>{children}</>;
  return (
    <FluentPortalContainerContext.Provider value={topLayer.element}>
      {children}
    </FluentPortalContainerContext.Provider>
  );
}
