import { useCallback, useEffect, useState } from "react";
import { FluentAuthError, type FluentWidgetRenderContext } from "@fluent.xyz/connect";

import { CLIENT_ID, FLUENT_AUTH_ISSUER } from "../consts";
import { partnerApi, type PartnerUser } from "../partnerApi";
import { verifyFluentToken, type FluentClaims } from "../verify";

type Verification =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "ok"; claims: FluentClaims }
  | { status: "failed"; message: string };

function describeAccount(type: "smart" | "eoa" | undefined) {
  if (type === "smart") return "Fluent ID (Privy embedded wallet → smart account)";
  if (type === "eoa") return "External wallet (EOA signs an EIP-712 challenge)";
  return "Not connected";
}

function formatError(err: unknown) {
  if (err instanceof FluentAuthError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export function AuthPanel({ ctx }: { ctx: FluentWidgetRenderContext }) {
  const { widget, getAuthToken } = ctx;
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  // `result` survives a request in flight so the block never unmounts mid-click.
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partner, setPartner] = useState<
    { status: "idle" } | { status: "ok"; user: PartnerUser; via: string; at: string } | { status: "failed"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const fetchToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await getAuthToken();
      setCached(next === token);
      setToken(next);
      setVerification({ status: "verifying" });
      try {
        setVerification({ status: "ok", claims: await verifyFluentToken(next) });
      } catch (err) {
        setVerification({ status: "failed", message: formatError(err) });
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }, [getAuthToken, token]);

  const partnerCall = useCallback(async (via: string, run: () => Promise<{ user: PartnerUser }>) => {
    setPartnerBusy(true);
    try {
      const { user } = await run();
      setPartner({ status: "ok", user, via, at: new Date().toLocaleTimeString() });
    } catch (err) {
      setPartner({ status: "failed", message: formatError(err) });
    } finally {
      setPartnerBusy(false);
    }
  }, []);

  const partnerLogin = useCallback(
    () => token && partnerCall("POST /api/login — Bearer <Fluent token>", () => partnerApi.login(token)),
    [partnerCall, token],
  );
  const partnerMe = useCallback(
    () => partnerCall("GET /api/me — cookie only, no Fluent token", () => partnerApi.me()),
    [partnerCall],
  );
  const partnerLogout = useCallback(async () => {
    await partnerApi.logout().catch(() => undefined);
    setPartner({ status: "idle" });
  }, []);

  const claims = verification.status === "ok" ? verification.claims : null;
  const secondsLeft = claims?.exp ? Math.max(0, Math.round(claims.exp - now / 1000)) : null;

  return (
    <section className="panel">
      <h1>Fluent auth token</h1>
      <p className="muted">
        One call — <code>getAuthToken()</code> — then this page verifies the result the way a
        partner backend would: JWKS from the pinned issuer, ES256, <code>iss</code>,{" "}
        <code>aud</code>, <code>exp</code>. Fluent is not asked anything after the token is issued.
      </p>

      <dl className="rows">
        <dt>Signed in as</dt>
        <dd>
          {describeAccount(widget.account.type)}
          {widget.account.address ? <code className="block">{widget.account.address}</code> : null}
        </dd>
      </dl>

      <button
        type="button"
        className="primary"
        disabled={busy || !widget.account.type}
        onClick={fetchToken}
      >
        {busy ? "Working…" : token ? "Get token again" : "Get Fluent token"}
      </button>
      {error ? <p className="error">{error}</p> : null}

      {token ? (
        <dl className="rows">
          <dt>Token {cached ? <span className="tag">cached</span> : <span className="tag">fresh</span>}</dt>
          <dd>
            <code className="block wrap">{token}</code>
            {secondsLeft !== null ? (
              <span className="muted">expires in {secondsLeft}s</span>
            ) : null}
          </dd>
        </dl>
      ) : null}

      {verification.status !== "idle" ? (
        <dl className="rows">
          <dt>Verified by this page</dt>
          <dd>
            {verification.status === "verifying" ? "Fetching JWKS and checking the signature…" : null}
            {verification.status === "failed" ? (
              <span className="error">✗ {verification.message}</span>
            ) : null}
            {claims ? (
              <>
                <span className="ok">✓ signature, issuer, audience and expiry all check out</span>
                <table className="claims">
                  <tbody>
                    <tr>
                      <th>iss</th>
                      <td>
                        <code>{String(claims.iss)}</code> (pinned: <code>{FLUENT_AUTH_ISSUER}</code>)
                      </td>
                    </tr>
                    <tr>
                      <th>aud</th>
                      <td>
                        <code>{String(claims.aud)}</code> (this app: <code>{CLIENT_ID}</code>)
                      </td>
                    </tr>
                    <tr>
                      <th>sub</th>
                      <td><code>{claims.sub}</code> — stable per user, per app</td>
                    </tr>
                    <tr>
                      <th>auth_method</th>
                      <td><code>{claims.auth_method}</code></td>
                    </tr>
                    <tr>
                      <th>scopes</th>
                      <td><code>{JSON.stringify(claims.scopes)}</code></td>
                    </tr>
                    <tr>
                      <th>addresses</th>
                      <td>
                        {claims.addresses ? (
                          <code className="block">{JSON.stringify(claims.addresses, null, 2)}</code>
                        ) : (
                          <span className="muted">
                            absent — the app does not hold the <code>addresses</code> scope
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : null}
          </dd>
        </dl>
      ) : null}

      <h2>Partner backend</h2>
      <p className="muted">
        What a partner does with the token: send it once to its own backend (<code>server/partnerBackend.ts</code>,
        a dev-server route), which verifies it against the JWKS, keys a user row on <code>sub</code>,
        and answers with its <em>own</em> cookie session. Every later request — <code>/api/me</code> —
        carries that cookie and never the Fluent token.
      </p>
      <div className="actions">
        <span
          className="tip"
          data-tip="POST /api/login with the Fluent token as a Bearer header. The backend verifies it against the JWKS, upserts the user row by sub (logins +1), and answers with its own HttpOnly session cookie."
        >
          <button type="button" className="primary" disabled={!token || partnerBusy} onClick={partnerLogin}>
            Sign in to partner backend
          </button>
        </span>
        <span
          className="tip"
          data-tip="GET /api/me with the session cookie only — no Fluent token in the request. The backend answers from its own store; logins does not change."
        >
          <button type="button" disabled={partnerBusy} onClick={partnerMe}>
            GET /api/me
          </button>
        </span>
        <span
          className="tip"
          data-tip="POST /api/logout — the backend deletes the session and clears the cookie. /api/me then returns 401 until you sign in again."
        >
          <button type="button" disabled={partnerBusy} onClick={partnerLogout}>
            Log out of partner
          </button>
        </span>
      </div>
      {partner.status === "failed" ? <p className="error">✗ {partner.message}</p> : null}
      {partner.status === "ok" ? (
        <dl className="rows">
          <dt>{partner.via}</dt>
          <dd>
            <table className="claims">
              <tbody>
                <tr>
                  <th>sub</th>
                  <td><code>{partner.user.sub}</code></td>
                </tr>
                <tr>
                  <th>address</th>
                  <td>{partner.user.address ? <code>{partner.user.address}</code> : <span className="muted">none — token carried no addresses</span>}</td>
                </tr>
                <tr>
                  <th>logins</th>
                  <td>{partner.user.logins} — counts sign-ins only; <code>/api/me</code> reads, never increments</td>
                </tr>
                <tr>
                  <th>answered at</th>
                  <td>{partner.at}</td>
                </tr>
              </tbody>
            </table>
          </dd>
        </dl>
      ) : null}
    </section>
  );
}
