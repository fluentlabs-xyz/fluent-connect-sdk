import { useCallback, useEffect, useState } from "react";

import {
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  type FluentWidgetSession,
} from "../../core/config";
import { debugLog } from "../../core/debugLogger";

function hydrateSession(): FluentWidgetSession | null {
  try {
    const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FluentWidgetSession) : null;
  } catch {
    return null;
  }
}

/**
 * Owns the widget session: localStorage hydration, and a single `setSession`
 * that is the one place the session is written — it reports analytics, notifies
 * the host via `onSessionChange`, and persists (or clears) storage. Callers no
 * longer scatter `localStorage.setItem(SESSION_KEY, …)` across connect paths.
 */
export function useFluentSession(params: {
  reportAnalyticsSession: (session: FluentWidgetSession | null) => void;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
}) {
  const { reportAnalyticsSession, onSessionChange } = params;
  const [session, setSessionState] = useState<FluentWidgetSession | null>(hydrateSession);

  const setSession = useCallback(
    (nextSession: FluentWidgetSession | null) => {
      debugLog("[fluent widget] setSession", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id,
        signerAddress: nextSession?.wallet?.signerAddress,
        smartAccountAddress: nextSession?.wallet?.smartAccountAddress,
        scopes: nextSession?.scopes,
      });
      reportAnalyticsSession(nextSession);
      setSessionState(nextSession);
      onSessionChange?.(nextSession);
      try {
        if (nextSession) {
          window.localStorage.setItem(
            FLUENT_WIDGET_SESSION_STORAGE_KEY,
            JSON.stringify(nextSession),
          );
        } else {
          window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
        }
      } catch {
        // Private mode / storage disabled: the in-memory session still drives UI.
      }
    },
    [onSessionChange, reportAnalyticsSession],
  );

  // A session restored by the useState initializer never passes through
  // setSession, so without this every returning visitor's events would go out
  // with no addresses (the whole has_stored_session cohort).
  useEffect(() => {
    reportAnalyticsSession(session);
    // Mount only: setSession owns every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, setSession };
}
