import type { FluentWidgetSession } from "../core/config";

/**
 * Returns the debug panel's dump of the Widget session an App receives, not of the stored
 * session it is projected from.
 */
export function formatSession(session: FluentWidgetSession | null): string {
  if (!session) return "Waiting for Fluent login";

  return JSON.stringify(session, null, 2);
}
