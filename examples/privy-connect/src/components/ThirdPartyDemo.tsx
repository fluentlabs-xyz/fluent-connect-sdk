import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { FluentWidgetSession, FLUENT_FAUCET_ENDPOINT, HOSTED_AUTHORIZE_URL, FLUENT_CLIENT_ID, FLUENT_LOGO, FLUENT_SESSION_ENDPOINT } from "../const";
import { ReownWalletState } from "../reown-appkit";
import { formatAddress } from "../utils/formatAddress";
import { formatExternalWallet } from "../utils/formatExternalWallet";
import { formatSession } from "../utils/formatSession";
import { getAnonymousId } from "../utils/getAnonymousId";
import { postJson } from "../utils/postJson";
import { BlendPayGate } from "./BlendPayGate";
import { ChessDemo } from "./ChessDemo";
import { ConnectChoiceModal } from "./ConnectChoiceModal";
import { WalletMenuActionCard } from "./WalletMenuActionCard";

export function ThirdPartyDemo({
  wallet,
  view = "home",
}: {
  wallet: ReownWalletState | null;
  view?: "home" | "chess";
}) {
  const [session, setSession] = useState<FluentWidgetSession | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [privyIdentityToken, setPrivyIdentityToken] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fluentWalletAddress = session?.wallet.signerAddress;
  const connectedAddress = wallet?.connected && wallet.address ? wallet.address : fluentWalletAddress;
  const hasConnectedAccount = Boolean(wallet?.connected || session?.user?.id || session?.wallet?.signerAddress);
  const widgetScopes = useMemo(
    () => ["openid", "profile", "wallet", "faucet"],
    [],
  );
  const openConnectFlow = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    setAccountOpen(false);
    setConnectOpen(true);
  }, []);
  const openAccountMenu = useCallback(() => {
    if (accountCloseTimer.current) {
      clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    if (hasConnectedAccount) setAccountOpen(true);
  }, [hasConnectedAccount]);
  const scheduleAccountMenuClose = useCallback(() => {
    if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    accountCloseTimer.current = setTimeout(() => {
      setAccountOpen(false);
      accountCloseTimer.current = null;
    }, 250);
  }, []);
  const handleTopConnectClick = useCallback(() => {
    if (hasConnectedAccount) {
      setAccountOpen((current) => !current);
      return;
    }

    openConnectFlow();
  }, [hasConnectedAccount, openConnectFlow]);
  const handleDisconnect = useCallback(async () => {
    setAccountOpen(false);
    setSession(null);
    setPrivyIdentityToken(null);
    setWalletStatus("Disconnected");
    if (wallet?.connected) wallet.disconnect();
  }, [wallet]);

  const handleFaucetClaim = useCallback(async () => {
    if (!session) {
      setWalletStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!privyIdentityToken) {
      setWalletStatus("Privy identity token missing. Reconnect with Fluent ID.");
      return;
    }

    setFaucetBusy(true);
    setWalletStatus("Requesting BLEND faucet");
    try {
      const receipt = await postJson<{ status?: string; txHash?: string; message?: string }>(
        FLUENT_FAUCET_ENDPOINT,
        {
          visitorId: getAnonymousId(),
          fluentSessionToken: session.idToken,
        },
        {
          Authorization: `Bearer ${privyIdentityToken}`,
        },
      );
      setWalletStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
    } catch (err) {
      setWalletStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [privyIdentityToken, session]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(HOSTED_AUTHORIZE_URL, location.href).origin) return;
      if (!event.data || event.data.type !== "fluent:connect:session") return;
      setSession(event.data.session as FluentWidgetSession);
      setPrivyIdentityToken(
        typeof event.data.privyIdentityToken === "string" ? event.data.privyIdentityToken : null,
      );
      setWalletStatus("Wallet connected!");
      setHostedError(null);
      setConnectOpen(false);
    }

    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    return () => {
      if (accountCloseTimer.current) clearTimeout(accountCloseTimer.current);
    };
  }, []);

  const openHostedFluentConnect = useCallback(() => {
    const state = crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(HOSTED_AUTHORIZE_URL, location.href);
    url.searchParams.set("client_id", FLUENT_CLIENT_ID);
    url.searchParams.set("scope", widgetScopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", location.href);
    url.searchParams.set("source", "demo_widget");
    url.searchParams.set("campaign", "hosted-connect-demo");

    const popup = open(
      url.toString(),
      "fluent_connect",
      "popup=yes,width=460,height=680,left=120,top=80",
    );
    if (!popup) {
      setHostedError("Popup blocked. Allow popups and try again.");
    }
  }, [widgetScopes]);

  return (
    <>
      <div
        className="wallet-control"
        onMouseEnter={openAccountMenu}
        onMouseLeave={scheduleAccountMenuClose}
      >
        <button
          type="button"
          className={hasConnectedAccount ? "top-connect top-connect-connected" : "top-connect"}
          aria-expanded={hasConnectedAccount ? accountOpen : undefined}
          onClick={handleTopConnectClick}
          onFocus={() => {
            openAccountMenu();
          }}
        >
          {hasConnectedAccount ? (
            <>
              <img className="top-connect-logo" src={FLUENT_LOGO} alt="" aria-hidden="true" />
              <span className="top-connect-copy">
                <strong>Wallet Connected</strong>
                <small>Powered by Fluent</small>
              </span>
            </>
          ) : (
            "Connect Wallet"
          )}
        </button>

        {hasConnectedAccount && accountOpen ? (
          <section className="wallet-menu" aria-label="Connected account">
            <div className="wallet-menu-header">
              <span>{wallet?.connected ? "Reown AppKit" : "Fluent Connect ID"}</span>
              <strong>{connectedAddress ? formatAddress(connectedAddress) : "Connected"}</strong>
            </div>
            <div className="wallet-menu-row">
              <span>Status</span>
              <strong className="wallet-menu-status">
                <span aria-hidden="true" />
                Connected
              </strong>
            </div>
            <WalletMenuActionCard
              session={session}
              connectedAddress={connectedAddress}
              faucetBusy={faucetBusy}
              onFaucet={handleFaucetClaim}
            />
            <div className="wallet-menu-actions">
              <button type="button" onClick={() => wallet?.open()}>
                Wallet Connect
              </button>
              <button className="wallet-menu-danger" type="button" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {view === "chess" ? (
        <div className="chess-page">
          <ChessDemo session={session} wallet={wallet} onConnect={openConnectFlow} />
        </div>
      ) : (
        <div className="demo-grid">
          <div>
            <BlendPayGate session={session} wallet={wallet} onConnect={openConnectFlow} />
          </div>

          <section className="payload">
            <div className="payload-header">
              <h2>Host app callback</h2>
              <span>{FLUENT_SESSION_ENDPOINT ? "backend" : "mock"}</span>
            </div>
            <pre>{formatSession(session)}</pre>
            <div className="payload-header payload-header-secondary">
              <h2>External wallet</h2>
              <span>{wallet?.connected ? "Reown" : "wallet"}</span>
            </div>
            <pre>{formatExternalWallet(wallet, walletStatus)}</pre>
            {hostedError ? <p className="payload-error">{hostedError}</p> : null}
          </section>
        </div>
      )}

      <ConnectChoiceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        wallet={wallet}
        fluentReady
        onFluentLogin={() => {
          setWalletStatus("Opening hosted Fluent Connect ID");
          openHostedFluentConnect();
        }}
      />
    </>
  );
}
