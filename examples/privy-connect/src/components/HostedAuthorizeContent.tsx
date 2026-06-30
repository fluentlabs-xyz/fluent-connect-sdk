import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useState, useMemo, useCallback } from "react";
import { FLUENT_CLIENT_ID, FLUENT_HOSTED_SESSION_ENDPOINT, FluentWidgetSession, FLUENT_LOGO } from "../const";
import { createMockHostedSession } from "../utils/createMockHostedSession";
import { getPrivyWalletAddress } from "../utils/getPrivyWalletAddress";
import { postJson } from "../utils/postJson";

export function HostedAuthorizeContent() {
  const { authenticated, getAccessToken, login, logout, ready, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [status, setStatus] = useState("Waiting for Fluent ID");
  const [sent, setSent] = useState(false);

  const query = useMemo(() => new URLSearchParams(location.search), []);
  const clientId = query.get("client_id") || FLUENT_CLIENT_ID;
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
    if (!authenticated || !user?.id || sent) return;
    if (!opener || !targetOrigin) {
      setStatus("Missing opener or redirect origin");
      return;
    }

    setStatus("Creating Fluent session");
    try {
      if (!identityToken) {
        setStatus("Waiting for Privy identity token");
        return;
      }

      const privyAccessToken = await getAccessToken();
      const session = FLUENT_HOSTED_SESSION_ENDPOINT
        ? await postJson<FluentWidgetSession>(FLUENT_HOSTED_SESSION_ENDPOINT, {
            clientId,
            scopes,
            privyAccessToken,
            privyIdentityToken: identityToken,
            redirectUri: redirectURI,
          })
        : createMockHostedSession({
            clientId,
            scopes,
            userId: user.id,
            signerAddress: getPrivyWalletAddress(user) as `0x${string}` | undefined,
          });

      opener.postMessage(
        {
          type: "fluent:connect:session",
          state,
          session,
          privyIdentityToken: identityToken,
        },
        targetOrigin,
      );
      setSent(true);
      setStatus("Wallet connected!");
      setTimeout(() => close(), 350);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create Fluent session";
      opener.postMessage(
        {
          type: "fluent:connect:error",
          state,
          error: message,
        },
        targetOrigin,
      );
      setStatus(message);
    }
  }, [authenticated, clientId, getAccessToken, identityToken, scopes, sent, state, targetOrigin, user]);

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