import { createContext, useContext, type ReactNode } from "react";

import type { FluentBatchApi } from "./batchOperation";
import type { FluentWidgetRenderContext } from "./FluentWidget";

const FluentWidgetContext = createContext<FluentWidgetRenderContext | null>(null);

export function FluentWidgetProvider({
  value,
  children,
}: {
  value: FluentWidgetRenderContext;
  children: ReactNode;
}) {
  return (
    <FluentWidgetContext.Provider value={value}>
      {children}
    </FluentWidgetContext.Provider>
  );
}

/**
 * Access the Fluent widget render context from any component rendered inside
 * `<FluentWidget>` (e.g. within `renderHome` / `renderPage`). Returns the same
 * object the render props receive — `session`, `widget`, `openConnect`, etc. —
 * so host apps no longer need to prop-drill it.
 *
 * Throws if used outside `<FluentWidget>`.
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

/** Convenience hook returning just the widget API (`createBatchOp`, permissions, account…). */
export function useWidget(): FluentBatchApi {
  return useFluentWidget().widget;
}

/**
 * Like `useWidget`, but returns `null` instead of throwing when there is no
 * provider. For components that live inside the widget in production yet are
 * also mounted standalone by the preview harness (`apps/widget-preview`), which
 * has no session and nothing to execute against.
 */
export function useWidgetOptional(): FluentBatchApi | null {
  return useContext(FluentWidgetContext)?.widget ?? null;
}
