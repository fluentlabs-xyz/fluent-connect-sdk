import * as React from "react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  const holdsRef = useRef(0);

  useLayoutEffect(() => {
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
        } catch {
          /* detached or already open — nothing to recover */
        }
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    document.body.appendChild(dialog);

    const acquire = () => {
      holdsRef.current += 1;
      if (holdsRef.current === 1 && dialog.isConnected && !dialog.open) {
        try {
          dialog.showModal();
        } catch {
          /* jsdom without the polyfill, or a detached element */
        }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holdsRef.current -= 1;
        if (holdsRef.current === 0 && dialog.open) {
          try {
            dialog.close();
          } catch {
            /* see above */
          }
        }
      };
    };
    setTopLayer({ element: dialog, acquire });

    return () => {
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
          {children}
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

/**
 * Container for toasts: the always-open popover layer when the provider is up,
 * falling back like the other container hooks outside `<FluentWidget>`.
 */
export function useFluentToastPortalContainer(
  override?: PortalContainer,
): PortalContainer | undefined {
  const toastLayer = useContext(FluentToastLayerContext);
  const container = useContext(FluentPortalContainerContext);
  return override ?? toastLayer ?? container ?? undefined;
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

  useLayoutEffect(() => {
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
