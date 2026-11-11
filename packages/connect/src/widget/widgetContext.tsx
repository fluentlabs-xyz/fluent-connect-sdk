import { createContext, useContext, type ReactNode } from "react";

import type { FluentStoredSession } from "../core/config";
import type { FluentWidgetRenderContext } from "./FluentWidget";

const FluentWidgetContext = createContext<FluentWidgetRenderContext | null>(null);

/**
 * The widget's own stored session, for the widget's own hooks below the provider (`useLinkX`
 * resumes a link for its subject). Internal: an App reads the Widget session on the render
 * context.
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
 * Returns the render context of the enclosing `<FluentWidget>`: the object `renderHome` and
 * `renderPage` receive, with the Widget API as its `widget`.
 *
 * Throws an `Error` when called outside `<FluentWidget>`.
 *
 * @example
 * ```tsx
 * import { useFluentWidget } from "@fluent.xyz/connect";
 *
 * const calls = [
 *   { to: "0x000000000000000000000000000000000000dEaD", value: 1n, data: "0x" },
 * ] as const;
 *
 * export function Send() {
 *   const { widget, status } = useFluentWidget();
 *   if (status !== "connected") return null;
 *   return <button onClick={() => widget.createBatchOp({ calls }).execute()}>Send</button>;
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

/** Returns the stored session behind the render context's Widget session. Internal. */
export function useFluentStoredSession(): FluentStoredSession | null {
  return useContext(FluentStoredSessionContext);
}
