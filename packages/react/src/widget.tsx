import { useIdentityToken, usePrivy, useUser } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useFluentBridge } from "./hooks/use-fluent-bridge.js";
import { useFluentSmartAccount } from "./hooks/use-fluent-smart-account.js";

export type FluentWidgetTheme = "light" | "dark";

export type FluentWidgetSession = {
  clientId: string;
  idToken: string;
  user: {
    id: string;
    email?: string;
  };
  wallet: {
    signerAddress?: `0x${string}`;
    smartAccountAddress?: `0x${string}`;
  };
  scopes: string[];
  issuedAt: number;
  expiresAt?: number;
  metadata?: Record<string, string>;
};

export type FluentWidgetFaucetReceipt = {
  status: "queued" | "sent" | "already-claimed";
  txHash?: `0x${string}`;
  message?: string;
};

export type FluentWidgetFaucetContext = {
  privyIdentityToken: string;
  visitorId: string;
};

export type FluentWidgetAnalyticsEvent = {
  eventId: string;
  eventName: string;
  clientId: string;
  anonymousId: string;
  sessionId?: string;
  properties: Record<string, unknown>;
};

export type FluentWidgetProps = {
  clientId: string;
  scopes?: string[];
  theme?: FluentWidgetTheme;
  sessionEndpoint?: string;
  faucetEndpoint?: string;
  analyticsEndpoint?: string;
  campaign?: string;
  source?: string;
  metadata?: Record<string, string | number | boolean>;
  onSession?: (session: FluentWidgetSession) => void;
  onEvent?: (event: FluentWidgetAnalyticsEvent) => void;
  exchangeSession?: (params: {
    clientId: string;
    scopes: string[];
    privyAccessToken: string | null;
    userId: string;
    signerAddress?: `0x${string}`;
    smartAccountAddress?: `0x${string}`;
  }) => Promise<FluentWidgetSession>;
  requestFaucet?: (
    session: FluentWidgetSession,
    context: FluentWidgetFaucetContext,
  ) => Promise<FluentWidgetFaucetReceipt>;
};

type PrivyUserLike = {
  id?: string;
  email?: string | { address?: string };
};

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function shortAddress(address?: string): string {
  if (!address) return "Pending";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getEmail(user: PrivyUserLike | null): string | undefined {
  if (!user?.email) return undefined;
  return typeof user.email === "string" ? user.email : user.email.address;
}

function createEventId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `${prefix}_${cryptoApi.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getAnonymousId(): string {
  const storage = (globalThis as { localStorage?: LocalStorageLike }).localStorage;
  if (!storage) return createEventId("anon");

  const key = "fluent.widget.anonymousId";
  const existing = storage.getItem(key);
  if (existing) return existing;

  const next = createEventId("anon");
  storage.setItem(key, next);
  return next;
}

async function createMockSession(params: {
  clientId: string;
  scopes: string[];
  userId: string;
  signerAddress?: `0x${string}`;
  smartAccountAddress?: `0x${string}`;
}): Promise<FluentWidgetSession> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://connect.fluent.xyz",
    aud: params.clientId,
    sub: params.userId,
    scopes: params.scopes,
    iat: issuedAt,
  };

  return {
    clientId: params.clientId,
    idToken: `mock.${btoa(JSON.stringify(payload))}.signature`,
    user: { id: params.userId },
    wallet: {
      signerAddress: params.signerAddress,
      smartAccountAddress: params.smartAccountAddress,
    },
    scopes: params.scopes,
    issuedAt,
  };
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const baseStyles = {
  shell: {
    width: "min(100%, 380px)",
    border: "1px solid",
    borderRadius: 18,
    overflow: "visible",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxShadow: "0 20px 80px rgba(0, 0, 0, 0.28)",
    backdropFilter: "blur(12px)",
    position: "relative",
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
    fontSize: 12,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  button: {
    border: "1px solid",
    borderRadius: 12,
    minHeight: 44,
    padding: "10px 18px",
    fontSize: 16,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 180ms ease, border-color 180ms ease, opacity 180ms ease",
  } satisfies CSSProperties,
  content: {
    padding: 16,
    borderTop: "1px solid",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gap: 8,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 13,
    lineHeight: "18px",
    padding: "8px 0",
  } satisfies CSSProperties,
  label: {
    fontSize: 12,
  } satisfies CSSProperties,
  value: {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 12,
    textAlign: "right",
  } satisfies CSSProperties,
  actions: {
    display: "grid",
    gap: 8,
    marginTop: 14,
  } satisfies CSSProperties,
  secondaryButton: {
    borderRadius: 12,
    minHeight: 40,
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    background: "transparent",
    transition: "background 180ms ease, border-color 180ms ease, opacity 180ms ease",
  } satisfies CSSProperties,
  status: {
    margin: "10px 0 0",
    fontSize: 12,
    lineHeight: "17px",
  } satisfies CSSProperties,
  menuItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: 0,
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
};

export function FluentWidget({
  clientId,
  scopes = ["openid", "profile", "wallet", "faucet"],
  theme = "dark",
  onSession,
  onEvent,
  sessionEndpoint,
  faucetEndpoint,
  analyticsEndpoint,
  campaign,
  source,
  metadata,
  exchangeSession,
  requestFaucet,
}: FluentWidgetProps) {
  const scopesKey = scopes.join(" ");
  const stableScopes = useMemo(() => scopes, [scopesKey]);
  const { login, logout, ready, authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const {
    smartAccountEnabled,
    smartAccountReady,
    smartAccountAddress,
    signerAddress,
    error,
  } = useFluentSmartAccount();
  const bridge = useFluentBridge();
  const [session, setSession] = useState<FluentWidgetSession | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anonymousId] = useState(getAnonymousId);
  const loadedTracked = useRef(false);

  const userProfile = user as PrivyUserLike | null;
  const palette = useMemo(() => {
    if (theme === "light") {
      return {
        shellBg: "#ffffff",
        panelBg: "#f3f3f5",
        border: "rgba(3, 2, 19, 0.12)",
        text: "#030213",
        muted: "rgba(3, 2, 19, 0.58)",
        accent: "#49EDED",
        accentText: "#030213",
        markBg: "#030213",
        markText: "#49EDED",
        user: "#FF8FDA",
      };
    }

    return {
      shellBg: "rgba(0, 0, 0, 0.82)",
      panelBg: "#1a1a1a",
      border: "rgba(255, 255, 255, 0.10)",
      text: "#f4f7fb",
      muted: "rgba(255, 255, 255, 0.62)",
      accent: "#49EDED",
      accentText: "#030213",
      markBg: "#49EDED",
      markText: "#030213",
      user: "#FF8FDA",
    };
  }, [theme]);

  const track = useCallback(
    (eventName: string, properties: Record<string, unknown> = {}) => {
      const event: FluentWidgetAnalyticsEvent = {
        eventId: createEventId("evt"),
        eventName,
        clientId,
        anonymousId,
        sessionId: session?.metadata?.sessionId,
        properties: {
          campaign,
          source,
          scopes: stableScopes,
          signerAddress,
          smartAccountAddress,
          authenticated,
          ...metadata,
          ...properties,
        },
      };

      onEvent?.(event);

      if (analyticsEndpoint) {
        void fetch(analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        }).catch(() => undefined);
      }
    },
    [
      analyticsEndpoint,
      anonymousId,
      authenticated,
      campaign,
      clientId,
      metadata,
      onEvent,
      stableScopes,
      session?.metadata?.sessionId,
      signerAddress,
      smartAccountAddress,
      source,
    ],
  );

  useEffect(() => {
    if (loadedTracked.current) return;
    loadedTracked.current = true;
    track("widget_loaded");
  }, [track]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      if (!authenticated || !userProfile?.id) return;
      if (smartAccountEnabled && !smartAccountReady) return;

      setSessionStatus("Verifying Fluent session");
      track("session_exchange_started", { userId: userProfile.id });
      try {
        const privyAccessToken = await getAccessToken();
        const sessionPayload = {
          clientId,
          scopes: stableScopes,
          privyAccessToken,
          userId: userProfile.id,
          signerAddress,
          smartAccountAddress,
        };
        const nextSession = exchangeSession
          ? await exchangeSession(sessionPayload)
          : sessionEndpoint
            ? await postJson<FluentWidgetSession>(sessionEndpoint, sessionPayload)
          : await createMockSession({
              clientId,
              scopes: stableScopes,
              userId: userProfile.id,
              signerAddress,
              smartAccountAddress,
            });

        if (cancelled) return;
        nextSession.user.email = getEmail(userProfile);
        setSession(nextSession);
        setSessionStatus("Fluent session ready");
        track("session_exchange_completed", {
          userId: nextSession.user.id,
          sessionId: nextSession.metadata?.sessionId,
        });
        onSession?.(nextSession);
      } catch (err) {
        if (cancelled) return;
        setSession(null);
        setSessionStatus(err instanceof Error ? err.message : "Session verification failed");
        track("session_exchange_failed", {
          error: err instanceof Error ? err.message : "Session verification failed",
        });
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    userProfile?.id,
    smartAccountEnabled,
    smartAccountReady,
    smartAccountAddress,
    signerAddress,
    clientId,
    stableScopes,
    exchangeSession,
    sessionEndpoint,
    getAccessToken,
    onSession,
    track,
  ]);

  const onLogout = useCallback(async () => {
    track("disconnect_clicked");
    setSession(null);
    setFaucetStatus(null);
    setSessionStatus(null);
    await logout();
  }, [logout, track]);

  const onFaucet = useCallback(async () => {
    if (!session) return;
    setFaucetBusy(true);
    setFaucetStatus("Checking faucet eligibility");
    track("faucet_started");
    try {
      if (!identityToken) {
        await refreshUser();
        throw new Error("Privy identity token unavailable. Enable identity tokens in Privy and relogin.");
      }

      const faucetContext = {
        privyIdentityToken: identityToken,
        visitorId: anonymousId,
      };
      const receipt = requestFaucet
        ? await requestFaucet(session, faucetContext)
	        : faucetEndpoint
	          ? await postJson<FluentWidgetFaucetReceipt>(
	              faucetEndpoint,
	              { visitorId: anonymousId },
	              {
	                Authorization: `Bearer ${identityToken}`,
	              },
	            )
          : await new Promise<FluentWidgetFaucetReceipt>((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    status: "queued",
                    message: "Mock faucet request queued",
                  }),
                600,
              ),
            );

      setFaucetStatus(
        receipt.txHash
          ? `${receipt.status}: ${shortAddress(receipt.txHash)}`
          : receipt.message ?? receipt.status,
      );
      track("faucet_completed", {
        status: receipt.status,
        txHash: receipt.txHash,
      });
    } catch (err) {
      setFaucetStatus(err instanceof Error ? err.message : "Faucet request failed");
      track("faucet_failed", {
        error: err instanceof Error ? err.message : "Faucet request failed",
      });
    } finally {
      setFaucetBusy(false);
    }
  }, [anonymousId, faucetEndpoint, identityToken, refreshUser, requestFaucet, session, track]);

  const onBridge = useCallback(async () => {
    setFaucetStatus("Discovering bridge route");
    track("bridge_started");
    try {
      const routes = await bridge.discoverRoutes({
        toAddress: (smartAccountAddress ?? signerAddress) as `0x${string}` | undefined,
      });
      const route = routes[0];
      if (!route) {
        setFaucetStatus("No bridge route available");
        track("bridge_failed", { error: "No bridge route available" });
        return;
      }
      const quote = await bridge.quoteRoute(route, {
        toAddress: (smartAccountAddress ?? signerAddress) as `0x${string}` | undefined,
      });
      setFaucetStatus(`${route.provider}: ${quote.outputAmount} ${route.asset.symbol} quoted`);
      track("bridge_quote_ready", {
        routeId: route.routeId,
        provider: route.provider,
        quoteId: quote.quoteId,
      });
    } catch (err) {
      setFaucetStatus(err instanceof Error ? err.message : "Bridge route failed");
      track("bridge_failed", {
        error: err instanceof Error ? err.message : "Bridge route failed",
      });
    }
  }, [bridge, signerAddress, smartAccountAddress, track]);

  const connectedSubtitle = session
    ? "Verified Fluent session"
    : smartAccountEnabled && smartAccountReady
      ? "Creating Fluent session"
      : smartAccountEnabled
        ? "Preparing smart account"
        : "Preparing wallet";
  const accountAddress = smartAccountAddress ?? signerAddress;

  return (
    <section
      aria-label="Fluent login widget"
      onMouseEnter={() => {
        if (authenticated) setMenuOpen(true);
      }}
      onMouseLeave={() => setMenuOpen(false)}
      style={{
        ...baseStyles.shell,
        background: palette.shellBg,
        borderColor: palette.border,
        color: palette.text,
      }}
    >
      <div style={baseStyles.topbar}>
        <div style={baseStyles.brand}>
          <div
            style={{
              ...baseStyles.mark,
              background:
                authenticated
                  ? "linear-gradient(120deg, #FF8FDA 0%, #FECD07 100%)"
                  : palette.markBg,
              color: palette.markText,
            }}
          >
            F
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={baseStyles.title}>Connect with Fluent</p>
            <p style={{ ...baseStyles.subtitle, color: palette.muted }}>
              {authenticated ? shortAddress(accountAddress) : "Fluent ID, wallet, BLEND"}
            </p>
          </div>
        </div>

        {authenticated ? (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(true);
              track("smart_menu_toggled");
            }}
            style={{
              ...baseStyles.button,
              borderColor: menuOpen ? palette.accent : palette.border,
              color: palette.text,
              background: "rgba(255, 255, 255, 0.03)",
            }}
          >
            Connected v
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              track("login_clicked");
              void login();
            }}
            disabled={!ready}
            style={{
              ...baseStyles.button,
              borderColor: ready ? "rgba(255, 255, 255, 0.30)" : palette.border,
              background: "rgba(255, 255, 255, 0.02)",
              color: palette.text,
              opacity: ready ? 1 : 0.65,
            }}
          >
            {ready ? "Connect" : "Loading"}
          </button>
        )}
      </div>

      {authenticated && menuOpen ? (
        <div
          style={{
            ...baseStyles.content,
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 10,
            border: `1px solid ${palette.border}`,
            borderRadius: 16,
            background: palette.panelBg,
            boxShadow: "0 24px 70px rgba(0, 0, 0, 0.36)",
          }}
        >
          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              onClick={onFaucet}
              disabled={!session || faucetBusy}
              style={{
                ...baseStyles.menuItem,
                background:
                  session && !faucetBusy
                    ? "linear-gradient(90deg, #FE6901 -7.32%, #FF7FFE 81.62%)"
                    : "rgba(255, 255, 255, 0.08)",
                color: session && !faucetBusy ? palette.accentText : palette.muted,
                opacity: session && !faucetBusy ? 1 : 0.7,
              }}
            >
              <span>{faucetBusy ? "Requesting BLEND" : "Claim BLEND faucet"}</span>
              <span>Recommended</span>
            </button>
            <button
              type="button"
              onClick={onBridge}
              style={{
                ...baseStyles.menuItem,
                background: "rgba(255, 255, 255, 0.06)",
                color: palette.text,
              }}
            >
              <span>Bridge assets</span>
              <span style={{ color: palette.muted }}>
                {bridge.status === "quote-ready" ? "Quoted" : "Next"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => track("swap_clicked", { simulated: true })}
              style={{
                ...baseStyles.menuItem,
                background: "rgba(255, 255, 255, 0.06)",
                color: palette.text,
              }}
            >
              <span>Swap to BLEND</span>
              <span style={{ color: palette.muted }}>Soon</span>
            </button>
          </div>

          <div style={baseStyles.grid}>
            <div style={baseStyles.row}>
              <span style={{ ...baseStyles.label, color: palette.muted }}>Fluent ID</span>
              <span style={{ ...baseStyles.value, color: palette.user }}>
                {userProfile?.id ?? "Pending"}
              </span>
            </div>
            <div style={baseStyles.row}>
              <span style={{ ...baseStyles.label, color: palette.muted }}>Embedded wallet</span>
              <span style={baseStyles.value}>{shortAddress(signerAddress)}</span>
            </div>
            {smartAccountEnabled ? (
              <div style={baseStyles.row}>
                <span style={{ ...baseStyles.label, color: palette.muted }}>Smart account</span>
                <span style={baseStyles.value}>{shortAddress(smartAccountAddress)}</span>
              </div>
            ) : null}
            <div style={baseStyles.row}>
              <span style={{ ...baseStyles.label, color: palette.muted }}>Status</span>
              <span style={baseStyles.value}>{connectedSubtitle}</span>
            </div>
          </div>

          <div style={baseStyles.actions}>
            <button
              type="button"
              onClick={onLogout}
              style={{
                ...baseStyles.secondaryButton,
                border: `1px solid ${palette.border}`,
                color: palette.text,
                background: "rgba(255, 255, 255, 0.04)",
              }}
            >
              Disconnect
            </button>
          </div>

          {error ? (
            <p style={{ ...baseStyles.status, color: "#ff7b7b" }}>{error.message}</p>
          ) : null}
          {sessionStatus ? (
            <p style={{ ...baseStyles.status, color: palette.muted }}>{sessionStatus}</p>
          ) : null}
          {faucetStatus ? (
            <p style={{ ...baseStyles.status, color: palette.muted }}>{faucetStatus}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
