import { createContext, useContext, type ReactNode } from "react";

import type { FluentStoredSession } from "../core/config";
import type { FluentWidgetRenderContext } from "./FluentWidget";

const FluentWidgetContext = createContext<FluentWidgetRenderContext | null>(null);

/**
 * The widget's own stored session, for the widget's own hooks below the provider (`useLinkX`
 * resumes a link for its subject). Internal: a host reads the projection on the render context.
 */
const FluentStoredSessionContext = createContext<FluentStoredSession | null>(null);

export function FluentWidgetProvider({
  value,
  storedSession,
  children,
}: {
  value: FluentWidgetRenderContext;
  storedSession: FluentStoredSession | null;
  children: ReactNode;
}) {
  return (
    <FluentWidgetContext.Provider value={value}>
      <FluentStoredSessionContext.Provider value={storedSession}>
        {children}
      </FluentStoredSessionContext.Provider>
    </FluentWidgetContext.Provider>
  );
}

/**
 * Access the Fluent widget render context from any component rendered inside
 * `<FluentWidget>` (e.g. within `renderHome` / `renderPage`). Returns the same
 * object the render props receive — `session`, `widget`, `openConnect`, etc. —
 * so host apps no longer need to prop-drill it. The Widget API is
 * `useFluentWidget().widget`.
 *
 * Throws if used outside `<FluentWidget>`.
 *
 * @example
 * ```tsx
 * function Deposit() {
 *   const { widget, status } = useFluentWidget();
 *   if (status !== "connected") return null;
 *   return <button onClick={() => widget.createBatchOp({ calls }).execute()}>Deposit</button>;
 * }
 * ```
 */
export function useFluentWidget(): FluentWidgetRenderContext {
  const context = useContext(FluentWidgetContext);
  if (!context) {
    throw new Error(
      "useFluentWidget must be used within <FluentWidget> (e.g. inside renderHome/renderPage).",
    );
  }
  return context;
}

/** The stored session behind the render context's projection. Internal. */
export function useFluentStoredSession(): FluentStoredSession | null {
  return useContext(FluentStoredSessionContext);
}
