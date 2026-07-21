import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { type FluentAppIdentity } from "@fluent/connect-sdk";
import { Button } from "@fluent/react";
import { FLUENT_HOSTED_SESSION_ENDPOINT, FluentWidgetSession } from "../const";
import { createMockHostedSession } from "../utils/createMockHostedSession";
import { getPrivyWalletAddress } from "../utils/getPrivyWalletAddress";
import { postJson } from "../utils/postJson";
import { useFluentZeroDevAccount } from "../zerodevSession";

export function HostedAuthorizeContent() {
  const { authenticated, getAccessToken, login, logout, ready, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const smartAccount = useFluentZeroDevAccount();
  const [status, setStatus] = useState("Waiting for Fluent ID");
  const [sent, setSent] = useState(false);
  const autoLoginRequested = useRef(false);
  const authorizationInFlight = useRef(false);

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
    console.log("[hosted authorize] completeAuthorization", {
      ready,
      authenticated,
      hasUser: Boolean(user?.id),
      sent,
      hasIdentityToken: Boolean(identityToken),
      targetOrigin,
      redirectURI,
      signerAddress: smartAccount.signerAddress,
      smartAccountAddress: smartAccount.smartAccountAddress,
      smartAccountReady: smartAccount.smartAccountReady,
      smartAccountError: smartAccount.error?.message,
    });
    ////////// ////////// ////////// ////////// ////////// //////////
    ////////// 2. Authenticate User: Privy proves this user owns a Fluent ID.
    if (!authenticated || !user?.id || sent) return;
    if (!targetOrigin && !redirectURI) {
      setStatus("Missing redirect origin");
      return;
    }

    if (!identityToken) {
      setStatus("Waiting for Privy identity token");
      return;
    }
    if (authorizationInFlight.current) return;

    authorizationInFlight.current = true;
    setStatus("Creating Fluent session");
    try {
      setStatus("Preparing Fluent account");
      console.log("[hosted authorize] preparing Fluent account", {
        hasKernel: Boolean(smartAccount.kernel),
        signerAddress: smartAccount.signerAddress,
        smartAccountAddress: smartAccount.smartAccountAddress,
        smartAccountReady: smartAccount.smartAccountReady,
      });
      const kernel = smartAccount.kernel ?? await smartAccount.refresh();
      if (!kernel?.smartAccountAddress) {
        console.warn("[hosted authorize] Fluent account not ready", {
          signerAddress: smartAccount.signerAddress,
          smartAccountAddress: smartAccount.smartAccountAddress,
          smartAccountReady: smartAccount.smartAccountReady,
          error: smartAccount.error?.message,
        });
        setStatus(smartAccount.error?.message ?? "Waiting for ZeroDev smart account");
        return;
      }
      console.log("[hosted authorize] Fluent account ready", {
        signerAddress: smartAccount.signerAddress,
        smartAccountAddress: kernel.smartAccountAddress,
      });

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
            smartAccountAddress: kernel.smartAccountAddress,
            redirectUri: redirectURI,
          })
        : createMockHostedSession({
            app,
            scopes,
            userId: user.id,
            signerAddress: smartAccount.signerAddress ?? getPrivyWalletAddress(user) as `0x${string}` | undefined,
            smartAccountAddress: kernel.smartAccountAddress,
          });
      console.log("[hosted authorize] session created", {
        userId: session.user?.id,
        signerAddress: session.wallet?.signerAddress,
        smartAccountAddress: session.wallet?.smartAccountAddress,
        scopes: session.scopes,
        hasIdToken: Boolean(session.idToken),
        hasPrivyIdentityToken: Boolean(identityToken),
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
        console.log("[hosted authorize] posting session", { targetOrigin });
        opener.postMessage(payload, targetOrigin);
      } else if (redirectURI) {
        console.log("[hosted authorize] redirecting session", { redirectURI });
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
      console.error("[hosted authorize] failed", err);
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
    } finally {
      authorizationInFlight.current = false;
    }
  }, [app, authenticated, getAccessToken, identityToken, ready, redirectURI, scopes, sent, smartAccount, state, targetOrigin, user]);

  // Option A: skip the interstitial "Continue" click by opening the Privy
  // dialog automatically once Privy is ready and the user isn't signed in.
  useEffect(() => {
    if (!ready || authenticated || sent || autoLoginRequested.current) return;
    autoLoginRequested.current = true;
    setStatus("Opening Fluent ID");
    void login();
  }, [ready, authenticated, sent, login]);

  // Once authenticated, complete authorization automatically (no extra click).
  // completeAuthorization guards on readiness/`sent` and re-runs as the
  // identity token and smart account become available.
  useEffect(() => {
    if (!authenticated || sent) return;
    void completeAuthorization();
  }, [authenticated, sent, completeAuthorization]);

  const switchAccount = useCallback(async () => {
    setStatus("Signing out of Fluent ID");
    setSent(false);
    autoLoginRequested.current = false;
    await logout();
    setStatus("Choose another Fluent ID account");
  }, [logout]);

  return (
    <main className="min-h-screen min-w-screen flex *:flex-1">
      <div className="dark antialiased relative overflow-hidden bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 flex items-center justify-center">
        <div className="relative z-20">

          <div className="flex flex-col items-center gap-2 px-5 pt-5 pb-3 text-center">
            <span className="text-base leading-none font-medium">Fluent Connect ID</span>
            <span className="text-sm text-muted-foreground">
              Continue with Fluent ID to connect this app.
            </span>
          </div>

          <div className="flex flex-col gap-2 p-2.5">
            <Button
              disabled={!ready || sent}
              onClick={authenticated ? completeAuthorization : login}
            >
              {sent ? "Connected" : authenticated ? "Continue with current account" : ready ? "Continue" : "Loading"}
            </Button>
            {authenticated ? (
              <Button variant="secondary" disabled={sent} onClick={switchAccount}>
                Switch account
              </Button>
            ) : null}
            <span className="min-h-5 text-center text-xs font-medium text-muted-foreground">
              {status}
            </span>
          </div>
        </div>

        <div
          className="absolute z-[1] inset-1.5 rounded-[18px]"
          style={{
            background:
              "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
            backgroundSize: "150% auto",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
      </div>
    </main>
  );
}
