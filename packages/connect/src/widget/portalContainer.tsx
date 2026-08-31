import * as React from "react";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

/** Colour scheme and design tokens for the widget's own UI — never around host content. */
export const WIDGET_STYLE_SCOPE = "fluent-root dark contents text-white";

const FluentPortalContainerContext = createContext<HTMLElement | null>(null);

/**
 * Provides the element widget overlays portal into, so they inherit the widget's
 * scope instead of landing on a bare `<body>` outside every token definition.
 *
 * The element is attached to `document.body` rather than rendered into the React
 * tree on purpose: overlays position themselves with `position: fixed`, and a
 * host mounting `<FluentWidget>` inside an element with `transform`, `filter` or
 * `contain` would turn that ancestor into their containing block and misplace
 * every one of them.
 */
export function FluentPortalContainerProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.setAttribute("data-fluent-portal-root", "");
    element.className = WIDGET_STYLE_SCOPE;
    document.body.appendChild(element);
    setContainer(element);
    return () => {
      element.remove();
      setContainer(null);
    };
  }, []);

  return (
    <FluentPortalContainerContext.Provider value={container}>
      {children}
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
