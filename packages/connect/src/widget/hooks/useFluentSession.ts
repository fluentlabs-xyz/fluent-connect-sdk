import { useCallback, useEffect, useState } from "react";

import {
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  toFluentWidgetSession,
  type FluentStoredSession,
  type FluentWidgetSession,
} from "../../core/config";
import { debugLog } from "../../core/debugLogger";

function hydrateSession(): FluentStoredSession | null {
  try {
    const raw = window.localStorage.getItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as FluentStoredSession;
    // Storage is the App's origin's to change: a stored session `toFluentWidgetSession` rejects
    // is removed and reads as none, so nothing that reads the stored session sees it, and Direct
    // login issues a new one.
    if (toFluentWidgetSession(stored)) return stored;
    window.localStorage.removeItem(FLUENT_WIDGET_SESSION_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the widget's stored session, read from localStorage on mount, and `setSession`, the one
 * place it is written: it reports analytics, hands `onSessionChange` the Widget session
 * (`toFluentWidgetSession`), and writes or clears storage.
 */
export function useFluentSession(params: {
  reportAnalyticsSession: (session: FluentStoredSession | null) => void;
  onSessionChange?: (session: FluentWidgetSession | null) => void;
}) {
  const { reportAnalyticsSession, onSessionChange } = params;
  const [session, setSessionState] = useState<FluentStoredSession | null>(hydrateSession);

  const setSession = useCallback(
    (nextSession: FluentStoredSession | null) => {
      debugLog("[fluent widget] setSession", {
        hasSession: Boolean(nextSession),
        smartAccountAddress: nextSession?.wallet?.smartAccountAddress,
        scopes: nextSession?.scopes,
      });
      reportAnalyticsSession(nextSession);
      setSessionState(nextSession);
      onSessionChange?.(toFluentWidgetSession(nextSession));
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
