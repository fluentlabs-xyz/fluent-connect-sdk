import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useState, useMemo, useCallback } from "react";
import { type FluentAppIdentity } from "@fluent/connect-sdk";
import { FLUENT_HOSTED_SESSION_ENDPOINT, FluentWidgetSession, FLUENT_LOGO } from "../const";
import { createMockHostedSession } from "../utils/createMockHostedSession";
import { getPrivyWalletAddress } from "../utils/getPrivyWalletAddress";
import { postJson } from "../utils/postJson";

export function HostedAuthorizeContent() {
  const { authenticated, getAccessToken, login, logout, ready, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [status, setStatus] = useState("Waiting for Fluent ID");
  const [sent, setSent] = useState(false);

  ////////// ////////// ////////// ////////// ////////// //////////
  ////////// 1. Read Builder Request: the SDK passes app identity in the URL.
  ////////// Basic mode uses origin + installation_id. Registered apps may add client_id.
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const requestedOrigin = query.get("origin") || "";
  const requestedInstallationId = query.get("installation_id") || "";
  const requestedClientId = query.get("client_id") || undefined;
  const requestedAppName = query.get("app_name") || undefined;
  const app = useMemo<FluentAppIdentity>(
    () => ({
      mode: requestedClientId ? "registered" : "origin",
      origin: requestedOrigin || "unknown-origin",
      installationId: requestedInstallationId || "unknown-installation",
      clientId: requestedClientId,
      appName: requestedAppName,
    }),
    [requestedAppName, requestedClientId, requestedInstallationId, requestedOrigin],
  );
  const scopes = useMemo(
    () => (query.get("scope") || "openid profile wallet faucet").split(" ").filter(Boolean),
    [query],
  );
  const state = query.get("state") || "";
  const redirectURI = query.get("redirect_uri") || "";
  const targetOrigin = useMemo(() => {
    try {
      return new URL(redirectURI).origin;
    } catch {
      return "";
    }
  }, [redirectURI]);

  const completeAuthorization = useCallback(async () => {
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 2. Authenticate User: Privy proves this user owns a Fluent ID.
    if (!authenticated || !user?.id || sent) return;
    if (!targetOrigin && !redirectURI) {
      setStatus("Missing redirect origin");
      return;
    }

    setStatus("Creating Fluent session");
    try {
      if (!identityToken) {
        setStatus("Waiting for Privy identity token");
        return;
      }

      ////////// ////////// ////////// ////////// ////////// //////////
      ////////// 3. Create Session: production calls the backend, this demo can mock it.
      ////////// The signer wallet stays hidden; the smart account is the user-facing account.
      const privyAccessToken = await getAccessToken();
      const session = FLUENT_HOSTED_SESSION_ENDPOINT
        ? await postJson<FluentWidgetSession>(FLUENT_HOSTED_SESSION_ENDPOINT, {
            app,
            scopes,
            privyAccessToken,
            privyIdentityToken: identityToken,
            redirectUri: redirectURI,
          })
        : createMockHostedSession({
            app,
            scopes,
            userId: user.id,
            signerAddress: getPrivyWalletAddress(user) as `0x${string}` | undefined,
          });

      ////////// ////////// ////////// ////////// ////////// //////////
      ////////// 4. Return Session: postMessage sends the result back to the builder app.
      const payload = {
        type: "fluent:connect:session",
        state,
        session,
        privyIdentityToken: identityToken,
      };
      if (opener && targetOrigin) {
        opener.postMessage(payload, targetOrigin);
      } else if (redirectURI) {
        const redirectUrl = new URL(redirectURI);
        redirectUrl.hash = `fluent_connect_result=${encodeURIComponent(JSON.stringify(payload))}`;
        location.href = redirectUrl.toString();
        return;
      }
      setSent(true);
      setStatus("Wallet connected!");
      setTimeout(() => close(), 350);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create Fluent session";
      const payload = {
          type: "fluent:connect:error",
          state,
          error: message,
        };
      if (opener && targetOrigin) {
        opener.postMessage(payload, targetOrigin);
      } else if (redirectURI) {
        const redirectUrl = new URL(redirectURI);
        redirectUrl.hash = `fluent_connect_result=${encodeURIComponent(JSON.stringify(payload))}`;
        location.href = redirectUrl.toString();
        return;
      }
      setStatus(message);
    }
  }, [app, authenticated, getAccessToken, identityToken, redirectURI, scopes, sent, state, targetOrigin, user]);

  const switchAccount = useCallback(async () => {
    setStatus("Signing out of Fluent ID");
    setSent(false);
    await logout();
    setStatus("Choose another Fluent ID account");
  }, [logout]);

  return (
    <main className="authorize-page">
      <section className="authorize-panel">
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        <h1>Fluent Connect ID</h1>
        <p className="lead">Continue with Fluent ID to connect this app.</p>
        <button
          type="button"
          disabled={!ready || sent}
          onClick={authenticated ? completeAuthorization : login}
        >
          {sent ? "Connected" : authenticated ? "Continue with current account" : ready ? "Continue" : "Loading"}
        </button>
        {authenticated ? (
          <button className="authorize-secondary" type="button" disabled={sent} onClick={switchAccount}>
            Switch account
          </button>
        ) : null}
        <p className="authorize-status">{status}</p>
      </section>
    </main>
  );
}
