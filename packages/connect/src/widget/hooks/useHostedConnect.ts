import { useCallback, useEffect, useRef, useState } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import {
  FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY,
  type FluentWidgetSession,
} from "../../core/config";
import { debugLog, debugWarn } from "../../core/debugLogger";

const FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY = "fluent:widget:auth-state:v1";

type HostedFluentConnect = {
  buildAuthorizeUrl: (state: string) => URL;
  setSession: (session: FluentWidgetSession) => void;
  status: () => { app: { origin?: string } };
};

/**
 * The hosted-popup connect flow: builds the authorize URL, and listens for the
 * result via `postMessage` and the `#fluent_connect_result` hash return,
 * validating state + origin + smart-account before applying the session. Owns
 * its own popup/state refs — independent of the direct-auth and disconnect refs.
 */
export function useHostedConnect(params: {
  fluentConnect: HostedFluentConnect;
  authorizeUrl: string;
  clientId: string;
  appName: string;
  authMode: string;
  setSession: (session: FluentWidgetSession | null) => void;
  resetInitialization: () => void;
  setConnectOpen: (open: boolean) => void;
  setStatus: (status: string | null) => void;
  setError: (error: string | null) => void;
  smartAccountRefresh: () => Promise<unknown>;
  track: FluentAnalyticsTrack;
}) {
  const {
    fluentConnect,
    authorizeUrl,
    clientId,
    appName,
    authMode,
    setSession,
    resetInitialization,
    setConnectOpen,
    setStatus,
    setError,
    smartAccountRefresh,
    track,
  } = params;

  const [hostedAuthorizeUrl, setHostedAuthorizeUrl] = useState<string | undefined>();
  const hostedConnectWindow = useRef<Window | null>(null);
  const hostedConnectState = useRef<string | null>(null);

  const beginHostedConnect = useCallback(() => {
    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    hostedConnectState.current = state;
    try {
      window.sessionStorage.setItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY, state);
    } catch {
      // In-memory state still protects popup flows when storage is unavailable.
    }
    const url = fluentConnect.buildAuthorizeUrl(state).toString();
    debugLog("[fluent widget] open connect", { state, authorizeUrl: url, clientId, appName, authMode });
    setHostedAuthorizeUrl(url);
    setConnectOpen(true);
  }, [appName, authMode, clientId, fluentConnect, setConnectOpen]);

  const acceptHostedResult = useCallback(
    (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as {
        type?: string;
        error?: string;
        state?: string;
        session?: FluentWidgetSession;
        privyIdentityToken?: string | null;
      };
      if (payload.type === "fluent:connect:error") {
        track("connect_login_failed", { reason: "hosted_error" });
        setError(typeof payload.error === "string" ? payload.error : "Fluent Connect login failed");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (payload.type !== "fluent:connect:session" || !payload.session) return;

      let expectedState = hostedConnectState.current;
      try {
        expectedState ??= window.sessionStorage.getItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
      } catch {
        // Fall back to the in-memory state.
      }
      if (!payload.state || !expectedState || payload.state !== expectedState) {
        track("connect_login_failed", { reason: "state_mismatch" });
        setError("Fluent Connect login failed state validation");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (payload.session.app?.origin && payload.session.app.origin !== fluentConnect.status().app.origin) {
        track("connect_login_failed", { reason: "origin_mismatch" });
        setError("Fluent Connect session origin does not match this app");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }
      if (!payload.session.wallet?.smartAccountAddress) {
        track("connect_login_failed", { reason: "smart_account_missing" });
        setError("Fluent smart account is not ready. Reconnect with Fluent ID.");
        hostedConnectWindow.current?.close();
        hostedConnectWindow.current = null;
        return;
      }

      const nextIdentityToken =
        typeof payload.privyIdentityToken === "string" ? payload.privyIdentityToken : null;
      debugLog("[fluent widget] hosted result accepted", {
        userId: payload.session.user?.id,
        signerAddress: payload.session.wallet?.signerAddress,
        smartAccountAddress: payload.session.wallet?.smartAccountAddress,
        scopes: payload.session.scopes,
        hasIdentityToken: Boolean(nextIdentityToken),
      });
      setSession(payload.session);
      track("connect_login_completed");
      resetInitialization();
      fluentConnect.setSession(payload.session);
      // setSession above persists the session key; only the identity token is separate.
      if (nextIdentityToken) {
        window.localStorage.setItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY, nextIdentityToken);
      } else {
        window.localStorage.removeItem(FLUENT_WIDGET_IDENTITY_TOKEN_STORAGE_KEY);
      }
      setStatus("Wallet connected!");
      setError(null);
      setConnectOpen(false);
      hostedConnectState.current = null;
      try {
        window.sessionStorage.removeItem(FLUENT_WIDGET_AUTH_STATE_STORAGE_KEY);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
      window.setTimeout(() => {
        smartAccountRefresh().catch((error) => {
          debugWarn("[fluent widget] ZeroDev account not ready after hosted login", error);
        });
      }, 250);
    },
    [fluentConnect, resetInitialization, setConnectOpen, setError, setSession, setStatus, smartAccountRefresh, track],
  );

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const rawResult = hash.get("fluent_connect_result");
    if (!rawResult) return;

    try {
      acceptHostedResult(JSON.parse(rawResult));
    } catch {
      setError("Could not parse Fluent Connect result");
    } finally {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }, [acceptHostedResult, setError]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(authorizeUrl, location.href).origin) return;
      if (!event.data) return;
      acceptHostedResult(event.data);
    }

    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [acceptHostedResult, authorizeUrl]);

  useEffect(() => {
    return () => {
      hostedConnectWindow.current?.close();
      hostedConnectWindow.current = null;
    };
  }, []);

  return { hostedAuthorizeUrl, beginHostedConnect };
}
