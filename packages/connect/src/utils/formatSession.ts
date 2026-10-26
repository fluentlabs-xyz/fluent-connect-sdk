import { type FluentWidgetSession } from "../core/config";

/** The debug panel's dump of the session a host receives: the projection, never the stored one. */
export function formatSession(session: FluentWidgetSession | null): string {
  if (!session) return "Waiting for Fluent login";

  return JSON.stringify(session, null, 2);
}
