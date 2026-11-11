import * as React from "react";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";

/** Colour scheme and design tokens for the widget's own UI, never around App content. */
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
 * The provider of the elements the widget's overlays portal into. They are appended to
 * `document.body`, not rendered in the React tree, so overlays carry the widget's style scope and
 * an App's `transform`, `filter` or `contain` ancestor cannot become their containing block.
 *
 * Beside the plain root it adds `dialog[data-fluent-top-layer]` for modal overlays: an App's own
 * `showModal()` makes the rest of the document inert, so the first modal overlay to open calls
 * `showModal()` on this host, which becomes the topmost modal, painted above the App's dialog and
 * exempt from its inertness. It also adds the toast layer, a manual popover.
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

    // Toasts stay visible above any modal dialog without claiming one: a manual popover paints
    // in the top layer with no inertness and no light dismiss. Without the Popover API the
    // attribute is ignored and the element is a plain root.
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
    // under an App's dialog again, so take it back.
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

    // A modal dialog makes everything outside it inert, top layer included, so the toast layer
    // lives inside the dialog while it is open. Moving a popover hides it, and showing it again
    // puts it last in the top layer, above the dialog.
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

    // A toast raised while a widget dialog or drawer is open belongs inside it: both are
    // transformed, so the toast viewport's `fixed` placement resolves against the surface.
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
 * Returns the container for widget overlays: `override` when given, else the portal root. Outside
 * `<FluentWidget>` it is `undefined`, which means "portal wherever you would by default".
 */
export function useFluentPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const container = useContext(FluentPortalContainerContext);
  return override ?? container ?? undefined;
}

/**
 * Returns the container for the widget's modal overlays: the top-layer `<dialog>` when the
 * provider is up, else the plain portal root, and the base-ui default outside `<FluentWidget>`.
 */
export function useFluentModalPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const topLayer = useContext(FluentTopLayerContext);
  const container = useContext(FluentPortalContainerContext);
  return override ?? topLayer?.element ?? container ?? undefined;
}

/** Returns the widget's top-layer host, for overlays that portal by hand. */
export function useFluentTopLayer(): FluentTopLayer | null {
  return useContext(FluentTopLayerContext);
}

/** Returns the widget's toast layer element, for code that manages it by hand. */
export function useFluentToastLayer(): HTMLElement | null {
  return useContext(FluentToastLayerContext);
}

/** Returns the widget dialog or drawer open in front, which toasts sit inside, or null. */
export function useFluentOpenSurface(): HTMLElement | null {
  return useContext(FluentOpenSurfaceContext);
}

/**
 * Returns the container for toasts: the open widget dialog or drawer, so a toast stays within it,
 * else the always-open popover layer when the provider is up, falling back like the other
 * container hooks outside `<FluentWidget>`.
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
 * A wrapper that marks its children as content of a modal overlay: it holds the top-layer
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
