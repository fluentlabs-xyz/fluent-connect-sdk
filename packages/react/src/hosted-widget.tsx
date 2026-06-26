import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { FluentWidgetSession } from "./widget.js";

export type FluentHostedWidgetProps = {
  clientId: string;
  authorizeUrl: string;
  scopes?: string[];
  campaign?: string;
  source?: string;
  metadata?: Record<string, string | number | boolean>;
  onSession?: (session: FluentWidgetSession) => void;
  onError?: (error: Error) => void;
};

type FluentConnectMessage =
  | {
      type: "fluent:connect:session";
      state: string;
      session: FluentWidgetSession;
    }
  | {
      type: "fluent:connect:error";
      state: string;
      error: string;
    };

type BrowserWindowLike = {
  location: { href: string };
  screenX: number;
  outerWidth: number;
  screenY: number;
  outerHeight: number;
  open: (url: string, target: string, features: string) => PopupWindowLike | null;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
};

type PopupWindowLike = {
  close: () => void;
};

function browserWindow(): BrowserWindowLike {
  return globalThis as unknown as BrowserWindowLike;
}

function createState(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function popupFeatures(): string {
  const win = browserWindow();
  const width = 460;
  const height = 680;
  const left = Math.max(0, Math.round(win.screenX + (win.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(win.screenY + (win.outerHeight - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

const styles = {
  shell: {
    width: "min(100%, 380px)",
    border: "1px solid rgba(255, 255, 255, 0.10)",
    borderRadius: 18,
    overflow: "hidden",
    background: "rgba(0, 0, 0, 0.82)",
    color: "#f4f7fb",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxShadow: "0 20px 80px rgba(0, 0, 0, 0.28)",
    backdropFilter: "blur(12px)",
  } satisfies CSSProperties,
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 8,
  } satisfies CSSProperties,
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  mark: {
    display: "grid",
    placeItems: "center",
    width: 36,
    height: 36,
    borderRadius: 12,
    background: "#49EDED",
    color: "#030213",
    fontWeight: 800,
    fontSize: 16,
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontFamily: 'Bossa, Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: 18,
    fontWeight: 500,
    lineHeight: "22px",
  } satisfies CSSProperties,
  subtitle: {
    margin: 0,
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: 12,
    lineHeight: "16px",
  } satisfies CSSProperties,
  button: {
    border: "1px solid rgba(255, 255, 255, 0.30)",
    borderRadius: 12,
    minHeight: 44,
    padding: "10px 18px",
    background: "rgba(255, 255, 255, 0.02)",
    color: "#f4f7fb",
    fontSize: 16,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  status: {
    margin: 0,
    padding: "0 16px 14px",
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: 12,
    lineHeight: "17px",
  } satisfies CSSProperties,
};

export function FluentHostedWidget({
  clientId,
  authorizeUrl,
  scopes = ["openid", "profile", "wallet", "faucet"],
  campaign,
  source,
  metadata,
  onSession,
  onError,
}: FluentHostedWidgetProps) {
  const [session, setSession] = useState<FluentWidgetSession | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pendingState = useRef<string | null>(null);
  const popupRef = useRef<PopupWindowLike | null>(null);
  const authorizeOrigin = useMemo(() => new URL(authorizeUrl, browserWindow().location.href).origin, [authorizeUrl]);

  useEffect(() => {
    const win = browserWindow();
    function onMessage(event: MessageEvent) {
      if (event.origin !== authorizeOrigin) return;
      const data = event.data as FluentConnectMessage;
      if (!data || data.state !== pendingState.current) return;

      if (data.type === "fluent:connect:error") {
        const error = new Error(data.error);
        setStatus(error.message);
        onError?.(error);
        pendingState.current = null;
        return;
      }

      if (data.type === "fluent:connect:session") {
        setSession(data.session);
        setStatus("Wallet connected!");
        onSession?.(data.session);
        pendingState.current = null;
        popupRef.current?.close();
      }
    }

    win.addEventListener("message", onMessage);
    return () => win.removeEventListener("message", onMessage);
  }, [authorizeOrigin, onError, onSession]);

  const connect = useCallback(() => {
    const state = createState();
    pendingState.current = state;
    setStatus("Opening Fluent Connect");

    const win = browserWindow();
    const url = new URL(authorizeUrl, win.location.href);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", win.location.href);
    if (campaign) url.searchParams.set("campaign", campaign);
    if (source) url.searchParams.set("source", source);
    if (metadata) url.searchParams.set("metadata", JSON.stringify(metadata));

    popupRef.current = win.open(url.toString(), "fluent_connect", popupFeatures());
    if (!popupRef.current) {
      const error = new Error("Popup blocked. Allow popups for this site and try again.");
      setStatus(error.message);
      onError?.(error);
      pendingState.current = null;
    }
  }, [authorizeUrl, campaign, clientId, metadata, onError, scopes, source]);

  return (
    <section aria-label="Fluent hosted login widget" style={styles.shell}>
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.mark}>F</div>
          <div>
            <p style={styles.title}>Connect with Fluent</p>
            <p style={styles.subtitle}>
              {session?.wallet.signerAddress
                ? `${session.wallet.signerAddress.slice(0, 6)}...${session.wallet.signerAddress.slice(-4)}`
                : "Fluent ID, wallet, BLEND"}
            </p>
          </div>
        </div>
        <button type="button" onClick={connect} style={styles.button}>
          {session ? "Connected" : "Connect"}
        </button>
      </div>
      {status ? <p style={styles.status}>{status}</p> : null}
    </section>
  );
}
